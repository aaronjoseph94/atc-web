#!/usr/bin/env python3
"""Check the generated clip packs in public/clips/ against the audio and the airport data.

    python3 scripts/clips/verify_clips.py                 # all clips in index.json
    python3 scripts/clips/verify_clips.py --asr DIR       # also transcribe every cue (optional)

Deliberately independent of the builder: it only reads the published files
(index.json, manifest.json, audio.mp3) and src/api/airportData.json, decodes
the MP3 with ffmpeg and redoes the geometry with great-circle maths.

Per clip it checks
  * file: MP3, mono, 22.05/24 kHz, size, ffprobe duration vs ``durationMs``;
  * schema: required keys and types, cue order/overlap, callsigns have tracks;
  * audio: loudness, peak, energy inside every cue vs the gaps, where speech
    actually starts/stops relative to each cue, speech-band share;
  * tracks: sample spacing, rounding, distance from the field, ground samples on
    a runway centreline (or slow and close to one), speed/heading/altitude
    consistent with the position deltas, 3 degree finals, touchdown points;
  * story: every instruction matches what the aircraft is doing (lined up when
    cleared for takeoff with the runway empty, airborne when handed to
    departure, crossing runways never used at the same time, ...).

``--asr`` needs ``pip install faster-whisper`` and a CTranslate2 Whisper model
directory (e.g. Systran/faster-whisper-small.en); it transcribes each cue
window from the finished MP3 and scores it against the manifest text.

Exit status is 1 if any check fails.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import signal

REPO = Path(__file__).resolve().parent.parent.parent
R_EARTH = 6371008.8
NM = 1852.0
FT = 0.3048
KT = NM / 3600.0

MAX_BYTES = 700 * 1024
MAX_RANGE_NM = 6.0
ON_CENTRELINE_M = 25.0
NEAR_RUNWAY_M = 150.0
TAXI_KT = 35.0  # anything off the centreline must be slower than this
MAX_TURN_DEG_S = 25.0
SPEED_TOL = 0.15
SPEED_TOL_KT = 2.5  # absolute allowance (integer rounding / first second of a roll)


# --- great-circle helpers ----------------------------------------------------


def haversine(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(h))


def bearing(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return math.degrees(math.atan2(y, x)) % 360.0


def angle_diff(a: float, b: float) -> float:
    return (a - b + 180.0) % 360.0 - 180.0


def along_cross(p, start, end) -> tuple[float, float]:
    """Along-track and cross-track (right positive) distance of p from the line start->end."""
    d13 = haversine(start, p) / R_EARTH
    t13 = math.radians(bearing(start, p))
    t12 = math.radians(bearing(start, end))
    xt = math.asin(max(-1.0, min(1.0, math.sin(d13) * math.sin(t13 - t12))))
    at = math.atan2(math.sin(d13) * math.cos(t13 - t12), math.cos(d13))
    return at * R_EARTH, xt * R_EARTH


class Rwy:
    def __init__(self, ident, thr, far, displaced_ft, width_ft):
        self.ident = ident
        self.thr = thr
        self.far = far
        self.length = haversine(thr, far)
        self.bearing = bearing(thr, far)
        self.displaced = displaced_ft * FT
        self.width = width_ft * FT

    def rel(self, p):
        return along_cross(p, self.thr, self.far)

    def dist(self, p) -> float:
        """Distance from p to the centreline segment between the two ends."""
        a, x = self.rel(p)
        if a < 0:
            return haversine(p, self.thr)
        if a > self.length:
            return haversine(p, self.far)
        return abs(x)


def load_airport(path: Path, code: str):
    data = json.loads(path.read_text(encoding="utf-8"))["airports"][code]
    rwys = []
    for r in data["runways"]:
        for a, b in ((r["le"], r["he"]), (r["he"], r["le"])):
            rwys.append(Rwy(a["ident"].lstrip("0"), (a["lat"], a["lon"]), (b["lat"], b["lon"]),
                            a.get("displacedFt") or 0.0, r["widthFt"]))
    ends = [r.thr for r in rwys]
    ref = (data.get("lat", sum(e[0] for e in ends) / len(ends)), data.get("lon", sum(e[1] for e in ends) / len(ends)))
    return rwys, ref, data.get("elevationFt"), data["frequencies"]


# --- audio helpers -----------------------------------------------------------


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration,bit_rate,format_name:stream=codec_name,sample_rate,channels,bit_rate",
         "-of", "json", str(path)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def decode(path: Path, sr: int) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(sr), "pipe:1"],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def ffmpeg_lufs(path: Path) -> tuple[float, float]:
    """Integrated loudness (LUFS) and true peak (dBTP) from ffmpeg's EBU R128 meter."""
    err = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    summary = err[err.rfind("Summary:"):]
    lufs = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1))
    peak = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1))
    return lufs, peak


def dbfs(x: np.ndarray) -> float:
    return 10.0 * math.log10(float(np.mean(np.square(x))) + 1e-20) if len(x) else -200.0


# --- the checks --------------------------------------------------------------


class Report:
    def __init__(self, clip_id: str):
        self.clip_id = clip_id
        self.failures: list[str] = []
        self.lines: list[str] = []

    def check(self, ok: bool, label: str, detail: str = "") -> bool:
        self.lines.append(f"  [{'ok' if ok else 'FAIL'}] {label}{': ' + detail if detail else ''}")
        if not ok:
            self.failures.append(label)
        return ok

    def info(self, text: str) -> None:
        self.lines.append(f"       {text}")


def at_time(samples: list[dict], t_ms: float) -> dict | None:
    """Linear interpolation of a track, the way the app does it; None outside the track."""
    if not samples or t_ms < samples[0]["tMs"] or t_ms > samples[-1]["tMs"]:
        return None
    for a, b in zip(samples, samples[1:]):
        if a["tMs"] <= t_ms <= b["tMs"]:
            u = (t_ms - a["tMs"]) / (b["tMs"] - a["tMs"])
            return {
                "lat": a["lat"] + (b["lat"] - a["lat"]) * u,
                "lon": a["lon"] + (b["lon"] - a["lon"]) * u,
                "heading": (a["heading"] + angle_diff(b["heading"], a["heading"]) * u) % 360.0,
                "altitudeFt": a["altitudeFt"] + (b["altitudeFt"] - a["altitudeFt"]) * u,
                "speedKt": a["speedKt"] + (b["speedKt"] - a["speedKt"]) * u,
                "onGround": a["onGround"] if u < 1 else b["onGround"],
            }
    return dict(samples[-1])


def nearest_runway(rwys: list[Rwy], p, heading: float | None = None, airborne: bool = False) -> Rwy:
    cands = rwys if heading is None else [r for r in rwys if abs(angle_diff(r.bearing, heading)) < 45.0] or rwys
    if airborne:
        # An aircraft on approach is miles from every runway; what identifies its runway
        # is the extended centreline it is flying down, not which pavement is nearest.
        return min(cands, key=lambda r: abs(r.rel(p)[1]))
    return min(cands, key=lambda r: (round(r.dist(p)), haversine(p, r.thr)))


def check_schema(rep: Report, m: dict, clip_id: str) -> None:
    need = {"id": str, "stationId": str, "airport": str, "audioUrl": str, "durationMs": int, "title": str,
            "description": str, "cues": list, "aircraft": dict, "tracks": dict}
    bad = [k for k, t in need.items() if not isinstance(m.get(k), t)]
    extra = sorted(set(m) - set(need))
    rep.check(not bad and not extra, "manifest keys/types", f"bad={bad} extra={extra}" if bad or extra else "10 keys")
    rep.check(m.get("id") == clip_id and m.get("audioUrl") == f"/clips/{clip_id}/audio.mp3", "id and audioUrl match the folder")
    cue_ok = all(
        set(c) == {"id", "startMs", "endMs", "text", "callsign", "speaker"}
        and isinstance(c["startMs"], int) and isinstance(c["endMs"], int)
        and c["speaker"] in ("Tower", "Pilot") and c["callsign"] in m["tracks"] and c["text"].strip()
        for c in m["cues"]
    )
    ids = [c["id"] for c in m["cues"]]
    rep.check(cue_ok and len(set(ids)) == len(ids), "cue fields, speakers, unique ids, callsigns have tracks", f"{len(ids)} cues")
    sample_keys = {"tMs", "lat", "lon", "heading", "altitudeFt", "speedKt", "onGround"}
    smp_ok = all(
        set(s) == sample_keys and isinstance(s["tMs"], int) and isinstance(s["onGround"], bool)
        and round(s["lat"], 6) == s["lat"] and round(s["lon"], 6) == s["lon"] and 0.0 <= s["heading"] < 360.0
        for tr in m["tracks"].values() for s in tr
    )
    rep.check(smp_ok, "track sample fields, 6-decimal coordinates, headings in [0, 360)")
    rep.check(set(m["aircraft"]) == set(m["tracks"]) and all(set(v) == {"type", "registration"} for v in m["aircraft"].values()),
              "aircraft entries match tracks", ", ".join(f"{k} {v['type']}" for k, v in m["aircraft"].items()))


def check_audio(rep: Report, m: dict, mp3: Path) -> np.ndarray:
    info = ffprobe(mp3)
    st = info["streams"][0]
    dur = float(info["format"]["duration"])
    size = mp3.stat().st_size
    kbps = int(info["format"]["bit_rate"]) / 1000.0
    sr = int(st["sample_rate"])
    rep.check(st["codec_name"] == "mp3" and st["channels"] == 1 and sr in (22050, 24000) and 30.0 <= kbps <= 42.0,
              "MP3 mono 22.05/24 kHz ~32-40 kbps", f"{st['codec_name']}, {st['channels']} ch, {sr} Hz, {kbps:.1f} kbps")
    rep.check(size < MAX_BYTES, "file size < 700 KB", f"{size / 1024:.0f} KB")
    rep.check(abs(dur * 1000.0 - m["durationMs"]) <= 50.0, "durationMs equals ffprobe duration within 50 ms",
              f"ffprobe {dur * 1000:.0f} ms vs {m['durationMs']} ms (diff {dur * 1000 - m['durationMs']:+.0f} ms)")

    x = decode(mp3, sr)
    rep.info(f"decoded PCM {len(x) / sr * 1000:.0f} ms")
    cues = m["cues"]
    order = all(a["startMs"] < a["endMs"] for a in cues) and all(a["endMs"] <= b["startMs"] for a, b in zip(cues, cues[1:]))
    inside = cues[0]["startMs"] >= 0 and cues[-1]["endMs"] <= min(m["durationMs"], len(x) / sr * 1000.0)
    gaps = [b["startMs"] - a["endMs"] for a, b in zip(cues, cues[1:])]
    read = [g for g, b in zip(gaps, cues[1:]) if b["speaker"] == "Pilot"]
    exch = [g for g, b in zip(gaps, cues[1:]) if b["speaker"] == "Tower"]
    rep.check(order and inside, "cues sorted, non-overlapping, inside the audio",
              f"readback gaps {min(read)}-{max(read)} ms, exchange gaps {min(exch) / 1000:.1f}-{max(exch) / 1000:.1f} s")
    rep.info("exchange gaps (s): " + " ".join(f"{g / 1000:.1f}" for g in exch))

    lufs, true_peak = ffmpeg_lufs(mp3)
    peak = 20.0 * math.log10(float(np.max(np.abs(x))) + 1e-12)
    rep.check(abs(lufs + 16.0) <= 1.0, "integrated loudness about -16 LUFS (ffmpeg ebur128)", f"{lufs:.1f} LUFS")
    clipped = int(np.sum(np.abs(x) >= 0.999))
    rep.check(peak < -0.5 and true_peak < 0.0 and clipped == 0, "no clipping",
              f"sample peak {peak:.1f} dBFS, true peak {true_peak:.1f} dBTP, {clipped} samples at full scale")

    # Energy inside each cue vs the gaps (300 ms guard keeps key clicks / squelch tails out of the gaps).
    guard = int(0.3 * sr)
    mask = np.zeros(len(x), dtype=bool)
    near = np.zeros(len(x), dtype=bool)
    cue_db = []
    for c in cues:
        a, b = int(c["startMs"] * sr / 1000), int(c["endMs"] * sr / 1000)
        mask[a:b] = True
        near[max(0, a - guard): b + guard] = True
        cue_db.append(dbfs(x[a:b]))
    gap = x[~near]
    win = int(0.2 * sr)
    gap_win = [dbfs(gap[i: i + win]) for i in range(0, len(gap) - win, win)]
    rep.check(min(cue_db) - max(gap_win) >= 25.0, "every cue is far louder than any gap",
              f"cue RMS {min(cue_db):.1f}..{max(cue_db):.1f} dBFS; gaps mean {dbfs(gap):.1f}, loudest 200 ms {max(gap_win):.1f} dBFS; "
              f"margin {min(cue_db) - max(gap_win):.1f} dB")
    between = x[~mask]
    rep.info(f"everything outside cue windows (incl. clicks and squelch tails): {dbfs(between):.1f} dBFS")

    # Where does speech really start/stop?  10 ms frames, threshold 15 dB under the cue's median frame level.
    fr = int(0.010 * sr)
    env = np.sqrt(np.convolve(np.square(x), np.ones(fr) / fr, mode="same"))
    on_err, off_err = [], []
    for c in cues:
        a, b = int(c["startMs"] * sr / 1000), int(c["endMs"] * sr / 1000)
        thr = np.median(env[a:b]) * 10 ** (-15.0 / 20.0)
        lo = a - int(0.035 * sr)  # after the key click, before the first word
        hits = np.nonzero(env[lo: a + int(0.4 * sr)] > thr)[0]
        on_err.append((lo + hits[0] - a) * 1000.0 / sr if len(hits) else 999.0)
        hi = b + int(0.035 * sr)  # before the squelch burst
        hits = np.nonzero(env[b - int(0.4 * sr): hi] > thr)[0]
        off_err.append((b - int(0.4 * sr) + hits[-1] - b) * 1000.0 / sr if len(hits) else -999.0)
    rep.check(max(abs(e) for e in on_err) <= 60.0 and max(abs(e) for e in off_err) <= 60.0,
              "speech starts/stops where the cues say (detected edge minus cue time)",
              f"onsets {min(on_err):+.0f}..{max(on_err):+.0f} ms (median {np.median(on_err):+.0f}), "
              f"offsets {min(off_err):+.0f}..{max(off_err):+.0f} ms (median {np.median(off_err):+.0f})")

    speech = x[mask]
    f, p = signal.welch(speech, fs=sr, nperseg=2048)
    share = float(p[(f >= 300) & (f <= 3400)].sum() / p.sum())
    rep.check(share >= 0.9, "speech band (300-3400 Hz) dominates inside cues", f"{share * 100:.1f} % of the energy")
    return x


def check_tracks(rep: Report, m: dict, rwys: list[Rwy], ref, elev: float) -> None:
    worst = {"range": 0.0, "fast_xt": 0.0, "slow_off": 0.0, "speed_rel": 0.0, "speed_abs": 0.0, "turn": 0.0,
             "hdg": 0.0, "vs_up": 0.0, "vs_down": 0.0, "accel": 0.0, "decel": 0.0}
    ok_steps = ok_ground = ok_elev = ok_speed = ok_env = True
    n_samples = 0
    for cs, tr in m["tracks"].items():
        n_samples += len(tr)
        steps = {b["tMs"] - a["tMs"] for a, b in zip(tr, tr[1:])}
        ok_steps &= steps <= {500, 1000} and tr[0]["tMs"] % 1000 == 0
        for s in tr:
            p = (s["lat"], s["lon"])
            worst["range"] = max(worst["range"], haversine(p, ref) / NM)
            if s["onGround"]:
                ok_elev &= s["altitudeFt"] == elev
                d = min(r.dist(p) for r in rwys)
                if d <= ON_CENTRELINE_M:
                    if s["speedKt"] > TAXI_KT:
                        worst["fast_xt"] = max(worst["fast_xt"], d)
                else:
                    worst["slow_off"] = max(worst["slow_off"], d)
                    ok_ground &= s["speedKt"] <= TAXI_KT and d <= NEAR_RUNWAY_M
            else:
                ok_elev &= s["altitudeFt"] >= elev
        for a, b in zip(tr, tr[1:]):
            dt = (b["tMs"] - a["tMs"]) / 1000.0
            dist = haversine((a["lat"], a["lon"]), (b["lat"], b["lon"]))
            implied = dist / dt / KT
            mean = (a["speedKt"] + b["speedKt"]) / 2.0
            err = abs(implied - mean)
            lo, hi = min(a["speedKt"], b["speedKt"]), max(a["speedKt"], b["speedKt"])
            ok_speed &= err <= max(SPEED_TOL * mean, SPEED_TOL_KT)
            ok_speed &= (1 - SPEED_TOL) * lo - SPEED_TOL_KT <= implied <= (1 + SPEED_TOL) * hi + SPEED_TOL_KT
            if mean >= 20.0:
                worst["speed_rel"] = max(worst["speed_rel"], err / mean)
            worst["speed_abs"] = max(worst["speed_abs"], err)
            worst["turn"] = max(worst["turn"], abs(angle_diff(b["heading"], a["heading"])) / dt)
            if dist > 3.0:
                mid = (a["heading"] + angle_diff(b["heading"], a["heading"]) / 2.0) % 360.0
                worst["hdg"] = max(worst["hdg"], abs(angle_diff(bearing((a["lat"], a["lon"]), (b["lat"], b["lon"])), mid)))
            vs = (b["altitudeFt"] - a["altitudeFt"]) / dt * 60.0
            worst["vs_up"], worst["vs_down"] = max(worst["vs_up"], vs), min(worst["vs_down"], vs)
            acc = (b["speedKt"] - a["speedKt"]) * KT / dt
            worst["accel"], worst["decel"] = max(worst["accel"], acc), min(worst["decel"], acc)
    ok_env = worst["vs_up"] <= 3300 and worst["vs_down"] >= -1100 and worst["accel"] <= 3.3 and worst["decel"] >= -3.3
    rep.check(ok_steps, "samples every 1000 ms (500 ms in turns), sorted", f"{n_samples} samples, {len(m['tracks'])} aircraft")
    rep.check(worst["range"] <= MAX_RANGE_NM, "everything within 6 nm of the field", f"max {worst['range']:.2f} nm")
    rep.check(ok_elev, "altitude is field elevation on the ground, above it in the air", f"elevation {elev:.0f} ft")
    rep.check(ok_ground, "ground samples on a runway centreline, or slow and near a runway",
              f"faster than {TAXI_KT:.0f} kt: max {worst['fast_xt']:.1f} m off a centreline (limit {ON_CENTRELINE_M:.0f}); "
              f"holding/lining up/vacating: max {worst['slow_off']:.0f} m from a runway (limit {NEAR_RUNWAY_M:.0f})")
    rep.check(ok_speed, "stated speed matches the position deltas (15 %)",
              f"max error {worst['speed_rel'] * 100:.1f} % above 20 kt, {worst['speed_abs']:.1f} kt absolute")
    rep.check(worst["turn"] <= MAX_TURN_DEG_S, "heading change <= 25 deg/s", f"max {worst['turn']:.1f} deg/s")
    rep.check(worst["hdg"] <= 5.0, "heading is the direction of travel", f"max {worst['hdg']:.1f} deg off the track made good")
    rep.check(ok_env, "plausible climb/descent and acceleration",
              f"vertical {worst['vs_down']:.0f}..{worst['vs_up']:+.0f} fpm, acceleration {worst['decel']:.2f}..{worst['accel']:+.2f} m/s2")


def describe_flights(rep: Report, m: dict, rwys: list[Rwy], elev: float) -> dict:
    """Classify each track and check the takeoff / landing / go-around profile."""
    kinds = {}
    for cs, tr in m["tracks"].items():
        g0, g1 = tr[0]["onGround"], tr[-1]["onGround"]
        moving = [s for s in tr if s["speedKt"] > 0]
        if g0 and not moving:
            r = nearest_runway(rwys, (tr[0]["lat"], tr[0]["lon"]))
            a, x = r.rel((tr[0]["lat"], tr[0]["lon"]))
            kinds[cs] = ("parked", r)
            rep.info(f"{cs}: holds short of {r.ident} all clip, {abs(x):.0f} m from the centreline, heading {tr[0]['heading']:.0f}")
        elif g0:
            fast = [s for s in tr if s["onGround"] and s["speedKt"] > 60] or moving
            r = nearest_runway(rwys, (fast[-1]["lat"], fast[-1]["lon"]), fast[-1]["heading"])
            kinds[cs] = ("departure", r)
            air = [s for s in tr if not s["onGround"]]
            start = r.rel((tr[0]["lat"], tr[0]["lon"]))
            where = "lined up" if abs(start[1]) < 5 else f"holding short {abs(start[1]):.0f} m off the centreline"
            if air:
                lift = air[0]
                i = tr.index(lift)
                roll0 = next(s for s in tr[: i] if s["speedKt"] > 0 and all(q["speedKt"] > 0 for q in tr[tr.index(s): i]))
                rot = tr[i - 1]["speedKt"]
                roll_s = (lift["tMs"] - roll0["tMs"]) / 1000.0
                climb = [(b["altitudeFt"] - a["altitudeFt"]) / (b["tMs"] - a["tMs"]) * 60000.0 for a, b in zip(air, air[1:])]
                top = max(climb) if climb else 0.0
                a_lift = r.rel((lift["lat"], lift["lon"]))[0]
                mean_acc = rot * KT / roll_s
                rep.check(135 <= rot <= 172 and 2.0 <= mean_acc <= 2.9 and a_lift < r.length and 2400 <= top <= 3100,
                          f"{cs} takeoff profile ({r.ident})",
                          f"starts {where}; roll from {roll0['tMs'] / 1000:.0f} s, airborne {lift['tMs'] / 1000:.0f} s at {rot} kt "
                          f"({mean_acc:.2f} m/s2 mean) {a_lift:.0f} m down a {r.length:.0f} m runway; climb up to {top:.0f} fpm; "
                          f"ends {tr[-1]['altitudeFt'] - elev:.0f} ft AGL")
            else:
                rep.info(f"{cs}: starts {where} on {r.ident}; still on the ground at clip end, {tr[-1]['speedKt']} kt")
        else:
            r = nearest_runway(rwys, (tr[0]["lat"], tr[0]["lon"]), tr[0]["heading"], airborne=not tr[0]["onGround"])
            d0 = -(r.rel((tr[0]["lat"], tr[0]["lon"]))[0] - r.displaced)
            # glidepath angle while descending, more than 0.3 nm from the landing threshold
            angles = []
            for s in tr:
                d = -(r.rel((s["lat"], s["lon"]))[0] - r.displaced)
                if not s["onGround"] and d > 0.3 * NM and s["altitudeFt"] <= tr[0]["altitudeFt"] and tr.index(s) < len(tr) - 1 \
                        and tr[tr.index(s) + 1]["altitudeFt"] < s["altitudeFt"]:
                    angles.append(math.degrees(math.atan2((s["altitudeFt"] - elev - 50.0) * FT, d)))
            xt = max(abs(r.rel((s["lat"], s["lon"]))[1]) for s in tr if not s["onGround"])
            if g1:
                kinds[cs] = ("arrival", r)
                td = next(s for s in tr if s["onGround"])
                a_td = r.rel((td["lat"], td["lon"]))[0]
                prev = tr[tr.index(td) - 1]
                a_prev = r.rel((prev["lat"], prev["lon"]))[0]
                side = r.rel((tr[-1]["lat"], tr[-1]["lon"]))[1]
                rep.check(2.8 <= min(angles) and max(angles) <= 3.2 and xt < 5 and (a_prev - r.displaced) / FT <= 1500 and (a_td - r.displaced) / FT >= 1000 - 250,
                          f"{cs} landing profile ({r.ident})",
                          f"appears {d0 / NM:.2f} nm out at {tr[0]['altitudeFt'] - elev:.0f} ft AGL, {tr[0]['speedKt']} kt; glidepath {min(angles):.2f}-{max(angles):.2f} deg, "
                          f"max {xt:.1f} m off the extended centreline; wheels down between {(a_prev - r.displaced) / FT:.0f} and {(a_td - r.displaced) / FT:.0f} ft past the landing threshold "
                          f"(displaced {r.displaced / FT:.0f} ft) at {td['tMs'] / 1000:.0f} s, {td['speedKt']} kt; ends {abs(side):.0f} m {'right' if side > 0 else 'left'} of the centreline "
                          f"at {tr[-1]['speedKt']} kt, t={tr[-1]['tMs'] / 1000:.0f} s")
            else:
                kinds[cs] = ("go-around", r)
                low = min(tr, key=lambda s: s["altitudeFt"])
                d_low = -(r.rel((low["lat"], low["lon"]))[0] - r.displaced)
                rep.check(2.8 <= min(angles) and max(angles) <= 3.2 and xt < 5 and 200 <= low["altitudeFt"] - elev <= 300 and d_low > 0,
                          f"{cs} go-around profile ({r.ident})",
                          f"appears {d0 / NM:.2f} nm out at {tr[0]['altitudeFt'] - elev:.0f} ft AGL, {tr[0]['speedKt']} kt; glidepath {min(angles):.2f}-{max(angles):.2f} deg; "
                          f"lowest {low['altitudeFt'] - elev:.0f} ft AGL at {low['tMs'] / 1000:.0f} s, {d_low / NM:.2f} nm before the threshold; "
                          f"ends {tr[-1]['altitudeFt']} ft MSL, {tr[-1]['speedKt']} kt, max {xt:.1f} m off the centreline")
    return kinds


def on_runway(s: dict, r: Rwy, half: float = 30.0) -> bool:
    a, x = r.rel((s["lat"], s["lon"]))
    return s["onGround"] and abs(x) <= half and -80.0 <= a <= r.length + 80.0


def check_story(rep: Report, m: dict, rwys: list[Rwy], kinds: dict) -> None:
    tracks = m["tracks"]
    cues = m["cues"]

    def state(cs, t):
        return at_time(tracks[cs], t)

    # 1. every aircraft is on the map for the whole of each transmission about it
    vis = all(tracks[c["callsign"]][0]["tMs"] <= c["startMs"] and c["endMs"] <= tracks[c["callsign"]][-1]["tMs"] for c in cues)
    rep.check(vis, "aircraft visible during every cue that concerns it")

    problems = []
    notes = []
    for c in cues:
        cs, text, t0, t1 = c["callsign"], c["text"].lower(), c["startMs"], c["endMs"]
        s0, s1 = state(cs, t0), state(cs, t1)
        if c["speaker"] != "Tower" or s0 is None or s1 is None:
            continue
        p0 = (s0["lat"], s0["lon"])
        if "cleared for takeoff" in text:
            r = nearest_runway(rwys, p0, s0["heading"])
            a, x = r.rel(p0)
            lined = s0["onGround"] and abs(x) < 3 and abs(angle_diff(s0["heading"], r.bearing)) < 2 and s0["speedKt"] == 0
            still = s1["speedKt"] == 0
            others = [o for o in tracks if o != cs and (so := state(o, t0)) and on_runway(so, r)]
            others_end = [o for o in tracks if o != cs and (so := state(o, t1)) and on_runway(so, r)]
            if not (lined and still and not others and not others_end):
                problems.append(f"{c['id']} takeoff clearance {cs}: lined_up={lined} waits={still} runway occupied by {others or others_end}")
            notes.append(f"{c['id']} {cs} cleared for takeoff {r.ident}: lined up {a:.0f} m from the runway end, stationary, runway otherwise empty")
        elif "line up and wait" in text:
            r = min(rwys, key=lambda q: q.dist(p0))
            a, x = r.rel(p0)
            if not (s0["onGround"] and s0["speedKt"] == 0 and abs(x) > 60 and s1["speedKt"] == 0):
                problems.append(f"{c['id']} line up and wait {cs}: not holding short and stationary until the instruction ends")
        elif "hold short" in text and s0["speedKt"] == 0:
            if not (s0["onGround"] and s1["speedKt"] == 0 and min(abs(q.rel(p0)[1]) for q in rwys if q.dist(p0) < 200) > 60):
                problems.append(f"{c['id']} hold short {cs}: not stationary clear of the runway")
        elif "contact" in text and "departure" in text:
            if s0["onGround"]:
                problems.append(f"{c['id']} handoff {cs}: still on the ground")
            notes.append(f"{c['id']} {cs} handed to departure at {s0['altitudeFt'] - tracks[cs][0]['altitudeFt'] if kinds[cs][0] == 'departure' else s0['altitudeFt']:.0f} ft "
                         f"{'AGL' if kinds[cs][0] == 'departure' else 'MSL'}, {s0['speedKt']:.0f} kt")
        elif "cleared to land" in text or text.rstrip(".").endswith("continue"):
            r = kinds[cs][1]
            d0, d1 = (-(r.rel((s["lat"], s["lon"]))[0] - r.displaced) / NM for s in (s0, s1))
            if s1["onGround"] or d1 <= 0:
                problems.append(f"{c['id']} {cs}: clearance finishes after the threshold")
            notes.append(f"{c['id']} {cs} '{'cleared to land' if 'land' in text else 'continue'}' {r.ident}: {d0:.2f} nm final at the start of the call, {d1:.2f} nm at the end")
        elif "go around" in text:
            r = kinds[cs][1]
            d0 = -(r.rel(p0)[0] - r.displaced) / NM
            blockers = [o for o in tracks if o != cs and (so := state(o, t0)) and on_runway(so, r)]
            if s0["onGround"] or not blockers:
                problems.append(f"{c['id']} go-around {cs}: no traffic on the runway")
            notes.append(f"{c['id']} {cs} told to go around at {d0:.2f} nm final, {s0['altitudeFt']:.0f} ft; on the runway: {', '.join(blockers)}")
        elif re.search(r"turn (left|right)", text):
            side = re.search(r"turn (left|right)", text).group(1)
            r = kinds[cs][1]
            end = tracks[cs][-1]
            x_end = r.rel((end["lat"], end["lon"]))[1]
            x0 = r.rel(p0)[1]
            first_off = next((s for s in tracks[cs] if s["onGround"] and abs(r.rel((s["lat"], s["lon"]))[1]) > 1.0), None)
            ok = s0["onGround"] and abs(x0) < 3 and (x_end > 20 if side == "right" else x_end < -20) and first_off and first_off["tMs"] >= t1
            if not ok:
                problems.append(f"{c['id']} {cs} turn {side}: on runway at call={s0['onGround'] and abs(x0) < 3}, ends {x_end:.0f} m, leaves centreline at {first_off['tMs'] if first_off else None}")
            hdg_off = angle_diff(end["heading"], r.bearing)
            notes.append(f"{c['id']} {cs} told to turn {side} while rolling at {s0['speedKt']:.0f} kt; leaves the centreline at {first_off['tMs'] / 1000:.1f} s "
                         f"(call ends {t1 / 1000:.1f} s), turn-off {hdg_off:+.0f} deg, ends {abs(x_end):.0f} m {'right' if x_end > 0 else 'left'}")
    # 2. nobody moves before being told to
    for cs, tr in tracks.items():
        if tr[0]["onGround"] and tr[0]["speedKt"] == 0:
            first_move = next((s["tMs"] for s in tr if s["speedKt"] > 0), None)
            if first_move is not None:
                told = [c for c in cues if c["callsign"] == cs and c["speaker"] == "Tower"
                        and ("line up" in c["text"].lower() or "cleared for takeoff" in c["text"].lower())]
                if not told or first_move < told[0]["endMs"]:
                    problems.append(f"{cs} starts moving at {first_move} ms before being instructed")
    rep.check(not problems, "every instruction matches what the aircraft is doing", "; ".join(problems))
    for n in notes:
        rep.info(n)

    # 3. same runway: a fast aircraft never has another aircraft on the runway ahead of it
    conflicts = []
    t_end = m["durationMs"]
    for t in range(0, t_end + 1, 500):
        states = {cs: s for cs in tracks if (s := state(cs, t)) is not None and s["onGround"]}
        for cs, s in states.items():
            if s["speedKt"] <= 40:
                continue
            r = nearest_runway(rwys, (s["lat"], s["lon"]), s["heading"])
            a = r.rel((s["lat"], s["lon"]))[0]
            for o, so in states.items():
                if o != cs and on_runway(so, r) and r.rel((so["lat"], so["lon"]))[0] > a:
                    conflicts.append(f"{t} ms: {cs} at {s['speedKt']:.0f} kt with {o} ahead on {r.ident}")
    rep.check(not conflicts, "no aircraft rolls at speed toward another on the same runway", "; ".join(conflicts[:3]))

    # 4. crossing runways are never used at the same time
    crossing_notes = []
    cross_ok = True
    seen = set()
    for ra in rwys:
        for rb in rwys:
            if ra is rb or abs(abs(angle_diff(ra.bearing, rb.bearing)) - 90.0) > 60.0:
                continue
            users_a = [cs for cs, (k, r) in kinds.items() if r is ra and k in ("departure", "arrival")]
            users_b = [cs for cs, (k, r) in kinds.items() if r is rb and k in ("departure", "arrival")]
            for ca in users_a:
                for cb in users_b:
                    if (cb, ca) in seen:
                        continue
                    seen.add((ca, cb))
                    # intersection: point on ra with zero cross-track from rb
                    def passage(cs, own, other):
                        prev = None
                        for s in tracks[cs]:
                            x = other.rel((s["lat"], s["lon"]))[1]
                            a_other = other.rel((s["lat"], s["lon"]))[0]
                            if prev is not None and (prev[0] < 0) != (x < 0) and -50 <= a_other <= other.length + 50:
                                u = prev[0] / (prev[0] - x)
                                return prev[1] + (s["tMs"] - prev[1]) * u, s
                            prev = (x, s["tMs"])
                        return None, None
                    ta, sa = passage(ca, ra, rb)
                    tb, sb = passage(cb, rb, ra)
                    if ta is None or tb is None:
                        continue
                    cross_ok &= abs(ta - tb) >= 15000
                    crossing_notes.append(
                        f"{ra.ident}x{rb.ident}: {ca} crosses at {ta / 1000:.1f} s ({'on the ground' if sa['onGround'] else 'airborne'}, {sa['speedKt']} kt), "
                        f"{cb} at {tb / 1000:.1f} s ({'on the ground' if sb['onGround'] else 'airborne'}, {sb['speedKt']} kt)")
    if crossing_notes:
        rep.check(cross_ok, "crossing runways: at least 15 s between users of an intersection")
        for n in crossing_notes:
            rep.info(n)
        for c in cues:
            if c["speaker"] == "Tower" and "cleared for takeoff" in c["text"].lower():
                cs = c["callsign"]
                r = kinds[cs][1]
                for other, (k, rb) in kinds.items():
                    if k == "arrival" and abs(abs(angle_diff(r.bearing, rb.bearing)) - 90.0) < 60.0:
                        s = state(other, c["startMs"])
                        a_cross = None
                        # along-track position (on rb) of the crossing with r
                        for q in tracks[other]:
                            pass
                        x_now = r.rel((s["lat"], s["lon"]))[1]
                        first = tracks[other][0]
                        x_first = r.rel((first["lat"], first["lon"]))[1]
                        through = (x_now < 0) != (x_first < 0)
                        rep.check(through and abs(x_now) >= 60.0,
                                  f"{c['id']}: {other} is through the {rb.ident}/{r.ident} intersection when {cs} is cleared for takeoff",
                                  f"{abs(x_now):.0f} m past the {r.ident} centreline, {s['speedKt']:.0f} kt")


# --- optional: transcribe the cues ------------------------------------------

_UNITS = {"zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
          "nine": 9, "niner": 9}
_TEENS = {"ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
          "seventeen": 17, "eighteen": 18, "nineteen": 19}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}


def normalise(text: str) -> list[str]:
    """Lower-case words with every spoken number collapsed to digits ('twenty ninety-nine' -> '2099')."""
    text = text.lower().replace("-", " ").replace("o'hare", "ohare").replace("o’hare", "ohare")
    text = re.sub(r"(\d)[.,](\d)", r"\1 point \2", text)
    words = re.findall(r"[a-z']+|\d+", text)
    out: list[str] = []
    i = 0
    while i < len(words):
        w = words[i]
        digits = None
        if w.isdigit():
            digits = w
        elif w in _UNITS:
            digits = str(_UNITS[w])
        elif w in _TEENS:
            digits = str(_TEENS[w])
        elif w in _TENS:
            if i + 1 < len(words) and words[i + 1] in _UNITS and words[i + 1] not in ("zero", "oh"):
                digits = str(_TENS[w] + _UNITS[words[i + 1]])
                i += 1
            else:
                digits = str(_TENS[w])
        elif w == "thousand" and out and out[-1].isdigit():
            out[-1] += "000"
            i += 1
            continue
        elif w == "hundred" and out and out[-1].isdigit():
            out[-1] += "00"
            i += 1
            continue
        elif w == "triple" and i + 1 < len(words) and (words[i + 1] in _UNITS or words[i + 1].isdigit()):
            d = str(_UNITS.get(words[i + 1], words[i + 1]))
            digits = d * 3
            i += 1
        if digits is not None:
            if out and out[-1].isdigit():
                out[-1] += digits
            else:
                out.append(digits)
        else:
            out.append({"jetblue": "jetblue", "skywest": "skywest", "norcal": "norcal", "takeoff": "takeoff"}.get(w, w))
        i += 1
    joined = " ".join(out)
    for a, b in (("jet blue", "jetblue"), ("sky west", "skywest"), ("nor cal", "norcal"), ("speed bird", "speedbird"),
                 ("take off", "takeoff"), ("south west", "southwest"), ("line up", "lineup"), ("go around", "goaround"),
                 ("going around", "goingaround"), ("juliette", "juliet")):
        joined = joined.replace(a, b)
    return joined.split()


def word_errors(ref: list[str], hyp: list[str]) -> int:
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
    return d[-1]


def check_asr(rep: Report, m: dict, x: np.ndarray, sr: int, model) -> None:
    total_ref = total_err = 0
    worst = []
    for c in m["cues"]:
        a, b = int((c["startMs"] - 120) * sr / 1000), int((c["endMs"] + 60) * sr / 1000)
        seg = signal.resample_poly(x[max(0, a): b], 16000, sr).astype(np.float32)
        segments, _ = model.transcribe(seg, language="en", beam_size=5, condition_on_previous_text=False,
                                       initial_prompt="Air traffic control tower radio: callsigns, runways, wind, frequencies.")
        hyp_text = " ".join(s.text.strip() for s in segments)
        ref, hyp = normalise(c["text"]), normalise(hyp_text)
        err = word_errors(ref, hyp)
        total_ref += len(ref)
        total_err += err
        worst.append((err / max(1, len(ref)), c["id"], c["speaker"], c["callsign"], hyp_text))
    wer = total_err / total_ref
    rep.check(wer <= 0.15, "speech-to-text of the finished audio matches the cue text (Whisper, numbers normalised)",
              f"word error rate {wer * 100:.1f} % over {total_ref} words")
    for e, cid, spk, cs, hyp in sorted(worst, reverse=True)[:4]:
        if e > 0:
            rep.info(f"{cid} {spk} {cs} ({e * 100:.0f} % off): heard \"{hyp}\"")


def verify_clip(clip_dir: Path, clip_id: str, airport_json: Path, asr_model) -> Report:
    rep = Report(clip_id)
    m = json.loads((clip_dir / "manifest.json").read_text(encoding="utf-8"))
    check_schema(rep, m, clip_id)
    x = check_audio(rep, m, clip_dir / "audio.mp3")
    rwys, ref, elev, _ = load_airport(airport_json, m["airport"])
    if elev is None:
        elev = min(s["altitudeFt"] for tr in m["tracks"].values() for s in tr)
    check_tracks(rep, m, rwys, ref, elev)
    kinds = describe_flights(rep, m, rwys, elev)
    check_story(rep, m, rwys, kinds)
    if asr_model is not None:
        sr = int(ffprobe(clip_dir / "audio.mp3")["streams"][0]["sample_rate"])
        check_asr(rep, m, x, sr, asr_model)
    return rep


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--clips-dir", type=Path, default=REPO / "public" / "clips")
    ap.add_argument("--airport-data", type=Path, default=REPO / "src" / "api" / "airportData.json")
    ap.add_argument("--asr", metavar="MODEL", help="faster-whisper model directory or name; transcribe every cue")
    args = ap.parse_args()

    index = json.loads((args.clips_dir / "index.json").read_text(encoding="utf-8"))
    asr_model = None
    if args.asr:
        from faster_whisper import WhisperModel

        asr_model = WhisperModel(args.asr, device="cpu", compute_type="int8")

    failed = 0
    for entry in index["clips"]:
        clip_dir = args.clips_dir / entry["id"]
        rep = verify_clip(clip_dir, entry["id"], args.airport_data, asr_model)
        m = json.loads((clip_dir / "manifest.json").read_text(encoding="utf-8"))
        same = all(entry.get(k) == m.get(k) for k in ("id", "title", "description", "airport", "stationId", "durationMs"))
        rep.check(same and set(entry) == {"id", "title", "description", "airport", "stationId", "durationMs"},
                  "index.json entry matches the manifest")
        print(f"{entry['id']}  ({m['durationMs'] / 1000:.0f} s)")
        print("\n".join(rep.lines))
        failed += len(rep.failures)
    print(f"\n{'ALL CHECKS PASSED' if not failed else f'{failed} CHECK(S) FAILED'} for {len(index['clips'])} clips")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

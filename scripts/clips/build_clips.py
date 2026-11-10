#!/usr/bin/env python3
"""Build the synthetic tower-radio "clip packs" served from public/clips/.

Every clip is fully synthetic: the voices are neural TTS (Piper), the radio
sound is DSP, and the aircraft tracks are simulated along the real runway
geometry in src/api/airportData.json.  Nothing is recorded from a real
frequency.

Setup (Python 3.10+, ffmpeg/ffprobe on PATH):

    python3 -m pip install -r scripts/clips/requirements.txt

Run (from anywhere; paths are resolved relative to the repository):

    python3 scripts/clips/build_clips.py            # build all three clips
    python3 scripts/clips/build_clips.py --only jfk-tower-go-around
    python3 scripts/clips/verify_clips.py           # check the result

Outputs, per scenario in scenarios.py:

    public/clips/<id>/audio.mp3      mono, 22.05 kHz, 32 kbps
    public/clips/<id>/manifest.json  cues, aircraft and tracks on the audio's timeline
    public/clips/index.json          catalogue of the clips, in scenario order

The first run downloads the Piper voice models (~260 MB, checksummed) from
https://huggingface.co/rhasspy/piper-voices into scripts/clips/.cache/ (git
ignored; override with --cache or $ATC_CLIPS_CACHE) and caches each
synthesised line there, so later runs take a few seconds.  Outbound HTTPS
honours HTTPS_PROXY / SSL_CERT_FILE.

Voices (licences as stated on each model card in rhasspy/piper-voices):

    en_US-libritts-high   LibriTTS, CC BY 4.0, trained from scratch (pilots, JFK/SFO tower)
    en_US-joe-medium      OHF-Voice dataset, CC0 (O'Hare tower)
    en_GB-cori-medium     Hi-Fi TTS / LibriVox reader Cori Samuel, CC BY 4.0 (Speedbird)

How it fits together:

    scenarios.py   the scripts: who says what, and how the aircraft react
    tts.py         Piper wrapper (download, seeded synthesis, cache)
    radiofx.py     the VHF radio treatment and loudness measurement
    kinematics.py  runway geometry + takeoff/landing/go-around models
    build_clips.py timeline layout, mixing, MP3 encoding, manifest writing

Timing is derived, not hand-typed: each line's length comes from its audio,
aircraft triggers come from cue times, and later cues wait for aircraft events
(lift-off, touchdown, clear of the crossing runway).  Change a line or a
voice and the cue times and tracks follow.  With the same Piper/onnxruntime
versions the output is repeatable; other versions may shift cue times by a
few milliseconds, which is why the manifests are always written together
with the audio.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))

from kinematics import NM, Airport, Trajectory  # noqa: E402
from radiofx import SPEECH_LEVEL, TOWER, band_noise, db, integrated_lufs, pilot_radio, soft_limit, transmit  # noqa: E402
from scenarios import SCENARIOS, Scenario  # noqa: E402
from tts import SR, Synth  # noqa: E402

TARGET_LUFS = -16.0
PEAK_CEILING_DB = -4.0  # sample-peak ceiling before encoding (a 32 kbps MP3 overshoots by 1-2 dB)
MP3_BITRATE = "32k"
VANISH_NM = 5.0  # departures disappear from the map this far from the field
HISS_DB = -56.0  # faint receiver hiss between transmissions, relative to speech


@dataclass
class Cue:
    id: str
    speaker: str
    callsign: str
    text: str
    start: float  # seconds, first speech sample
    end: float
    n0: int  # sample index of the first speech sample
    speech: np.ndarray


class Stage:
    """The shared timeline a scenario script talks and moves aircraft on."""

    def __init__(self, scenario: Scenario, apt: Airport, synth: Synth):
        self.scenario = scenario
        self.apt = apt
        self.synth = synth
        self.cues: list[Cue] = []
        self.movers: dict[str, object] = {}
        self.t_end = 0.0
        self.rng = np.random.default_rng(zlib.crc32(scenario.id.encode()))

    def add(self, callsign: str, mover):
        self.movers[callsign] = mover
        return mover

    def say(self, speaker: str, callsign: str, text: str, *, at: float | None = None,
            gap: float | None = None, not_before: float | None = None, take: int = 0) -> Cue:
        """Place the next transmission.

        ``at`` pins the start; otherwise it begins ``gap`` seconds after the
        previous transmission ended (default: a readback-sized pause for pilots,
        a couple of seconds for the tower) and never earlier than ``not_before``.
        """
        assert speaker in ("Tower", "Pilot")
        voice = self.scenario.tower if speaker == "Tower" else self.scenario.pilots[callsign]
        speech = self.synth.speak(voice, text, take)
        if at is None:
            if gap is None:
                gap = self.rng.uniform(0.40, 0.58) if speaker == "Pilot" else self.rng.uniform(1.7, 2.6)
            at = (self.cues[-1].end if self.cues else 0.0) + gap
            if not_before is not None:
                at = max(at, not_before)
        n0 = int(round(at * SR))
        cue = Cue(id=f"c{len(self.cues) + 1}", speaker=speaker, callsign=callsign, text=text,
                  start=n0 / SR, end=(n0 + len(speech)) / SR, n0=n0, speech=speech)
        self.cues.append(cue)
        return cue

    def end(self, t: float) -> None:
        self.t_end = max(self.t_end, t)


def render_audio(stage: Stage, n_total: int) -> np.ndarray:
    """Mix every transmission onto the clip timeline and normalise the loudness."""
    scen = stage.scenario
    rng = np.random.default_rng(zlib.crc32(("audio:" + scen.id).encode()))
    out = np.zeros(n_total)
    busy_until = 0
    for cue in stage.cues:
        radio = scen.tower_radio if cue.speaker == "Tower" else pilot_radio(zlib.crc32(cue.callsign.encode()))
        tx = transmit(cue.speech, radio, rng)
        a = cue.n0 - tx.speech_start
        if a < busy_until:
            raise RuntimeError(f"{scen.id} {cue.id}: transmission overlaps the previous one; widen the gap")
        if a + len(tx.audio) > n_total:
            raise RuntimeError(f"{scen.id} {cue.id}: transmission runs past the end of the clip")
        out[a : a + len(tx.audio)] += tx.audio
        busy_until = a + len(tx.audio)
    out += band_noise(n_total, rng, 300.0, 3400.0) * SPEECH_LEVEL * db(HISS_DB)
    return level(out, TARGET_LUFS)


def level(audio: np.ndarray, lufs: float) -> np.ndarray:
    """Scale to the given integrated loudness, rounding off any peaks above the ceiling."""
    for _ in range(3):
        audio = audio * db(lufs - integrated_lufs(audio))
        if np.max(np.abs(audio)) <= db(PEAK_CEILING_DB):
            break
        audio = soft_limit(audio, db(PEAK_CEILING_DB))
    return audio


MP3_FRAME = 576  # samples per MPEG-2 Layer III frame (22.05 kHz)


def _encode(audio: np.ndarray, path: Path) -> float:
    audio = audio.copy()
    fade = int(SR * 0.02)
    audio[:fade] *= np.linspace(0.0, 1.0, fade)
    audio[-fade:] *= np.linspace(1.0, 0.0, fade)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).round().astype("<i2").tobytes()
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1",
         "-i", "pipe:0", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
         "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-ar", str(SR), "-ac", "1", str(path)],
        input=pcm, check=True,
    )
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(probe.stdout.strip())


def _decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "pipe:1"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def encode_mp3(audio: np.ndarray, path: Path, target_s: float) -> tuple[float, np.ndarray]:
    """Write a mono MP3 of ``target_s`` seconds at TARGET_LUFS; returns (ffprobe duration, decoded PCM).

    Two things are corrected with a second encode:

    * an MP3 is a whole number of frames and carries ~1,100 samples of encoder
      delay, so the file comes out a few frames longer than the PCM fed in.  The
      quiet tail is trimmed by that many frames, which puts the container
      duration within half a frame (13 ms) of the target;
    * a 32 kbps encode loses a few tenths of a dB, so the loudness is measured
      on the decoded file and made up.
    """
    real = _encode(audio, path)
    extra = max(0, int(round(real * SR / MP3_FRAME)) - int(round(target_s * SR / MP3_FRAME)))
    lost = TARGET_LUFS - integrated_lufs(_decode(path))
    audio = level(audio[: len(audio) - extra * MP3_FRAME], TARGET_LUFS + lost)
    real = _encode(audio, path)
    return real, _decode(path)


def track_samples(stage: Stage, callsign: str, traj: Trajectory, t_end: float) -> list[dict]:
    apt = stage.apt
    # Departures leave the picture a few miles out.
    gone = traj.first_time(
        lambda i: not traj.ground[i] and traj.phase[i] == "climb" and math.hypot(traj.x[i], traj.y[i]) > VANISH_NM * NM
    )
    if gone is not None:
        t_end = min(t_end, math.floor(gone))
    return traj.samples(apt.frame, apt.elevation_ft, t_end)


def dump_manifest(manifest: dict) -> str:
    """JSON with one cue / one track sample per line (small, and diff-friendly)."""
    one = lambda v: json.dumps(v, ensure_ascii=False, separators=(", ", ": "))  # noqa: E731
    lines = ["{"]
    for key in ("id", "stationId", "airport", "audioUrl", "durationMs", "title", "description"):
        lines.append(f"  {json.dumps(key)}: {one(manifest[key])},")
    lines.append('  "cues": [')
    lines += [f"    {one(c)}{',' if i < len(manifest['cues']) - 1 else ''}" for i, c in enumerate(manifest["cues"])]
    lines.append("  ],")
    lines.append('  "aircraft": {')
    items = list(manifest["aircraft"].items())
    lines += [f"    {json.dumps(k)}: {one(v)}{',' if i < len(items) - 1 else ''}" for i, (k, v) in enumerate(items)]
    lines.append("  },")
    lines.append('  "tracks": {')
    items = list(manifest["tracks"].items())
    for i, (k, samples) in enumerate(items):
        lines.append(f"    {json.dumps(k)}: [")
        lines += [f"      {one(s)}{',' if j < len(samples) - 1 else ''}" for j, s in enumerate(samples)]
        lines.append(f"    ]{',' if i < len(items) - 1 else ''}")
    lines.append("  }")
    lines.append("}")
    return "\n".join(lines) + "\n"


def build_clip(scen: Scenario, synth: Synth, airport_json: Path, out_root: Path, verbose: bool) -> dict:
    apt = Airport.load(airport_json, scen.airport, scen.elevation_ft)
    stage = Stage(scen, apt, synth)
    scen.script(stage)

    # Whole seconds, so the 1 Hz track samples end exactly with the clip.
    t_end = float(math.ceil(max(stage.t_end, stage.cues[-1].end + 1.0)))
    n_total = int(round(t_end * SR))
    duration_ms = int(round(t_end * 1000))

    spoken_to = {c.callsign for c in stage.cues}
    missing = spoken_to - set(stage.movers)
    if missing:
        raise RuntimeError(f"{scen.id}: no track for {sorted(missing)}")
    tracks = {}
    trajectories = {}
    for callsign, mover in stage.movers.items():
        traj = mover.sim(t_end)
        trajectories[callsign] = traj
        tracks[callsign] = track_samples(stage, callsign, traj, t_end)
        first, last = tracks[callsign][0]["tMs"], tracks[callsign][-1]["tMs"]
        for c in stage.cues:
            if c.callsign == callsign and not (first <= c.start * 1000 and c.end * 1000 <= last):
                raise RuntimeError(f"{scen.id} {c.id}: {callsign} is not on the map during its own transmission")

    out_dir = out_root / scen.id
    out_dir.mkdir(parents=True, exist_ok=True)
    audio = render_audio(stage, n_total)
    real, decoded = encode_mp3(audio, out_dir / "audio.mp3", t_end)
    if abs(real * 1000.0 - duration_ms) > 30.0:
        raise RuntimeError(f"{scen.id}: encoded audio is {real:.3f}s, expected {t_end:.3f}s")

    manifest = {
        "id": scen.id,
        "stationId": scen.station_id,
        "airport": scen.airport,
        "audioUrl": f"/clips/{scen.id}/audio.mp3",
        "durationMs": duration_ms,
        "title": scen.title,
        "description": scen.description,
        "cues": [
            {
                "id": c.id,
                "startMs": int(round(c.start * 1000)),
                "endMs": int(round(c.end * 1000)),
                "text": c.text,
                "callsign": c.callsign,
                "speaker": c.speaker,
            }
            for c in stage.cues
        ],
        "aircraft": {cs: scen.aircraft[cs] for cs in stage.movers},
        "tracks": tracks,
    }
    (out_dir / "manifest.json").write_text(dump_manifest(manifest), encoding="utf-8")

    size_kb = (out_dir / "audio.mp3").stat().st_size / 1024.0
    print(f"{scen.id}: {t_end:.0f} s, {len(stage.cues)} cues, {len(tracks)} aircraft, "
          f"audio {real:.3f} s / {size_kb:.0f} KB, peak {20 * np.log10(np.max(np.abs(decoded))):.1f} dBFS, "
          f"{integrated_lufs(decoded):.1f} LUFS")
    if verbose:
        prev = 0.0
        for c in stage.cues:
            print(f"   {c.id:>3} {c.start:7.2f}-{c.end:7.2f} (gap {c.start - prev:5.2f}) {c.speaker:5} {c.callsign:8} {c.text}")
            prev = c.end
        for cs, traj in trajectories.items():
            ev = ", ".join(f"{k} {v:.1f}" for k, v in sorted(traj.events.items(), key=lambda kv: kv[1]))
            print(f"   {cs:8} track {tracks[cs][0]['tMs'] / 1000:.0f}-{tracks[cs][-1]['tMs'] / 1000:.0f} s; {ev}")
    return {
        "id": scen.id,
        "title": scen.title,
        "description": scen.description,
        "airport": scen.airport,
        "stationId": scen.station_id,
        "durationMs": duration_ms,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--only", action="append", help="build just this clip id (repeatable); index.json keeps the rest")
    ap.add_argument("--out", type=Path, default=REPO / "public" / "clips", help="output directory")
    ap.add_argument("--airport-data", type=Path, default=REPO / "src" / "api" / "airportData.json")
    ap.add_argument("--cache", type=Path, default=Path(os.environ.get("ATC_CLIPS_CACHE", HERE / ".cache")))
    ap.add_argument("-q", "--quiet", action="store_true", help="do not print the cue/event timeline")
    args = ap.parse_args()

    known = [s.id for s in SCENARIOS]
    for cid in args.only or []:
        if cid not in known:
            ap.error(f"unknown clip id {cid!r}; choose from {', '.join(known)}")

    synth = Synth(args.cache)
    args.out.mkdir(parents=True, exist_ok=True)
    index_path = args.out / "index.json"
    previous = {}
    if index_path.exists():
        previous = {c["id"]: c for c in json.loads(index_path.read_text(encoding="utf-8")).get("clips", [])}
    entries = []
    for scen in SCENARIOS:
        if args.only and scen.id not in args.only:
            if scen.id in previous:
                entries.append(previous[scen.id])
            continue
        entries.append(build_clip(scen, synth, args.airport_data, args.out, not args.quiet))
    index_path.write_text(json.dumps({"clips": entries}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {index_path}")


if __name__ == "__main__":
    main()

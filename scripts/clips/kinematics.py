"""Runway geometry and simple aircraft kinematics for the synthetic clip tracks.

Everything is simulated on a flat east/north plane (metres) centred on the
airport, with a fixed 50 ms step, and then sampled into the manifest's
``tracks`` format.  The models are deliberately small:

* ``Departure``  - optional hold-short -> line-up taxi, takeoff roll, rotation,
  climb on runway heading.
* ``Arrival``    - 3 degree final on the extended centreline, flare, rollout,
  optional runway exit (ending or holding), or a go-around.
* ``Parked``     - an aircraft that never moves (holding short all clip long).

Speeds are ground speeds; headings are true track.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path as FsPath

FT = 0.3048
NM = 1852.0
KT = NM / 3600.0  # metres per second in one knot
DT = 0.05  # simulation step, seconds (sample times are multiples of it)
GLIDE_DEG = 3.0
TCH_FT = 50.0  # threshold crossing height

_WGS84_A = 6378137.0
_WGS84_E2 = 0.00669437999014


def _metres_per_degree(lat: float) -> tuple[float, float]:
    """Length of one degree of latitude / longitude at ``lat`` (WGS-84)."""
    phi = math.radians(lat)
    s = math.sin(phi)
    w = math.sqrt(1.0 - _WGS84_E2 * s * s)
    m_lat = math.radians(1.0) * _WGS84_A * (1.0 - _WGS84_E2) / w**3
    m_lon = math.radians(1.0) * _WGS84_A / w * math.cos(phi)
    return m_lat, m_lon


class Frame:
    """Local east/north plane around a reference point."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0 = lat0
        self.lon0 = lon0

    def xy(self, lat: float, lon: float) -> tuple[float, float]:
        m_lat, m_lon = _metres_per_degree((lat + self.lat0) / 2.0)
        return (lon - self.lon0) * m_lon, (lat - self.lat0) * m_lat

    def latlon(self, x: float, y: float) -> tuple[float, float]:
        m_lat, _ = _metres_per_degree(self.lat0)
        lat = self.lat0 + y / m_lat
        m_lat, m_lon = _metres_per_degree((lat + self.lat0) / 2.0)
        lat = self.lat0 + y / m_lat
        return lat, self.lon0 + x / m_lon


def _fwd(hdg_deg: float) -> tuple[float, float]:
    h = math.radians(hdg_deg)
    return math.sin(h), math.cos(h)


def _right(hdg_deg: float) -> tuple[float, float]:
    h = math.radians(hdg_deg)
    return math.cos(h), -math.sin(h)


def smoothstep(u: float) -> float:
    u = 0.0 if u < 0.0 else 1.0 if u > 1.0 else u
    return u * u * (3.0 - 2.0 * u)


@dataclass
class Runway:
    """One landing/takeoff direction of a runway, in the airport frame."""

    ident: str
    x0: float  # threshold of this end
    y0: float
    x1: float  # opposite threshold
    y1: float
    length: float
    width: float
    bearing: float  # true bearing threshold -> far end, degrees
    displaced: float = 0.0  # landing threshold displacement from (x0, y0), metres

    def at(self, along: float, right: float = 0.0) -> tuple[float, float]:
        """Point ``along`` metres past the threshold, ``right`` metres right of the centreline."""
        fx, fy = _fwd(self.bearing)
        rx, ry = _right(self.bearing)
        return self.x0 + along * fx + right * rx, self.y0 + along * fy + right * ry

    def rel(self, x: float, y: float) -> tuple[float, float]:
        """(along, right) of a point relative to this runway."""
        fx, fy = _fwd(self.bearing)
        rx, ry = _right(self.bearing)
        dx, dy = x - self.x0, y - self.y0
        return dx * fx + dy * fy, dx * rx + dy * ry

    def crossing(self, other: "Runway") -> tuple[float, float] | None:
        """(along self, along other) of the centreline intersection, or None."""
        fx, fy = _fwd(self.bearing)
        gx, gy = _fwd(other.bearing)
        det = fx * (-gy) - (-gx) * fy
        if abs(det) < 1e-9:
            return None
        dx, dy = other.x0 - self.x0, other.y0 - self.y0
        a = (dx * (-gy) - (-gx) * dy) / det
        b = (fx * dy - fy * dx) / det
        if -1.0 <= a <= self.length + 1.0 and -1.0 <= b <= other.length + 1.0:
            return a, b
        return None


class Airport:
    """Runways + frequencies of one airport from ``src/api/airportData.json``."""

    def __init__(self, code: str, data: dict, elevation_ft: float | None = None):
        self.code = code
        self.elevation_ft = float(data.get("elevationFt", elevation_ft) if elevation_ft is None else elevation_ft)
        self.frequencies = data["frequencies"]
        ends = [e for r in data["runways"] for e in (r["le"], r["he"])]
        self.lat = data.get("lat", sum(e["lat"] for e in ends) / len(ends))
        self.lon = data.get("lon", sum(e["lon"] for e in ends) / len(ends))
        self.frame = Frame(self.lat, self.lon)
        self.runways: dict[str, Runway] = {}
        for r in data["runways"]:
            for a, b in ((r["le"], r["he"]), (r["he"], r["le"])):
                x0, y0 = self.frame.xy(a["lat"], a["lon"])
                x1, y1 = self.frame.xy(b["lat"], b["lon"])
                self.runways[a["ident"].lstrip("0")] = Runway(
                    ident=a["ident"].lstrip("0"),
                    x0=x0,
                    y0=y0,
                    x1=x1,
                    y1=y1,
                    length=math.hypot(x1 - x0, y1 - y0),
                    width=r["widthFt"] * FT,
                    bearing=math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360.0,
                    displaced=float(a.get("displacedFt") or 0.0) * FT,
                )

    @classmethod
    def load(cls, json_path: FsPath, code: str, elevation_ft: float | None = None) -> "Airport":
        with open(json_path, encoding="utf-8") as fh:
            return cls(code, json.load(fh)["airports"][code], elevation_ft)

    def runway(self, ident: str) -> Runway:
        return self.runways[ident.lstrip("0")]

    def frequency(self, kind: str, prefer: str | None = None) -> float:
        """Published frequency (MHz) of the given type; ``prefer`` matches the description."""
        rows = [f for f in self.frequencies if f["type"] == kind]
        if prefer is not None:
            exact = [f for f in rows if f["description"].upper() == prefer.upper()]
            part = [f for f in rows if prefer.upper() in f["description"].upper()]
            rows = exact or part or rows
        return rows[0]["mhz"]


class Path:
    """A ground/flight path made of straight legs and circular arcs, by arc length."""

    def __init__(self, x: float, y: float, hdg: float):
        self._segs: list[tuple] = []
        self._end = (x, y, hdg % 360.0)
        self.length = 0.0

    def straight(self, dist: float) -> "Path":
        x, y, h = self._end
        fx, fy = _fwd(h)
        self._segs.append((self.length, "line", x, y, h, dist, 0.0, 0.0))
        self._end = (x + dist * fx, y + dist * fy, h)
        self.length += dist
        return self

    def arc(self, radius: float, turn_deg: float) -> "Path":
        """Turn by ``turn_deg`` (positive = right) on a circle of ``radius`` metres."""
        x, y, h = self._end
        dist = radius * math.radians(abs(turn_deg))
        sign = 1.0 if turn_deg >= 0 else -1.0
        self._segs.append((self.length, "arc", x, y, h, dist, radius, sign))
        self._end = self._arc_pose(x, y, h, radius, sign, dist)
        self.length += dist
        return self

    @staticmethod
    def _arc_pose(x, y, h, radius, sign, d):
        rx, ry = _right(h)
        cx, cy = x + sign * radius * rx, y + sign * radius * ry
        h2 = h + sign * math.degrees(d / radius)
        rx2, ry2 = _right(h2)
        return cx - sign * radius * rx2, cy - sign * radius * ry2, h2 % 360.0

    def truncate(self, s: float) -> "Path":
        """Cut the path at arc length ``s`` (must lie on the last, straight leg)."""
        s0, kind, x, y, h, _dist, _r, _sg = self._segs[-1]
        assert kind == "line" and s >= s0, "can only truncate inside the final straight leg"
        self._segs[-1] = (s0, kind, x, y, h, s - s0, 0.0, 0.0)
        fx, fy = _fwd(h)
        self._end = (x + (s - s0) * fx, y + (s - s0) * fy, h)
        self.length = s
        return self

    def pose(self, s: float) -> tuple[float, float, float]:
        """(x, y, heading) at arc length ``s``; extrapolates straight past the end."""
        for s0, kind, x, y, h, dist, radius, sign in reversed(self._segs):
            if s >= s0:
                d = s - s0
                if d > dist:  # past the end of the last segment
                    x, y, h = self._end
                    fx, fy = _fwd(h)
                    return x + (s - self.length) * fx, y + (s - self.length) * fy, h
                if kind == "line":
                    fx, fy = _fwd(h)
                    return x + d * fx, y + d * fy, h
                return self._arc_pose(x, y, h, radius, sign, d)
        x, y, h = self._segs[0][2:5] if self._segs else self._end
        fx, fy = _fwd(h)
        return x + s * fx, y + s * fy, h


@dataclass
class Trajectory:
    """Simulation output: one state per 50 ms step, plus named event times (s)."""

    x: list[float] = field(default_factory=list)
    y: list[float] = field(default_factory=list)
    hdg: list[float] = field(default_factory=list)
    v: list[float] = field(default_factory=list)  # ground speed, m/s
    agl: list[float] = field(default_factory=list)  # feet above the field
    ground: list[bool] = field(default_factory=list)
    phase: list[str] = field(default_factory=list)
    events: dict[str, float] = field(default_factory=dict)

    def push(self, x, y, hdg, v, agl, ground, phase):
        self.x.append(x)
        self.y.append(y)
        self.hdg.append(hdg)
        self.v.append(v)
        self.agl.append(agl)
        self.ground.append(ground)
        self.phase.append(phase)

    def __len__(self) -> int:
        return len(self.x)

    @property
    def t_last(self) -> float:
        return (len(self.x) - 1) * DT

    def index(self, t: float) -> int:
        return max(0, min(len(self.x) - 1, int(round(t / DT))))

    def first_time(self, pred) -> float | None:
        """First step time at which ``pred(index)`` is true."""
        for i in range(len(self.x)):
            if pred(i):
                return i * DT
        return None

    def time_past(self, rwy: Runway, along: float) -> float | None:
        """First time the aircraft is ``along`` metres or more past ``rwy``'s threshold."""
        return self.first_time(lambda i: rwy.rel(self.x[i], self.y[i])[0] >= along)

    def samples(self, frame: Frame, elevation_ft: float, t_end: float | None = None) -> list[dict]:
        """Manifest track samples: every 1000 ms, plus the half second during turns."""
        step = int(round(1.0 / DT))
        half = step // 2
        last = len(self.x) - 1
        if t_end is not None:
            last = min(last, int(round(t_end / DT)))
        idx: list[int] = []
        i = 0
        while i <= last:
            idx.append(i)
            j = i + step
            if j <= last:
                turn = abs((self.hdg[j] - self.hdg[i] + 180.0) % 360.0 - 180.0)
                mid = abs((self.hdg[i + half] - self.hdg[i] + 180.0) % 360.0 - 180.0)
                if turn > 1.0 or mid > 0.5:
                    idx.append(i + half)
            i = j
        out = []
        for i in idx:
            lat, lon = frame.latlon(self.x[i], self.y[i])
            out.append(
                {
                    "tMs": int(round(i * DT * 1000)),
                    "lat": round(lat, 6),
                    "lon": round(lon, 6),
                    "heading": round(self.hdg[i] % 360.0, 1) % 360.0,
                    "altitudeFt": int(round(elevation_ft + (0.0 if self.ground[i] else self.agl[i]))),
                    "speedKt": int(round(self.v[i] / KT)),
                    "onGround": bool(self.ground[i]),
                }
            )
        return out


def _approach(v: float, v_des: float, accel: float, decel: float) -> float:
    """Move speed ``v`` toward ``v_des`` within the given acceleration limits (one step)."""
    if v < v_des:
        return min(v_des, v + accel * DT)
    return max(v_des, v - decel * DT)


def _climb_rate(t_since: float, climb_fpm: float, agl: float, level_agl_ft: float | None, ramp_s: float) -> float:
    """Vertical speed (ft/s) for a climb that eases in and captures a level-off altitude."""
    vs = climb_fpm / 60.0 * smoothstep(t_since / ramp_s)
    if level_agl_ft is not None:
        vs = min(vs, max(0.0, level_agl_ft - agl) * 0.12)
    return vs


class Parked:
    """An aircraft that holds its position for the whole clip."""

    def __init__(self, x: float, y: float, hdg: float):
        self.x, self.y, self.hdg = x, y, hdg % 360.0

    def sim(self, t_end: float) -> Trajectory:
        tr = Trajectory()
        for _ in range(int(round(t_end / DT)) + 1):
            tr.push(self.x, self.y, self.hdg, 0.0, 0.0, True, "hold")
        return tr


def hold_short_pose(rwy: Runway, side: str, along: float = 0.0, offset: float = 90.0) -> tuple[float, float, float]:
    """Pose of an aircraft holding short ``offset`` m from the centreline, nose toward the runway.

    ``side`` is 'L' or 'R' as seen in the runway direction.
    """
    sgn = 1.0 if side.upper() == "R" else -1.0
    x, y = rwy.at(along, sgn * offset)
    return x, y, (rwy.bearing - sgn * 90.0) % 360.0


class Departure:
    """Takeoff from ``rwy``; starts lined up, or holding short on ``hold_side``.

    Set ``t_lineup`` (start of the taxi onto the runway) and ``t_roll`` (brake
    release) before calling :meth:`sim`.
    """

    LINEUP_RADIUS = 45.0
    HOLD_OFFSET = 90.0
    TAXI_KT = 15.0

    def __init__(
        self,
        rwy: Runway,
        *,
        hold_side: str | None = None,
        along: float = 0.0,
        accel: float = 2.5,
        vr_kt: float = 150.0,
        climb_kt: float | None = None,
        climb_fpm: float = 2800.0,
        level_agl_ft: float | None = None,
    ):
        self.rwy = rwy
        self.hold_side = hold_side
        self.accel = accel
        self.vr = vr_kt * KT
        self.climb_v = (climb_kt if climb_kt is not None else vr_kt + 22.0) * KT
        self.climb_fpm = climb_fpm
        self.level_agl_ft = level_agl_ft
        self.t_lineup: float | None = None
        self.t_roll: float | None = None
        if hold_side is None:
            x, y = rwy.at(along)
            self.path = Path(x, y, rwy.bearing).straight(30000.0)
            self.s_lineup = 0.0
        else:
            sgn = 1.0 if hold_side.upper() == "R" else -1.0
            x, y, h = hold_short_pose(rwy, hold_side, along, self.HOLD_OFFSET)
            r = self.LINEUP_RADIUS
            self.path = Path(x, y, h).straight(self.HOLD_OFFSET - r).arc(r, sgn * 90.0).straight(30000.0)
            self.s_lineup = (self.HOLD_OFFSET - r) + r * math.pi / 2.0 + 15.0

    def sim(self, t_end: float) -> Trajectory:
        tr = Trajectory()
        s = 0.0
        v = 0.0
        agl = 0.0
        ground = True
        lined = self.hold_side is None
        phase = "lined_up" if lined else "hold"
        t_rot = t_lof = 0.0
        taxi = self.TAXI_KT * KT
        n = int(round(t_end / DT))
        for k in range(n + 1):
            t = k * DT
            x, y, h = self.path.pose(s)
            tr.push(x, y, h, v, agl, ground, phase)
            v_prev = v
            vs = 0.0
            if phase == "hold":
                if self.t_lineup is not None and t >= self.t_lineup:
                    phase = "lineup"
                    tr.events["lineup_start"] = t
            if phase == "lineup":
                rem = self.s_lineup - s
                if abs(self.rwy.rel(x, y)[1]) <= self.rwy.width / 2.0 and "enter_runway" not in tr.events:
                    tr.events["enter_runway"] = t
                if rem < 0.03:
                    s, v, v_prev = self.s_lineup, 0.0, 0.0
                    phase, lined = "lined_up", True
                    tr.events["lined_up"] = t
                else:
                    v = _approach(v, min(taxi, math.sqrt(2.0 * 0.8 * rem) + 0.05), 0.9, 1.5)
            if self.t_roll is not None and t >= self.t_roll and phase in ("hold", "lineup"):
                raise RuntimeError(f"{self.rwy.ident}: told to roll at {self.t_roll:.1f}s before being lined up")
            if phase == "lined_up" and self.t_roll is not None and t >= self.t_roll:
                phase = "roll"
                tr.events["roll"] = t
            if phase == "roll":
                v += self.accel * smoothstep((t - tr.events["roll"] + DT) / 3.0) * DT
                if v >= self.vr:
                    phase, t_rot = "rotate", t
                    tr.events["rotate"] = t
            elif phase == "rotate":
                v += 0.8 * self.accel * DT
                if t - t_rot >= 3.0:
                    phase, t_lof, ground = "climb", t, False
                    tr.events["liftoff"] = t
            elif phase == "climb":
                v = _approach(v, self.climb_v, min(1.3, 0.5 * (self.climb_v - v) + 0.05), 0.5)
                vs = _climb_rate(t - t_lof, self.climb_fpm, agl, self.level_agl_ft, 6.0)
            s += 0.5 * (v_prev + v) * DT
            agl += vs * DT
        return tr


class Arrival:
    """Landing (or go-around) on ``rwy`` from ``d0_nm`` out on a 3 degree final.

    Distances are measured from the landing (displaced) threshold.  Set
    ``t_exit`` (earliest time to begin the turn-off) or ``t_go_around``
    before calling :meth:`sim`.
    """

    def __init__(
        self,
        rwy: Runway,
        *,
        d0_nm: float,
        vapp_kt: float,
        v0_kt: float | None = None,
        decel_until: float = 0.0,
        td_ft: float = 1250.0,
        brake: float = 1.7,
        exit_kt: float = 16.0,
        exit_side: str | None = None,
        exit_angle: float = 40.0,
        exit_radius: float = 110.0,
        hold_lateral: float | None = None,
        end_lateral: float = 122.0,
        ga_climb_fpm: float = 2800.0,
        ga_kt: float = 175.0,
        level_agl_ft: float | None = None,
    ):
        self.rwy = rwy
        self.d0 = d0_nm * NM
        self.vapp = vapp_kt * KT
        self.v0 = (v0_kt if v0_kt is not None else vapp_kt) * KT
        self.decel_until = decel_until
        self.td = td_ft * FT
        self.brake = brake
        self.exit_v = exit_kt * KT
        self.exit_side = exit_side
        self.exit_angle = exit_angle
        self.exit_radius = exit_radius
        self.hold_lateral = hold_lateral
        self.end_lateral = end_lateral
        self.ga_climb_fpm = ga_climb_fpm
        self.ga_v = ga_kt * KT
        self.level_agl_ft = level_agl_ft
        self.t_exit: float | None = None  # earliest time to start the turn-off
        self.t_go_around: float | None = None

    def final_speed(self, t: float) -> float:
        if self.decel_until <= 0.0 or t >= self.decel_until:
            return self.vapp
        return self.v0 + (self.vapp - self.v0) * (t / self.decel_until)

    def distance_flown(self, t: float) -> float:
        """Metres covered along final in the first ``t`` seconds (no flare/landing)."""
        n = int(round(t / DT))
        return sum(0.5 * (self.final_speed(k * DT) + self.final_speed((k + 1) * DT)) * DT for k in range(n))

    def _flare_agl(self, past_thr: float) -> float:
        u = past_thr / self.td
        m0 = -math.tan(math.radians(GLIDE_DEG)) / FT * self.td  # ft per unit u at the threshold
        m1 = -0.02 * self.td
        h = TCH_FT * (2 * u**3 - 3 * u**2 + 1) + m0 * (u**3 - 2 * u**2 + u) + m1 * (u**3 - u**2)
        return max(0.0, h)

    def sim(self, t_end: float) -> Trajectory:
        rwy = self.rwy
        x0, y0 = rwy.at(rwy.displaced - self.d0)
        path = Path(x0, y0, rwy.bearing).straight(self.d0 + rwy.length + 3000.0)
        tan_gs = math.tan(math.radians(GLIDE_DEG))
        tr = Trajectory()
        s = 0.0
        v = self.final_speed(0.0)
        agl = TCH_FT + self.d0 * tan_gs / FT
        ground = False
        phase = "final"
        t_td = t_ga = vs_ga0 = 0.0
        s_stop = None
        sgn = 0.0
        n = int(round(t_end / DT))
        for k in range(n + 1):
            t = k * DT
            x, y, h = path.pose(s)
            tr.push(x, y, h, v, agl, ground, phase)
            v_prev = v
            along, right = rwy.rel(x, y)
            along -= rwy.displaced  # metres past the landing threshold
            if phase == "final":
                if self.t_go_around is not None and t >= self.t_go_around:
                    phase, t_ga = "go_around", t
                    vs_ga0 = -v * tan_gs / FT
                    tr.events["go_around"] = t
                elif along >= 0.0:
                    phase = "flare"
                    tr.events["threshold"] = t
                else:
                    v = self.final_speed(t + DT)
            if phase == "flare":
                if along >= self.td:
                    phase, ground, agl, t_td = "rollout", True, 0.0, t
                    tr.events["touchdown"] = t
                else:
                    v -= 0.5 * DT
            if phase == "rollout":
                v -= self.brake * (0.35 + 0.65 * smoothstep((t - t_td) / 2.5)) * DT
                if v <= self.exit_v:
                    v, phase = self.exit_v, "taxi"
                    tr.events["slow"] = t
            elif phase == "taxi":
                if self.exit_side is not None and self.t_exit is not None and t >= self.t_exit:
                    sgn = 1.0 if self.exit_side.upper() == "R" else -1.0
                    path.truncate(s)
                    path.arc(self.exit_radius, sgn * self.exit_angle).straight(2000.0)
                    phase = "exit"
                    tr.events["exit_start"] = t
                    tr.events["exit_along"] = along + rwy.displaced
                    if self.hold_lateral is not None:
                        ang = math.radians(self.exit_angle)
                        arc_len = self.exit_radius * ang
                        arc_lat = self.exit_radius * (1.0 - math.cos(ang))
                        s_stop = s + arc_len + (self.hold_lateral - arc_lat) / math.sin(ang)
            elif phase == "exit":
                if abs(right) > rwy.width / 2.0 + 45.0 and "runway_vacated" not in tr.events:
                    tr.events["runway_vacated"] = t
                if s_stop is not None:
                    rem = s_stop - s
                    if rem < 0.03:
                        s, v, v_prev, phase = s_stop, 0.0, 0.0, "hold"
                        tr.events["holding"] = t
                    else:
                        v = _approach(v, min(self.exit_v, math.sqrt(2.0 * 0.5 * rem) + 0.05), 0.5, 1.5)
                elif abs(right) >= self.end_lateral and k % int(round(1.0 / DT)) == 0:
                    tr.events["gone"] = t
                    break
            elif phase == "go_around":
                v = _approach(v, self.ga_v, 0.8, 0.5)
            # --- integrate
            s += 0.5 * (v_prev + v) * DT
            if phase == "final":
                agl = TCH_FT + max(0.0, self.d0 - s) * tan_gs / FT
            elif phase == "flare":
                agl = self._flare_agl(s - self.d0)
            elif phase == "go_around":
                u = smoothstep((t - t_ga) / 7.0)
                vs = vs_ga0 + (self.ga_climb_fpm / 60.0 - vs_ga0) * u
                if self.level_agl_ft is not None and vs > 0.0:
                    vs = min(vs, max(0.0, self.level_agl_ft - agl) * 0.12)
                agl += vs * DT
        return tr

"""The three scripted tower scenes.

Each scenario is a small Python function that talks and moves aircraft on a
shared timeline (see ``Stage`` in build_clips.py):

* ``stage.say(speaker, callsign, text, ...)`` places the next transmission and
  returns its cue (``.start`` / ``.end`` in seconds).  The length of every
  transmission comes from the synthesised audio, so the schedule adapts by
  itself when a voice or a line changes.
* aircraft are ``Departure`` / ``Arrival`` / ``Parked`` objects whose triggers
  (``t_lineup``, ``t_roll``, ``t_exit``, ``t_go_around``) are set from cue
  times, and whose events (lift-off, touchdown, ...) in turn gate later cues
  through ``not_before=``.

The numbers under "Tunables" are the ones worth playing with.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from kinematics import NM, Arrival, Departure, Parked, hold_short_pose
from radiofx import Radio
from tts import Voice

# --- Tunables ----------------------------------------------------------------
# Starting distances on final (nautical miles from the landing threshold).
JFK_DAL_START_NM = 2.3
SFO_ASA_START_NM = 1.5
SFO_UAL_START_NM = 1.75
# Speedbird's go-around: begun this long after the tower starts the call, from
# this height on the glidepath (it sinks ~20 ft more before climbing away).
GO_AROUND_REACTION_S = 2.8
GO_AROUND_START_AGL_FT = 270.0
# Crews push the thrust levers up this long after they start reading back a takeoff clearance.
ROLL_AFTER_READBACK_STARTS_S = 2.0
# "Contact departure" is issued this long after the wheels leave the ground.
HANDOFF_AFTER_LIFTOFF_S = 6.0
# Quiet tail after the last word.
TAIL_S = 2.5

DIGITS = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "niner",
}  # fmt: skip


def spoken_frequency(mhz: float) -> str:
    """121.9 -> 'one two one point niner'; 126.625 -> 'one two six point six two'.

    Digit by digit, with at most two decimals (US controllers drop the trailing
    5 of 25 kHz channels) and at least one.
    """
    whole, frac = f"{mhz:.3f}".split(".")
    frac = frac[:2].rstrip("0") or "0"
    return " ".join(DIGITS[d] for d in whole) + " point " + " ".join(DIGITS[d] for d in frac)


def cap(text: str) -> str:
    return text[0].upper() + text[1:]


@dataclass
class Scenario:
    id: str
    station_id: str
    airport: str
    elevation_ft: float
    title: str
    description: str
    tower: Voice
    tower_radio: Radio
    pilots: dict[str, Voice]
    aircraft: dict[str, dict[str, str]]
    script: Callable = field(repr=False, default=None)


# --- Voices ------------------------------------------------------------------
# en_US-libritts-high is a 904-speaker model; the integers are its speaker ids.
LIBRI = "en_US-libritts-high"


def libri(speaker: int, pace: float = 0.84, pitch: float = 1.0) -> Voice:
    return Voice(LIBRI, speaker=speaker, length_scale=pace, pitch=pitch)


# --- 1. O'Hare: three departures off 28R ---------------------------------------


def ord_departures(stage) -> None:
    apt = stage.apt
    rwy = apt.runway("28R")
    dep = spoken_frequency(apt.frequency("DEP", prefer="West"))

    # The terminals are north of 28R, so the queue holds on the right-hand side.
    ual = stage.add("UAL2099", Departure(rwy, along=45.0, accel=2.3, vr_kt=155.0, climb_fpm=2700.0))
    aal = stage.add("AAL540", Departure(rwy, hold_side="R", along=0.0, accel=2.6, vr_kt=148.0, climb_fpm=2900.0))
    eny = stage.add("ENY3680", Departure(rwy, hold_side="R", along=110.0, accel=2.8, vr_kt=145.0, climb_fpm=3000.0))

    stage.say("Tower", "UAL2099",
              "United twenty ninety-nine heavy, O'Hare Tower, wind two one zero at eight, "
              "runway two eight right, cleared for takeoff.", at=0.8)
    c = stage.say("Pilot", "UAL2099", "Cleared for takeoff two eight right, United twenty ninety-nine heavy.")
    ual.t_roll = c.start + ROLL_AFTER_READBACK_STARTS_S

    stage.say("Tower", "AAL540",
              "American five forty, runway two eight right, line up and wait. "
              "Traffic departing, a heavy triple seven.", gap=3.0)
    c = stage.say("Pilot", "AAL540", "Line up and wait two eight right, American five forty.")
    aal.t_lineup = c.start + 1.5

    stage.say("Tower", "ENY3680", "Envoy thirty-six eighty, hold short of runway two eight right.", gap=3.5)
    stage.say("Pilot", "ENY3680", "Hold short two eight right, Envoy thirty-six eighty.")

    liftoff = ual.sim(600.0).events["liftoff"]
    stage.say("Tower", "UAL2099", f"United twenty ninety-nine heavy, contact departure {dep}. Good evening.",
              gap=2.0, not_before=liftoff + HANDOFF_AFTER_LIFTOFF_S)
    stage.say("Pilot", "UAL2099", f"{cap(dep)}, United twenty ninety-nine heavy. Good night.")

    lined_up = aal.sim(600.0).events["lined_up"]
    stage.say("Tower", "AAL540",
              "American five forty, caution wake turbulence, wind two one zero at eight, "
              "runway two eight right, cleared for takeoff.", gap=1.6, not_before=lined_up + 1.0)
    c = stage.say("Pilot", "AAL540", "Cleared for takeoff two eight right, American five forty.")
    aal.t_roll = c.start + ROLL_AFTER_READBACK_STARTS_S

    # Once the American is well into its roll, the next one is fed onto the runway behind it.
    stage.say("Tower", "ENY3680", "Envoy thirty-six eighty, runway two eight right, line up and wait.", gap=11.0)
    c = stage.say("Pilot", "ENY3680", "Line up and wait two eight right, Envoy thirty-six eighty.")
    eny.t_lineup = c.start + 1.5

    liftoff = aal.sim(600.0).events["liftoff"]
    stage.say("Tower", "AAL540", f"American five forty, contact departure {dep}.",
              gap=2.0, not_before=liftoff + HANDOFF_AFTER_LIFTOFF_S)
    stage.say("Pilot", "AAL540", f"{cap(dep)}, American five forty, so long.")

    lined_up = eny.sim(600.0).events["lined_up"]
    stage.say("Tower", "ENY3680",
              "Envoy thirty-six eighty, fly heading two seven zero, runway two eight right, cleared for takeoff.",
              gap=1.6, not_before=lined_up + 1.0)
    c = stage.say("Pilot", "ENY3680",
                  "Heading two seven zero, cleared for takeoff two eight right, Envoy thirty-six eighty.")
    eny.t_roll = c.start + ROLL_AFTER_READBACK_STARTS_S
    stage.end(c.end + TAIL_S + 1.0)  # leave the Envoy visibly rolling


# --- 2. Kennedy: a landing, a departure and a go-around -----------------------


def jfk_go_around(stage) -> None:
    apt = stage.apt
    left, right = apt.runway("22L"), apt.runway("22R")
    gnd = spoken_frequency(apt.frequency("GND", prefer="Ground"))
    dep = spoken_frequency(apt.frequency("DEP", prefer="Departure"))

    dal = stage.add("DAL418", Arrival(left, d0_nm=JFK_DAL_START_NM, vapp_kt=134.0, td_ft=1250.0, brake=2.0,
                                      exit_kt=18.0, exit_side="L", exit_angle=35.0, exit_radius=120.0))
    jbu = stage.add("JBU615", Departure(right, along=45.0, accel=2.6, vr_kt=147.0, climb_fpm=2800.0))

    stage.say("Tower", "DAL418",
              "Delta four eighteen, Kennedy Tower, wind two three zero at one four, "
              "runway two two left, cleared to land.", at=0.8)
    stage.say("Pilot", "DAL418", "Cleared to land two two left, Delta four eighteen.")

    stage.say("Tower", "BAW173",
              "Speedbird one seven three heavy, Kennedy Tower, number two, following an Airbus "
              "on a two mile final, runway two two left, continue.", gap=1.6)
    stage.say("Pilot", "BAW173", "Continue, number two, Speedbird one seven three heavy.")

    stage.say("Tower", "JBU615",
              "JetBlue six fifteen, wind two three zero at one four, runway two two right, cleared for takeoff.",
              gap=16.0)
    c = stage.say("Pilot", "JBU615", "Cleared for takeoff two two right, JetBlue six fifteen.")
    jbu.t_roll = c.start + ROLL_AFTER_READBACK_STARTS_S

    touchdown = dal.sim(600.0).events["touchdown"]
    stage.say("Tower", "DAL418", f"Delta four eighteen, turn left at Juliet, contact ground {gnd}.",
              gap=2.0, not_before=touchdown + 3.0)
    c = stage.say("Pilot", "DAL418", f"Left at Juliet, ground {gnd}, Delta four eighteen.")
    dal.t_exit = c.end + 1.0  # in practice it turns off as soon as it has slowed down, well after this

    # The go-around call; Speedbird's whole approach is anchored to it.
    c = stage.say("Tower", "BAW173",
                  "Speedbird one seven three heavy, go around. Traffic still on the runway. "
                  "Fly runway heading, climb and maintain two thousand.", gap=1.5)
    t_ga = round(c.start + GO_AROUND_REACTION_S, 1)
    baw = Arrival(left, d0_nm=1.0, vapp_kt=146.0, v0_kt=162.0, decel_until=t_ga - 25.0,
                  ga_climb_fpm=2800.0, ga_kt=180.0, level_agl_ft=2000.0 - apt.elevation_ft)
    d_ga = (GO_AROUND_START_AGL_FT - 50.0) * 0.3048 / 0.052408  # distance out at that height on a 3 deg path
    baw.d0 = d_ga + baw.distance_flown(t_ga)
    baw.t_go_around = t_ga
    stage.add("BAW173", baw)
    stage.say("Pilot", "BAW173", "Going around, runway heading, two thousand, Speedbird one seven three heavy.")

    liftoff = jbu.sim(600.0).events["liftoff"]
    stage.say("Tower", "JBU615", f"JetBlue six fifteen, contact departure {dep}.",
              gap=1.8, not_before=liftoff + HANDOFF_AFTER_LIFTOFF_S)
    stage.say("Pilot", "JBU615", f"{cap(dep)}, JetBlue six fifteen, see you.")

    stage.say("Tower", "BAW173", f"Speedbird one seven three heavy, contact departure {dep}.", gap=1.8)
    c = stage.say("Pilot", "BAW173", f"{cap(dep)}, Speedbird one seven three heavy.")
    stage.end(c.end + TAIL_S)


# --- 3. San Francisco: parallel arrivals, crossing departure ------------------


def sfo_parallels(stage) -> None:
    apt = stage.apt
    r28l, r28r, r1r, r1l = (apt.runway(i) for i in ("28L", "28R", "1R", "1L"))
    gnd = spoken_frequency(apt.frequency("GND", prefer="Ground"))
    dep = spoken_frequency(apt.frequency("DEP", prefer="Nw"))

    # Touch down ~1,100 ft past the displaced thresholds (about 1,400 ft from the pavement end).
    asa = stage.add("ASA312", Arrival(r28l, d0_nm=SFO_ASA_START_NM, vapp_kt=134.0, td_ft=1100.0, brake=1.7,
                                      exit_kt=18.0, exit_side="R", exit_angle=45.0, exit_radius=100.0,
                                      hold_lateral=0.5 * abs(r28l.rel(r28r.x0, r28r.y0)[1])))
    ual = stage.add("UAL875", Arrival(r28r, d0_nm=SFO_UAL_START_NM, vapp_kt=142.0, td_ft=1100.0, brake=1.6,
                                      exit_kt=16.0, exit_side="R", exit_angle=40.0, exit_radius=120.0))
    # Both regional/737 queues wait on the terminal (west) side of the 1s.
    swa = stage.add("SWA1904", Departure(r1r, hold_side="L", along=0.0, accel=2.6, vr_kt=148.0, climb_fpm=2800.0))
    stage.add("SKW5318", Parked(*hold_short_pose(r1l, "L", 0.0)))

    stage.say("Tower", "ASA312",
              "Alaska three twelve, San Francisco Tower, wind two eight zero at one six, "
              "runway two eight left, cleared to land. Traffic, a seven eighty-seven on the parallel.", at=0.8)
    stage.say("Pilot", "ASA312", "Cleared to land two eight left, traffic in sight, Alaska three twelve.")

    stage.say("Tower", "UAL875", "United eight seventy-five heavy, runway two eight right, cleared to land.", gap=1.6)
    stage.say("Pilot", "UAL875", "Cleared to land two eight right, United eight seventy-five heavy.")

    stage.say("Tower", "SWA1904", "Southwest nineteen zero four, runway one right, line up and wait.", gap=3.5)
    c = stage.say("Pilot", "SWA1904", "Line up and wait one right, Southwest nineteen zero four.")
    swa.t_lineup = c.start + 1.5

    stage.say("Tower", "SKW5318", "SkyWest fifty-three eighteen, hold short of runway one left.", gap=5.0)
    stage.say("Pilot", "SKW5318", "Hold short one left, SkyWest fifty-three eighteen.")

    # 1R crosses both 28s: wait until each arrival's tail is clear of the crossing.
    clear_by = max(
        asa.sim(600.0).time_past(r28l, r28l.crossing(r1r)[0] + 90.0),
        ual.sim(600.0).time_past(r28r, r28r.crossing(r1r)[0] + 90.0),
    )
    lined_up = swa.sim(600.0).events["lined_up"]
    stage.say("Tower", "SWA1904",
              "Southwest nineteen zero four, wind two eight zero at one six, runway one right, cleared for takeoff.",
              gap=2.0, not_before=max(clear_by, lined_up + 1.0))
    c = stage.say("Pilot", "SWA1904", "Cleared for takeoff one right, Southwest nineteen zero four.")
    swa.t_roll = c.start + ROLL_AFTER_READBACK_STARTS_S

    stage.say("Tower", "ASA312", "Alaska three twelve, turn right at Tango, hold short of runway two eight right.",
              gap=2.0)
    c = stage.say("Pilot", "ASA312", "Right at Tango, hold short two eight right, Alaska three twelve.")
    asa.t_exit = c.start + 1.0

    stage.say("Tower", "UAL875", f"United eight seventy-five heavy, turn right next taxiway, contact ground {gnd}.",
              gap=3.5)
    c = stage.say("Pilot", "UAL875", f"Right turn, ground {gnd}, United eight seventy-five heavy.")
    ual.t_exit = c.start + 1.0

    liftoff = swa.sim(600.0).events["liftoff"]
    stage.say("Tower", "SWA1904", f"Southwest nineteen zero four, contact NorCal departure {dep}.",
              gap=1.8, not_before=liftoff + HANDOFF_AFTER_LIFTOFF_S)
    c = stage.say("Pilot", "SWA1904", f"{cap(dep)}, Southwest nineteen zero four, good day.")
    holding = asa.sim(600.0).events.get("holding", 0.0)
    stage.end(max(c.end + TAIL_S, holding + 1.5))


# --- Catalogue (index.json order) --------------------------------------------

SCENARIOS: list[Scenario] = [
    Scenario(
        id="ord-tower-departures",
        station_id="ord-tower-28r",
        airport="ORD",
        elevation_ft=680.0,
        title="O'Hare Tower — evening departure push",
        description=(
            "Three airliners take off one after another from runway 28 Right while the tower "
            "feeds each one onto the runway behind the last."
        ),
        tower=Voice("en_US-joe-medium", length_scale=0.80),
        tower_radio=Radio(presence_hz=1900.0, presence_db=3.0),
        pilots={
            "UAL2099": libri(264),
            "AAL540": libri(780),
            "ENY3680": libri(216),
        },
        aircraft={
            "UAL2099": {"type": "B772", "registration": "N78004"},
            "AAL540": {"type": "B738", "registration": "N921NN"},
            "ENY3680": {"type": "E75L", "registration": "N233NN"},
        },
        script=ord_departures,
    ),
    Scenario(
        id="jfk-tower-go-around",
        station_id="jfk-tower-22l",
        airport="JFK",
        elevation_ft=13.0,
        title="Kennedy Tower — arrivals and a go-around",
        description=(
            "A Delta jet has only just touched down when a British Airways 777 arrives too close behind it, "
            "so the tower orders the 777 to abort its landing and climb away while a JetBlue departs alongside."
        ),
        tower=libri(96, pace=0.82),
        tower_radio=Radio(presence_hz=2100.0, presence_db=3.5),
        pilots={
            "DAL418": libri(360),
            "BAW173": Voice("en_GB-cori-medium", length_scale=0.84),
            "JBU615": libri(744),
        },
        aircraft={
            "DAL418": {"type": "A321", "registration": "N301DN"},
            "BAW173": {"type": "B77W", "registration": "G-STBA"},
            "JBU615": {"type": "A320", "registration": "N603JB"},
        },
        script=jfk_go_around,
    ),
    Scenario(
        id="sfo-tower-parallels",
        station_id="sfo-tower",
        airport="SFO",
        elevation_ft=13.0,
        title="San Francisco Tower — side-by-side arrivals",
        description=(
            "Two jets land side by side on San Francisco's close parallel runways while a Southwest 737 "
            "waits to take off across their path."
        ),
        tower=libri(48, pace=0.80),
        tower_radio=Radio(presence_hz=1750.0, presence_db=3.0),
        pilots={
            "ASA312": libri(624),
            "UAL875": libri(720),
            "SWA1904": libri(300),
            "SKW5318": libri(192),
        },
        aircraft={
            "ASA312": {"type": "B739", "registration": "N260AK"},
            "UAL875": {"type": "B789", "registration": "N27958"},
            "SWA1904": {"type": "B38M", "registration": "N8710M"},
            "SKW5318": {"type": "E75L", "registration": "N146SY"},
        },
        script=sfo_parallels,
    ),
]

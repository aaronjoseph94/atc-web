"""VHF airband "radio voice" treatment and loudness tools for the clip builder.

``transmit()`` turns clean speech into one push-to-talk transmission:

    mic-key click -> carrier/static bed -> band-limited, compressed, slightly
    clipped speech -> squelch-tail noise burst

``Radio`` holds the per-speaker character (the tower is clean and strong, the
aircraft are noisier and more distorted).  ``integrated_lufs()`` is a small
ITU-R BS.1770 implementation used to normalise the finished clip.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import signal
from scipy.ndimage import uniform_filter1d

from tts import SR


def db(x: float) -> float:
    """Decibels -> linear amplitude."""
    return 10.0 ** (x / 20.0)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x)) + 1e-20))


def active_rms(x: np.ndarray) -> float:
    """RMS over the frames that actually carry speech (ignores pauses between words)."""
    frame = int(SR * 0.02)
    n = len(x) // frame
    if n < 2:
        return rms(x)
    e = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-20)
    return float(np.sqrt(np.mean(e[e > e.max() * db(-25.0)] ** 2)))


def band_limit(x: np.ndarray, lo: float = 300.0, hi: float = 3200.0) -> np.ndarray:
    sos = np.vstack(
        [
            signal.butter(4, lo, "highpass", fs=SR, output="sos"),
            signal.butter(8, hi, "lowpass", fs=SR, output="sos"),
        ]
    )
    return signal.sosfilt(sos, x)


def peaking(x: np.ndarray, f0: float, gain_db: float, q: float) -> np.ndarray:
    """RBJ peaking EQ biquad."""
    if abs(gain_db) < 0.05:
        return x
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * f0 / SR
    alpha = np.sin(w0) / (2.0 * q)
    b = np.array([1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a])
    den = np.array([1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a])
    return signal.lfilter(b / den[0], den / den[0], x)


def band_noise(n: int, rng: np.random.Generator, lo: float = 300.0, hi: float = 3200.0) -> np.ndarray:
    """Unit-RMS noise limited to the radio's audio band."""
    pad = int(SR * 0.05)
    x = band_limit(rng.standard_normal(n + pad), lo, hi)[pad:]
    return x / rms(x)


def slow_noise(n: int, rng: np.random.Generator, hz: float) -> np.ndarray:
    """Unit-RMS low-frequency random wobble (for fading/flutter)."""
    pad = int(SR / hz)
    sos = signal.butter(2, hz, "lowpass", fs=SR, output="sos")
    x = signal.sosfilt(sos, rng.standard_normal(n + pad))[pad:]
    return x / rms(x)


def compress(x: np.ndarray, threshold_db: float, ratio: float, attack_ms: float = 2.0, release_ms: float = 90.0) -> np.ndarray:
    """Feed-forward compressor (fast attack, slower release), no make-up gain."""
    env = np.sqrt(uniform_filter1d(x * x, size=max(3, int(SR * 0.004))) + 1e-12)
    over = np.maximum(20.0 * np.log10(env) - threshold_db, 0.0)
    reduction = -over * (1.0 - 1.0 / ratio)  # dB, <= 0

    def one_pole(sig: np.ndarray, ms: float) -> np.ndarray:
        a = np.exp(-1.0 / (SR * ms / 1000.0))
        return signal.lfilter([1.0 - a], [1.0, -a], sig)

    gain_db = np.minimum(one_pole(reduction, attack_ms), one_pole(reduction, release_ms))
    return x * 10.0 ** (gain_db / 20.0)


@dataclass(frozen=True)
class Radio:
    """Character of one transmitter as heard on the frequency."""

    lo: float = 300.0  # audio pass-band, Hz
    hi: float = 3200.0
    drive_db: float = 3.0  # how hard the speech hits the clipper
    bias: float = 0.0  # clipper asymmetry (adds a rougher edge)
    mic_noise_db: float = -45.0  # cockpit/room noise at the mic, rel. speech, before compression
    static_db: float = -32.0  # receiver static under the transmission, rel. speech
    flutter: float = 0.0  # depth of slow signal-strength wobble (0..0.3)
    presence_hz: float = 1900.0  # resonance of the headset/speaker chain
    presence_db: float = 3.0
    gain_db: float = 0.0  # received strength relative to the nominal speech level
    pre_ms: float = 70.0  # carrier before the first word
    post_ms: float = 55.0  # carrier after the last word, before the squelch closes


TOWER = Radio()


def pilot_radio(seed: int) -> Radio:
    """A noisier, more distorted airborne transmitter; each callsign gets its own flavour."""
    rng = np.random.default_rng(seed)
    return Radio(
        lo=float(rng.uniform(330.0, 420.0)),
        hi=float(rng.uniform(2700.0, 3050.0)),
        drive_db=float(rng.uniform(8.0, 12.0)),
        bias=float(rng.uniform(0.04, 0.12)),
        mic_noise_db=float(rng.uniform(-33.0, -28.0)),
        static_db=float(rng.uniform(-25.0, -21.0)),
        flutter=float(rng.uniform(0.05, 0.14)),
        presence_hz=float(rng.uniform(1500.0, 2400.0)),
        presence_db=float(rng.uniform(3.0, 6.0)),
        gain_db=float(rng.uniform(-3.0, -1.0)),
        pre_ms=float(rng.uniform(80.0, 150.0)),
        post_ms=float(rng.uniform(50.0, 110.0)),
    )


SPEECH_LEVEL = 0.1  # nominal RMS of processed speech before final loudness normalisation
SQUELCH_MS = 120.0


@dataclass
class Transmission:
    audio: np.ndarray  # click + carrier + speech + squelch tail
    speech_start: int  # sample index of the first speech sample inside ``audio``
    speech_len: int


def _key_click(rng: np.random.Generator) -> np.ndarray:
    n = int(SR * 0.016)
    t = np.arange(n) / SR
    click = (0.7 * np.sin(2 * np.pi * 850.0 * t) + 0.8 * rng.standard_normal(n)) * np.exp(-t / 0.0032)
    return band_limit(click, 300.0, 3200.0)


def _squelch_tail(rng: np.random.Generator) -> np.ndarray:
    n = int(SR * SQUELCH_MS / 1000.0)
    noise = band_noise(n, rng, 500.0, 3200.0)
    t = np.arange(n) / SR
    env = np.minimum(1.0, t / 0.004) * np.exp(-t / 0.30)
    tail = int(SR * 0.014)
    env[-tail:] *= np.linspace(1.0, 0.0, tail) ** 2
    return noise * env


def transmit(speech: np.ndarray, radio: Radio, rng: np.random.Generator) -> Transmission:
    """Apply the radio chain to clean speech and wrap it in key click / squelch tail."""
    pre = int(SR * radio.pre_ms / 1000.0)
    post = int(SR * radio.post_ms / 1000.0)
    n_sp = len(speech)
    n = pre + n_sp + post

    # Microphone: band-limited voice plus ambient noise picked up while the key is down.
    x = np.zeros(n)
    x[pre : pre + n_sp] = speech / active_rms(speech)
    x = band_limit(x, radio.lo, radio.hi)
    x += band_noise(n, rng, 200.0, 2500.0) * db(radio.mic_noise_db)

    # Transmitter: heavy compression (which also pumps the ambient noise up between
    # words), then a clipper, then the channel filter again to tame the harmonics.
    x = compress(x, threshold_db=-22.0, ratio=8.0)
    x = x / active_rms(x[pre : pre + n_sp]) * 0.25
    g = db(radio.drive_db)
    x = (np.tanh(g * (x + radio.bias)) - np.tanh(g * radio.bias)) / np.tanh(g)
    x = band_limit(x, radio.lo, radio.hi)
    x = peaking(x, radio.presence_hz, radio.presence_db, 1.1)
    if radio.flutter > 0.0:
        x *= 1.0 + radio.flutter * np.clip(slow_noise(n, rng, 5.0), -2.5, 2.5)
    x *= SPEECH_LEVEL * db(radio.gain_db) / active_rms(x[pre : pre + n_sp])

    # Receiver: static under the whole carrier, a click as the squelch opens,
    # and the noise burst as it closes.
    bed = band_noise(n, rng) * SPEECH_LEVEL * db(radio.static_db)
    fade = int(SR * 0.004)
    bed[:fade] *= np.linspace(0.0, 1.0, fade)
    x += bed
    click = _key_click(rng) * SPEECH_LEVEL * 1.6
    x[: len(click)] += click
    tail = _squelch_tail(rng) * SPEECH_LEVEL * db(-4.0)
    return Transmission(audio=np.concatenate([x, tail]), speech_start=pre, speech_len=n_sp)


# --- loudness (ITU-R BS.1770-4, mono) ---------------------------------------


def _k_weight(x: np.ndarray) -> np.ndarray:
    # High-shelf then high-pass, re-derived for SR (coefficients as in pyloudnorm / De Man).
    f0, g, q = 1681.9744509555319, 3.99984385397, 0.7071752369554193
    k = np.tan(np.pi * f0 / SR)
    vh = 10.0 ** (g / 20.0)
    vb = vh**0.499666774155
    a0 = 1.0 + k / q + k * k
    b = np.array([(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0])
    a = np.array([1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0])
    x = signal.lfilter(b, a, x)
    f0, q = 38.13547087613982, 0.5003270373253953
    k = np.tan(np.pi * f0 / SR)
    a0 = 1.0 + k / q + k * k
    a = np.array([1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0])
    return signal.lfilter([1.0, -2.0, 1.0], a, x)


def integrated_lufs(x: np.ndarray) -> float:
    """Gated integrated loudness of a mono signal, in LUFS."""
    y = _k_weight(x)
    block, hop = int(SR * 0.4), int(SR * 0.1)
    power = np.array([np.mean(y[i : i + block] ** 2) for i in range(0, len(y) - block + 1, hop)])
    loud = -0.691 + 10.0 * np.log10(power + 1e-20)
    keep = power[loud > -70.0]
    rel = -0.691 + 10.0 * np.log10(np.mean(keep)) - 10.0
    keep = power[(loud > -70.0) & (loud > rel)]
    return float(-0.691 + 10.0 * np.log10(np.mean(keep)))


def soft_limit(x: np.ndarray, ceiling: float) -> np.ndarray:
    """Leave samples below 80 % of ``ceiling`` untouched, round off anything above."""
    knee = 0.8 * ceiling
    out = x.copy()
    hot = np.abs(x) > knee
    out[hot] = np.sign(x[hot]) * (knee + (ceiling - knee) * np.tanh((np.abs(x[hot]) - knee) / (ceiling - knee)))
    return out

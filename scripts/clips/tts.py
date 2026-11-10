"""Piper neural TTS wrapper for the clip builder.

* downloads the voice models from https://huggingface.co/rhasspy/piper-voices
  into the cache directory and checks them against pinned MD5 digests (the
  digests published in that repo's ``voices.json``);
* synthesises one line at a time with a fixed onnxruntime seed and a freshly
  loaded model, so a given (voice, speaker, text, take) always produces the
  same audio regardless of the order lines are requested in;
* trims Piper's leading/trailing silence so a line starts and ends on speech;
* caches every synthesised line as a ``.npy`` file.
"""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SR = 22050  # sample rate of every Piper voice used here

HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
CACHE_VERSION = 2  # bump when the post-processing of synthesised lines changes

# model name -> (repo sub-path, {extension: md5}).  Licences: see the MODEL_CARD
# next to each model on Hugging Face (summarised in build_clips.py).
MODELS: dict[str, tuple[str, dict[str, str]]] = {
    "en_US-libritts-high": (
        "en/en_US/libritts/high",
        {".onnx": "61d7845257f8abdc27476f606151ef8d", ".onnx.json": "cb1564bb779f3b1f87e2de778adeb669"},
    ),
    "en_US-libritts_r-medium": (
        "en/en_US/libritts_r/medium",
        {".onnx": "bb2c2776cffbfd736c7c497f620c0ca6", ".onnx.json": "c740db18a0dab11b13ce0292ea1196c6"},
    ),
    "en_US-joe-medium": (
        "en/en_US/joe/medium",
        {".onnx": "8dd388e2a102cbde27ca3fba4e78f488", ".onnx.json": "1f50b93e502afa734bb3f50fcce34c52"},
    ),
    "en_GB-cori-medium": (
        "en/en_GB/cori/medium",
        {".onnx": "82937b3877db782440eecfe0b8cb204c", ".onnx.json": "3501c84afe039f69e99d861aa9d824a3"},
    ),
    "en_GB-alba-medium": (
        "en/en_GB/alba/medium",
        {".onnx": "b802b4229cf62bb98d53a617dfd8fd4c", ".onnx.json": "87dc160c21fa57bb0a70b13a2751d9a7"},
    ),
}


@dataclass(frozen=True)
class Voice:
    """A Piper voice plus the synthesis settings that define one 'person'."""

    model: str
    speaker: int | None = None  # speaker id for multi-speaker models
    length_scale: float = 0.86  # < 1 = faster than the model's natural pace
    noise_scale: float | None = None  # None = model default
    noise_w: float | None = None
    pitch: float = 1.0  # resampling ratio: > 1 raises pitch/formants (tempo is compensated)


def _md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def trim_silence(x: np.ndarray, floor_db: float = -32.0, pad_ms: float = 8.0) -> np.ndarray:
    """Cut leading/trailing audio more than ``floor_db`` below the loudest 10 ms frame.

    What is left starts and ends on audible speech (anything quieter would be
    buried under the radio static anyway); a 4 ms fade avoids edge clicks.
    """
    frame = int(SR * 0.010)
    n = len(x) // frame
    if n < 3:
        return x
    rms = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    loud = np.nonzero(rms > rms.max() * 10 ** (floor_db / 20.0))[0]
    pad = int(SR * pad_ms / 1000.0)
    a = max(0, loud[0] * frame - pad)
    b = min(len(x), (loud[-1] + 1) * frame + pad)
    out = x[a:b].copy()
    fade = int(SR * 0.004)
    out[:fade] *= np.linspace(0.0, 1.0, fade, dtype=out.dtype)
    out[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=out.dtype)
    return out


class Synth:
    def __init__(self, cache_dir: Path):
        self.voice_dir = cache_dir / "voices"
        self.line_dir = cache_dir / "tts"
        self.voice_dir.mkdir(parents=True, exist_ok=True)
        self.line_dir.mkdir(parents=True, exist_ok=True)

    # -- models -----------------------------------------------------------
    def model_path(self, model: str) -> Path:
        """Path of the ONNX model, downloading and verifying it if needed."""
        sub, digests = MODELS[model]
        for ext, want in digests.items():
            path = self.voice_dir / f"{model}{ext}"
            if not path.exists() or _md5(path) != want:
                url = f"{HF_BASE}/{sub}/{model}{ext}"
                print(f"  downloading {url}", file=sys.stderr)
                tmp = path.with_suffix(path.suffix + ".part")
                for attempt in range(4):
                    try:
                        with urllib.request.urlopen(url, timeout=120) as resp, open(tmp, "wb") as out:
                            for block in iter(lambda: resp.read(1 << 20), b""):
                                out.write(block)
                        if _md5(tmp) == want:
                            break
                    except OSError as err:  # includes URLError, timeouts, resets
                        print(f"    attempt {attempt + 1} failed: {err}", file=sys.stderr)
                else:
                    raise RuntimeError(f"could not download a verified copy of {url}")
                tmp.replace(path)
        return self.voice_dir / f"{model}.onnx"

    # -- synthesis --------------------------------------------------------
    def speak(self, voice: Voice, text: str, take: int = 0, sentence_gap_ms: float = 170.0) -> np.ndarray:
        """Mono float32 speech at ``SR`` for ``text``: trimmed, sentences joined by short pauses."""
        import piper  # deferred: only needed on a cache miss

        key = json.dumps(
            [voice.model, voice.speaker, voice.length_scale, voice.noise_scale, voice.noise_w, voice.pitch,
             take, sentence_gap_ms, text, getattr(piper, "__version__", "?"), CACHE_VERSION],
            sort_keys=True,
        )
        cache = self.line_dir / (hashlib.sha1(key.encode("utf-8")).hexdigest() + ".npy")
        if cache.exists():
            return np.load(cache)

        import onnxruntime
        from piper import PiperVoice
        from piper.config import SynthesisConfig

        model = self.model_path(voice.model)
        # A fresh session + fixed seed makes the model's internal noise reproducible.
        onnxruntime.set_seed(1000 + take)
        pv = PiperVoice.load(model)
        assert pv.config.sample_rate == SR, "unexpected voice sample rate"
        cfg = SynthesisConfig(
            speaker_id=voice.speaker,
            length_scale=voice.length_scale * voice.pitch,
            noise_scale=voice.noise_scale,
            noise_w_scale=voice.noise_w,
        )
        parts = []
        gap = np.zeros(int(SR * sentence_gap_ms / 1000.0), dtype=np.float32)
        for chunk in pv.synthesize(text, cfg):
            if parts:
                parts.append(gap)
            parts.append(trim_silence(np.asarray(chunk.audio_float_array, dtype=np.float32)))
        audio = np.concatenate(parts)
        if voice.pitch != 1.0:
            from scipy.signal import resample_poly

            # Playing the audio back `pitch` times faster shifts pitch and formants together.
            num, den = 1000, int(round(1000 * voice.pitch))
            audio = resample_poly(audio, num, den).astype(np.float32)
        np.save(cache, audio)
        return audio

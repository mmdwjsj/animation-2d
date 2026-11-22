"""Kokoro Thai ONNX CLI wrapper for animation-2d.

Thin, read-only adapter around the locally installed Kokoro Thai model:
it only injects ``model-root`` into sys.path, calls the existing onnx_infer
helpers and writes a PCM16 WAV. It never modifies the reference project.

Usage (called by CommandTtsProvider via a command template):
  python kokoro_thai.py --text "..." --voice 1 --speed 1.0 \
      --model-root <dir containing kokoro_thai/ and onnx/> --output out.wav
"""
from __future__ import annotations

import argparse
import sys
import wave
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Kokoro Thai ONNX TTS wrapper")
    parser.add_argument("--text", required=True, help="Thai text to synthesize")
    parser.add_argument("--voice", default="1", help="Speaker id in styles.npz")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()

    root = Path(args.model_root)
    if not (root / "kokoro_thai" / "onnx_infer.py").exists():
        raise SystemExit(f"invalid --model-root: {root}")

    # The reference project ships the package inside model/, not in site-packages.
    sys.path.insert(0, str(root))

    import numpy as np
    from kokoro_thai.onnx_infer import (
        DEFAULT_SEED,
        SAMPLE_RATE,
        load_onnx,
        load_styles,
        synth,
    )

    student = load_onnx(str(root / "onnx"), intra_threads=args.threads, precision="fp32")
    styles = load_styles(str(root / "onnx"))

    try:
        speaker = int(args.voice)
    except ValueError:
        speaker = 1
    if speaker not in styles:
        raise SystemExit(f"speaker {speaker} not found; available: {sorted(styles)}")

    audio = synth(student, args.text, styles[speaker], speed=args.speed, seed=DEFAULT_SEED)
    if audio.size == 0:
        raise SystemExit("empty audio: check the Thai text")

    pcm = (
        np.clip(np.asarray(audio, dtype=np.float32).reshape(-1), -1.0, 1.0) * 32767
    ).astype(np.int16)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())

    print(
        f"OK samples={audio.size} rate={SAMPLE_RATE} "
        f"duration={audio.size / SAMPLE_RATE:.3f}s"
    )


if __name__ == "__main__":
    main()

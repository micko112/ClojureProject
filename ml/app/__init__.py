"""BeBetter activity classifier (CLIP zero-shot + trainable head)."""
import os

# ONNX Runtime >= 1.2x phones home with usage telemetry unless told not to.
os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")

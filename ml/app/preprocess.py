"""Turns an uploaded image into the exact tensor CLIP was trained on.

This mirrors HuggingFace's CLIPImageProcessor with the settings in the
model's preprocessor_config.json:

    do_convert_rgb   true                 -> RGB, 3 channels
    do_resize        shortest_edge = 224  -> bicubic (resample = 3)
    do_center_crop   224 x 224
    do_rescale       1/255                -> pixel values in [0, 1]
    do_normalize     mean/std below       -> roughly zero mean, unit variance

Getting this wrong (e.g. squashing instead of cropping, or forgetting the
normalisation) does not crash anything; it just silently makes predictions
worse. tests/test_preprocess.py checks each step.

One deliberate addition: EXIF orientation is applied first, so a phone photo
taken in portrait is seen upright (HF leaves that to the caller).
"""
import io

import numpy as np
from PIL import Image, ImageOps

SIZE = 224
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

# Refuse decompression bombs: a 20 MB JPEG can decode to gigabytes.
Image.MAX_IMAGE_PIXELS = 60_000_000


def load_image(data: bytes) -> Image.Image:
    """Decodes image bytes (JPEG/PNG/WebP/GIF first frame). Raises on garbage."""
    im = Image.open(io.BytesIO(data))
    im.load()
    return im


def resize_shortest_edge(im: Image.Image, size: int = SIZE) -> Image.Image:
    """Scales so the shorter side is `size`, keeping the aspect ratio.

    Same integer rounding as transformers' get_resize_output_image_size:
    the long side is int(size * long / short), i.e. truncated.
    """
    w, h = im.size
    short, long_ = (w, h) if w <= h else (h, w)
    new_short, new_long = size, int(size * long_ / short)
    new_w, new_h = (new_short, new_long) if w <= h else (new_long, new_short)
    return im.resize((new_w, new_h), resample=Image.Resampling.BICUBIC)


def center_crop(arr: np.ndarray, size: int = SIZE) -> np.ndarray:
    """Cuts the central size x size square out of an H x W x C array."""
    h, w = arr.shape[:2]
    top = (h - size) // 2
    left = (w - size) // 2
    return arr[top:top + size, left:left + size]


def preprocess(im: Image.Image) -> np.ndarray:
    """PIL image -> float32 array of shape (1, 3, 224, 224) ready for ONNX."""
    im = ImageOps.exif_transpose(im)
    if im.mode != "RGB":
        im = im.convert("RGB")
    im = resize_shortest_edge(im, SIZE)
    arr = np.asarray(im, dtype=np.float32)          # H x W x 3, values 0..255
    arr = center_crop(arr, SIZE)
    arr = arr * (1.0 / 255.0)                       # rescale to 0..1
    arr = (arr - MEAN) / STD                        # normalise per channel
    return arr.transpose(2, 0, 1)[None].astype(np.float32)  # -> 1 x 3 x H x W


def preprocess_bytes(data: bytes) -> np.ndarray:
    return preprocess(load_image(data))

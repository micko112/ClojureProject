#!/usr/bin/env python3
"""Downloads the quantized CLIP ViT-B/32 ONNX files from HuggingFace.

The revision is pinned to a commit hash so every build gets byte-identical
weights (a moving branch like "main" could change under us). Files are
verified against their published SHA-256 when the hub provides one (LFS
files), so a truncated or tampered download fails loudly.

Usage:
    python ml/scripts/download_model.py [target_dir]     # default: ml/models

Environment overrides (rarely needed):
    CLIP_REPO      default Xenova/clip-vit-base-patch32
    CLIP_REVISION  default the pinned commit below
    HF_ENDPOINT    default https://huggingface.co

Stdlib only, so it runs before `pip install` in the Dockerfile.
"""
import hashlib
import json
import os
import sys
import urllib.request

REPO = os.environ.get("CLIP_REPO", "Xenova/clip-vit-base-patch32")
# Commit of Xenova/clip-vit-base-patch32 checked on 2026-10-24.
REVISION = os.environ.get("CLIP_REVISION", "d15189d7028b43f1d3e65039190477f6af591c2a")
ENDPOINT = os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")

FILES = [
    "onnx/vision_model_quantized.onnx",
    "onnx/text_model_quantized.onnx",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "preprocessor_config.json",
    "config.json",
]


def _expected_sha256():
    """{path: sha256} for LFS files at the pinned revision (empty on failure)."""
    url = f"{ENDPOINT}/api/models/{REPO}/tree/{REVISION}/onnx"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            entries = json.load(r)
        return {e["path"]: e["lfs"]["oid"] for e in entries if e.get("lfs")}
    except Exception as e:  # pragma: no cover - network dependent
        print(f"  (could not fetch checksums: {e}; continuing without verification)")
        return {}


def _download(path, dest):
    url = f"{ENDPOINT}/{REPO}/resolve/{REVISION}/{path}"
    tmp = dest + ".part"
    h = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as out:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
            out.write(chunk)
    os.replace(tmp, dest)
    return h.hexdigest()


def main(target):
    os.makedirs(os.path.join(target, "onnx"), exist_ok=True)
    marker = os.path.join(target, "REVISION")
    have = ""
    if os.path.exists(marker):
        with open(marker) as m:
            have = m.read().strip()
    if have == f"{REPO}@{REVISION}" and all(os.path.exists(os.path.join(target, f)) for f in FILES):
        print(f"Model already present in {target} ({REPO}@{REVISION[:10]})")
        return 0
    print(f"Downloading {REPO}@{REVISION[:10]} into {target}")
    sums = _expected_sha256()
    for f in FILES:
        dest = os.path.join(target, f)
        digest = _download(f, dest)
        want = sums.get(f)
        if want and want != digest:
            os.remove(dest)
            print(f"  checksum mismatch for {f}: got {digest}, want {want}", file=sys.stderr)
            return 1
        size = os.path.getsize(dest) / 1e6
        print(f"  {f:40s} {size:7.1f} MB {'(sha256 ok)' if want else ''}")
    with open(marker, "w") as m:
        m.write(f"{REPO}@{REVISION}\n")
    return 0


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    default = os.path.join(os.path.dirname(here), "models")
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else default))

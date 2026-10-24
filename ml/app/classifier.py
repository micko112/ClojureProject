"""CLIP zero-shot classification + the optional trained head.

Zero-shot in one paragraph
--------------------------
CLIP has two encoders trained together on 400 million (image, caption)
pairs: one turns an image into a 512-number embedding, the other turns a
sentence into a 512-number embedding, and training pushed matching pairs to
point in the same direction. So to ask "is this a photo of a person running?"
we embed that sentence and measure the angle between the two vectors
(cosine similarity). Doing that for every activity and picking the closest
is classification without a single training example: "zero-shot".

    sim[k]   = cos(image, text_k)                    # between -1 and 1
    logit[k] = 100 * sim[k]                          # CLIP's learned "temperature"
    p        = softmax(logit)                        # probabilities summing to 1

The 100 is CLIP's learned logit scale (exp(4.6052)); it turns the small
differences between similarities (0.21 vs 0.27) into confident probabilities.
"""
import hashlib
import os
import threading
import time

import numpy as np

from . import activities, preprocess
from .head import Head, l2_normalize, softmax, train_head

LOGIT_SCALE = 100.0
TOP_K = 3


def _env_float(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


class Config:
    def __init__(self):
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.model_dir = os.environ.get("MODEL_DIR", os.path.join(here, "models"))
        self.head_path = os.environ.get("HEAD_PATH", os.path.join(here, "data", "head.npz"))
        self.min_examples = _env_int("HEAD_MIN_EXAMPLES", 20)
        self.min_classes = _env_int("HEAD_MIN_CLASSES", 3)
        self.hidden = _env_int("HEAD_HIDDEN", 0)
        self.epochs = _env_int("HEAD_EPOCHS", 500)
        # Blend weight of the head grows with how much it was trained on:
        # alpha = max_weight * n / (n + half), e.g. 20 labels -> 0.23,
        # 100 -> 0.53, 1000 -> 0.76. Zero-shot always keeps a say, which also covers classes
        # the head has never seen.
        self.head_max_weight = _env_float("HEAD_MAX_WEIGHT", 0.8)
        self.head_half = _env_float("HEAD_HALF_WEIGHT_AT", 50)
        self.threads = _env_int("ORT_THREADS", 2)


class Classifier:
    """Holds the ONNX sessions, the class text embeddings and the head."""

    def __init__(self, config: Config = None):
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self.config = config or Config()
        d = self.config.model_dir
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = self.config.threads
        opts.inter_op_num_threads = 1
        providers = ["CPUExecutionProvider"]
        self.vision = ort.InferenceSession(os.path.join(d, "onnx", "vision_model_quantized.onnx"),
                                           opts, providers=providers)
        text = ort.InferenceSession(os.path.join(d, "onnx", "text_model_quantized.onnx"),
                                    opts, providers=providers)
        tok = Tokenizer.from_file(os.path.join(d, "tokenizer.json"))
        rev_file = os.path.join(d, "REVISION")
        rev = "unknown"
        if os.path.exists(rev_file):
            with open(rev_file) as f:
                rev = f.read().strip()
        # Embeddings from different model files are not comparable; stored
        # embeddings carry this id so training can ignore stale ones.
        self.embedding_model = "clip-vit-b32-q8@" + rev.split("@")[-1][:12]

        self.classes = list(activities.CLASSES)
        self.class_index = {c: i for i, c in enumerate(self.classes)}
        self.text_embeds = self._class_embeddings(text, tok)       # (K, 512), unit length
        self.zero_shot_W = (LOGIT_SCALE * self.text_embeds).T       # (512, K)
        self.prompt_hash = hashlib.sha256(repr(activities.ACTIVITIES).encode()).hexdigest()[:12]

        self._lock = threading.Lock()
        self.head = None
        self._head_mtime = None
        self._head_checked = 0.0
        self.load_head()

    # ----- text side (once, at start-up) -----

    def _class_embeddings(self, session, tok):
        """One embedding per class: the normalised mean of its prompts' embeddings."""
        rows = []
        for key in activities.CLASSES:
            vecs = []
            for prompt in activities.ACTIVITIES[key]:
                ids = tok.encode(prompt).ids[:77]   # <|startoftext|> ... <|endoftext|>
                out = session.run(None, {"input_ids": np.array([ids], dtype=np.int64)})[0][0]
                vecs.append(l2_normalize(out))
            rows.append(l2_normalize(np.mean(vecs, axis=0)))
        return np.stack(rows)

    # ----- image side -----

    def embed(self, pixel_values: np.ndarray) -> np.ndarray:
        """(1, 3, 224, 224) -> unit-length (512,) image embedding."""
        out = self.vision.run(None, {"pixel_values": pixel_values})[0][0]
        return l2_normalize(out)

    def embed_bytes(self, data: bytes) -> np.ndarray:
        return self.embed(preprocess.preprocess_bytes(data))

    def zero_shot_proba(self, x: np.ndarray) -> np.ndarray:
        """x: (N, 512) or (512,) -> (N, K) probabilities."""
        x = l2_normalize(np.atleast_2d(x))
        return softmax(x @ self.zero_shot_W)

    def head_weight(self, head) -> float:
        n = float(head.meta.get("examples", 0) or 0)
        return self.config.head_max_weight * n / (n + self.config.head_half) if n > 0 else 0.0

    def predict(self, emb: np.ndarray):
        """Returns (probabilities over self.classes, mode)."""
        p = self.zero_shot_proba(emb)[0]
        head = self.head
        if head is None:
            return p, "zero-shot"
        # The head only outputs the classes it was trained on; put them back
        # into the full class list (unseen classes get 0 from the head).
        ph = np.zeros(len(self.classes))
        ph[[self.class_index[c] for c in head.classes]] = head.predict_proba(emb)[0]
        a = self.head_weight(head)
        return (1 - a) * p + a * ph, "head+zero-shot"

    def classify(self, data: bytes, top_k=TOP_K, with_embedding=False):
        self.maybe_reload_head()
        emb = self.embed_bytes(data)
        p, mode = self.predict(emb)
        order = np.argsort(-p)[:top_k]
        res = {"labels": [{"activity": self.classes[i], "score": round(float(p[i]), 4)} for i in order],
               "model": mode,
               "embeddingModel": self.embedding_model}
        if with_embedding:
            res["embedding"] = [round(float(v), 6) for v in emb]
        return res

    # ----- head -----

    def _mtime(self):
        try:
            return os.stat(self.config.head_path).st_mtime
        except OSError:
            return None

    def maybe_reload_head(self, every_sec=10.0):
        """Picks up a head written by the CLI (python -m app.train) while running."""
        now = time.time()
        if now - self._head_checked < every_sec:
            return
        self._head_checked = now
        if self._mtime() != self._head_mtime:
            self.load_head()

    def load_head(self):
        path = self.config.head_path
        head = None
        self._head_mtime = self._mtime()
        if os.path.exists(path):
            try:
                head = Head.load(path)
                if any(c not in self.class_index for c in head.classes):
                    head = None  # class list changed since training: retrain
                elif head.meta.get("embedding_model") not in ("", None, self.embedding_model):
                    head = None  # trained on another model's embeddings
            except Exception as e:  # corrupt file: fall back to zero-shot
                print(f"[ml] could not load head {path}: {e}")
                head = None
        self.head = head
        return head

    def train(self, examples, hidden=None, epochs=None):
        """Trains and (if enough data) saves + activates a new head."""
        cfg = self.config
        # Ignore embeddings produced by a different CLIP file.
        usable = [e for e in examples
                  if e.get("embeddingModel") in (None, "", self.embedding_model)]
        with self._lock:
            head, metrics = train_head(
                usable, self.class_index, self.zero_shot_W,
                hidden=cfg.hidden if hidden is None else hidden,
                epochs=cfg.epochs if epochs is None else epochs,
                min_examples=cfg.min_examples, min_classes=cfg.min_classes,
                zero_shot_proba=self.zero_shot_proba, embedding_model=self.embedding_model)
            metrics["staleEmbeddings"] = len(examples) - len(usable)
            if head is not None:
                os.makedirs(os.path.dirname(cfg.head_path) or ".", exist_ok=True)
                head.save(cfg.head_path)
                self.head = head
                self._head_mtime = self._mtime()
                metrics["headWeight"] = round(self.head_weight(head), 3)
            metrics["model"] = "zero-shot" if self.head is None else "head+zero-shot"
            return metrics

    def status(self):
        h = self.head
        return {"model": "zero-shot" if h is None else "head+zero-shot",
                "embeddingModel": self.embedding_model,
                "classes": self.classes,
                "promptHash": self.prompt_hash,
                "head": None if h is None else {
                    "classes": h.classes, "hidden": h.hidden,
                    "weight": round(self.head_weight(h), 3), **h.meta}}

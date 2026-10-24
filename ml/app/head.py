"""The trainable "head": a small neural network that learns from the labels
users confirm or correct in the app.

How it fits together
--------------------
CLIP turns every image into an embedding: 512 numbers that describe what is
in the picture. CLIP itself is frozen (we never change its 150 million
weights). The head is a tiny network that sits on top of the embedding and
answers just one question: "which of OUR activities is this?".

    image --CLIP--> x (512 numbers) --head--> z (one score per class) --softmax--> p

Default: a single linear layer (= multinomial logistic regression)
-------------------------------------------------------------------
    z = x @ W + b          W: 512 x K weights, b: K biases, K = classes

Each column of W is a direction in embedding space; z[k] is large when the
image points in the direction of class k. That is the same thing zero-shot
CLIP does with its text embeddings, which is why we START the head from the
zero-shot text embeddings (W column k = logit_scale * text embedding of
class k). Before training the head therefore predicts exactly like zero-shot;
training only nudges the directions towards what real users' photos look
like.

Optional: one hidden layer (hidden > 0)
    h = relu(x @ W1 + b1)   then   z = h @ W2 + b2
More flexible, but needs more data; it starts from random weights.

Softmax: scores -> probabilities
    p[k] = exp(z[k]) / sum_j exp(z[j])
All p are between 0 and 1 and sum to 1. Subtracting max(z) first changes
nothing mathematically but avoids overflow in exp().

Cross-entropy: how wrong is the network?
    loss = -mean_i log p_i[y_i]           (y_i = the true class of example i)
If the network gives the right class probability 1, loss = 0; if it gives
it 0.01, loss = 4.6. We add a small "weight decay" term
    + (lambda / 2) * ||W - W_start||^2
that keeps W close to where it started (the zero-shot solution), so a
handful of labels cannot drag it somewhere silly.

Gradient descent: how it learns
    For softmax + cross-entropy the gradient has a famously simple form:
        dLoss/dz = (p - onehot(y)) / N
    i.e. "predicted minus true". The chain rule then gives
        dLoss/dW = x^T @ dz + lambda * (W - W_start)
        dLoss/db = sum over examples of dz
    and we take a small step downhill:  W <- W - learning_rate * dLoss/dW.
    Repeat a few hundred times (epochs) and the loss goes down.

Everything here is plain numpy, so you can read every step.
"""
import os
import time

import numpy as np

EPS = 1e-12


# ===== Building blocks =====

def softmax(z: np.ndarray) -> np.ndarray:
    """Row-wise softmax. z: (N, K) or (K,)."""
    z = np.asarray(z, dtype=np.float64)
    z = z - z.max(axis=-1, keepdims=True)  # stability: exp of big numbers overflows
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def cross_entropy(p: np.ndarray, y: np.ndarray) -> float:
    """Mean negative log-probability of the true classes. p: (N, K), y: (N,) ints."""
    return float(-np.mean(np.log(p[np.arange(len(y)), y] + EPS)))


def l2_normalize(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    return x / (np.linalg.norm(x, axis=-1, keepdims=True) + EPS)


def accuracy(p: np.ndarray, y: np.ndarray) -> float:
    return float(np.mean(np.argmax(p, axis=1) == y)) if len(y) else 0.0


# ===== The head =====

class Head:
    """A trained head: weights + the class names its outputs correspond to."""

    def __init__(self, classes, W, b, W1=None, b1=None, meta=None):
        self.classes = list(classes)
        self.W, self.b = W, b            # output layer
        self.W1, self.b1 = W1, b1        # hidden layer (None for the linear head)
        self.meta = meta or {}

    @property
    def hidden(self) -> int:
        return 0 if self.W1 is None else self.W1.shape[1]

    def logits(self, x: np.ndarray) -> np.ndarray:
        x = l2_normalize(np.atleast_2d(x))
        if self.W1 is not None:
            x = np.maximum(0.0, x @ self.W1 + self.b1)   # ReLU hidden layer
        return x @ self.W + self.b

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        """(N, len(classes)) probabilities."""
        return softmax(self.logits(x))

    # --- persistence (.npz, no pickle so loading a file can't run code) ---

    def save(self, path: str) -> None:
        arrays = {"classes": np.array(self.classes, dtype=str), "W": self.W, "b": self.b,
                  "meta_keys": np.array(list(self.meta.keys()), dtype=str),
                  "meta_vals": np.array([str(v) for v in self.meta.values()], dtype=str)}
        if self.W1 is not None:
            arrays.update(W1=self.W1, b1=self.b1)
        tmp = path + ".tmp.npz"
        np.savez(tmp, **arrays)
        os.replace(tmp, path)  # atomic: a reader never sees a half-written file

    @staticmethod
    def load(path: str) -> "Head":
        with np.load(path, allow_pickle=False) as f:
            meta = dict(zip(f["meta_keys"].tolist(), f["meta_vals"].tolist()))
            W1 = f["W1"] if "W1" in f.files else None
            b1 = f["b1"] if "b1" in f.files else None
            return Head(f["classes"].tolist(), f["W"], f["b"], W1, b1, meta)


def fit(x, y, n_classes, *, W0=None, hidden=0, lr=1.0, epochs=500, weight_decay=1e-3, seed=0):
    """Full-batch gradient descent on softmax cross-entropy.

    x: (N, D) L2-normalised embeddings, y: (N,) class indices.
    W0: optional (D, K) starting weights (the zero-shot directions); also the
        point weight decay pulls towards. Only used for the linear head.
    lr: for the linear head a fraction of the largest safe step (<= 1.0);
        for the hidden-layer net the plain learning rate.
    Returns (params dict, list of losses per epoch).
    """
    rng = np.random.default_rng(seed)
    x = l2_normalize(x)
    n, d = x.shape
    onehot = np.zeros((n, n_classes))
    onehot[np.arange(n), y] = 1.0
    losses = []

    if hidden <= 0:
        W_start = np.zeros((d, n_classes)) if W0 is None else np.array(W0, dtype=np.float64)
        W, b = W_start.copy(), np.zeros(n_classes)
        # How big a step is safe? For softmax cross-entropy the loss curves
        # at most 0.5 * (largest eigenvalue of x^T x / N) [+ weight decay].
        # Stepping by 1 / that curvature ("1/L") always goes downhill, so we
        # never have to hand-tune a learning rate for different datasets.
        xb = np.hstack([x, np.ones((n, 1))])            # bias = weight on a constant 1
        curvature = 0.5 * float(np.linalg.eigvalsh(xb.T @ xb / n)[-1]) + weight_decay
        step = lr / curvature
        for _ in range(epochs):
            p = softmax(x @ W + b)                        # forward pass
            losses.append(cross_entropy(p, y)
                          + 0.5 * weight_decay * float(np.sum((W - W_start) ** 2)))
            dz = (p - onehot) / n                         # predicted minus true
            dW = x.T @ dz + weight_decay * (W - W_start)  # chain rule + decay
            db = dz.sum(axis=0)
            W -= step * dW                                # step downhill
            b -= step * db
        return {"W": W, "b": b}, losses

    # One hidden layer with ReLU, random start. Inputs are multiplied by
    # sqrt(D) so each coordinate is about +-1 (unit-length vectors have tiny
    # coordinates); He initialisation keeps the signal size stable.
    xs = x * np.sqrt(d)
    W1 = rng.normal(0, np.sqrt(2.0 / d), (d, hidden))
    b1 = np.zeros(hidden)
    W2 = rng.normal(0, np.sqrt(2.0 / hidden), (hidden, n_classes))
    b2 = np.zeros(n_classes)
    for _ in range(epochs):
        a = xs @ W1 + b1
        h = np.maximum(0.0, a)                            # ReLU
        p = softmax(h @ W2 + b2)
        losses.append(cross_entropy(p, y)
                      + 0.5 * weight_decay * float(np.sum(W1 ** 2) + np.sum(W2 ** 2)))
        dz = (p - onehot) / n                             # predicted minus true
        dW2 = h.T @ dz + weight_decay * W2
        db2 = dz.sum(axis=0)
        dh = dz @ W2.T                                    # back through the output layer
        da = dh * (a > 0)                                 # ReLU passes gradient only where active
        dW1 = xs.T @ da + weight_decay * W1
        db1 = da.sum(axis=0)
        W2 -= lr * dW2
        b2 -= lr * db2
        W1 -= lr * dW1
        b1 -= lr * db1
    # Fold the sqrt(D) input scaling into W1 so Head.logits can use x as-is.
    return {"W": W2, "b": b2, "W1": W1 * np.sqrt(d), "b1": b1}, losses


def split(y, val_fraction=0.2, seed=0):
    """Stratified train/validation split: about `val_fraction` of every class
    with >= 2 examples goes to validation, so rare classes still get trained."""
    rng = np.random.default_rng(seed)
    train, val = [], []
    for c in np.unique(y):
        idx = rng.permutation(np.where(y == c)[0])
        k = int(round(len(idx) * val_fraction)) if len(idx) >= 2 else 0
        k = min(k, len(idx) - 1)
        val.extend(idx[:k])
        train.extend(idx[k:])
    return np.array(sorted(train), dtype=int), np.array(sorted(val), dtype=int)


def train_head(examples, class_index, zero_shot_W=None, *, hidden=0, lr=None, epochs=500,
               weight_decay=1e-3, val_fraction=0.2, min_examples=20, min_classes=3, seed=0,
               zero_shot_proba=None, embedding_model=""):
    """Trains a head from [{embedding, activity}] examples.

    class_index: {activity: column} for all known classes. Unknown activities
                 are skipped (they are counted in the result).
    zero_shot_W: (D, K_all) zero-shot weights, used to initialise the linear head.
    zero_shot_proba: optional function x -> (N, K_all) zero-shot probabilities,
                 used to report the zero-shot baseline on the same split.

    Returns (head or None, metrics dict). The head is fitted on ALL data after
    the held-out evaluation, so no label is wasted in the saved model.
    """
    xs, labels, skipped = [], [], 0
    for ex in examples:
        a, e = ex.get("activity"), ex.get("embedding")
        if a not in class_index or not isinstance(e, (list, tuple)) or not e:
            skipped += 1
            continue
        xs.append(np.asarray(e, dtype=np.float64))
        labels.append(a)
    dims = {len(v) for v in xs}
    if len(dims) > 1:
        raise ValueError(f"embeddings have different sizes: {sorted(dims)}")

    present = sorted(set(labels), key=lambda a: class_index[a])
    counts = {a: labels.count(a) for a in present}
    metrics = {"examples": len(labels), "skipped": skipped, "classes": len(present),
               "perClass": counts}
    if len(labels) < min_examples or len(present) < min_classes:
        metrics.update(trained=False,
                       reason=f"need at least {min_examples} labelled examples across "
                              f"{min_classes} activities (have {len(labels)} across {len(present)})")
        return None, metrics

    x = l2_normalize(np.stack(xs))
    local = {a: i for i, a in enumerate(present)}      # head only knows classes it has seen
    y = np.array([local[a] for a in labels])
    W0 = None
    if zero_shot_W is not None and hidden <= 0:
        W0 = np.asarray(zero_shot_W)[:, [class_index[a] for a in present]]

    if lr is None:
        lr = 1.0 if hidden <= 0 else 0.1
    hp = dict(hidden=hidden, lr=lr, epochs=epochs, weight_decay=weight_decay, seed=seed)
    tr, va = split(y, val_fraction, seed)
    params, losses = fit(x[tr], y[tr], len(present), W0=W0, **hp)
    probe = Head(present, params["W"], params["b"], params.get("W1"), params.get("b1"))
    metrics["trainAccuracy"] = round(accuracy(probe.predict_proba(x[tr]), y[tr]), 4)
    metrics["trainExamples"] = int(len(tr))
    metrics["valExamples"] = int(len(va))
    if len(va):
        metrics["valAccuracy"] = round(accuracy(probe.predict_proba(x[va]), y[va]), 4)
        if zero_shot_proba is not None:
            zs = zero_shot_proba(x[va])
            all_classes = sorted(class_index, key=class_index.get)
            zs_pred = [all_classes[i] for i in np.argmax(zs, axis=1)]
            metrics["zeroShotValAccuracy"] = round(
                float(np.mean([p == present[t] for p, t in zip(zs_pred, y[va])])), 4)
    metrics["finalLoss"] = round(losses[-1], 4) if losses else None

    # Refit on everything for the model we actually keep.
    params, losses = fit(x, y, len(present), W0=W0, **hp)
    meta = {"trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "examples": len(labels), "hidden": hidden, "embedding_model": embedding_model,
            "val_accuracy": metrics.get("valAccuracy", ""),
            "zero_shot_val_accuracy": metrics.get("zeroShotValAccuracy", "")}
    head = Head(present, params["W"], params["b"], params.get("W1"), params.get("b1"), meta)
    metrics.update(trained=True, hidden=hidden, epochs=epochs)
    return head, metrics

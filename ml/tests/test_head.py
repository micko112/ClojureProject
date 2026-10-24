import os
import tempfile
import unittest

import numpy as np

from app.head import Head, accuracy, cross_entropy, fit, l2_normalize, softmax, split, train_head


def synthetic(n_per_class=30, classes=("running", "reading", "cooking"), d=512, noise=0.6, seed=0):
    """Clusters around random unit 'class directions', like CLIP embeddings
    of photos of the same activity."""
    rng = np.random.default_rng(seed)
    centres = l2_normalize(rng.normal(size=(len(classes), d)))
    xs, ys = [], []
    for i, c in enumerate(classes):
        pts = centres[i] + noise * rng.normal(size=(n_per_class, d)) / np.sqrt(d)
        xs.append(l2_normalize(pts))
        ys += [c] * n_per_class
    return np.vstack(xs), ys, centres


class SoftmaxTest(unittest.TestCase):
    def test_sums_to_one_and_keeps_order(self):
        p = softmax(np.array([1.0, 2.0, 3.0]))
        self.assertAlmostEqual(float(p.sum()), 1.0)
        self.assertTrue(p[2] > p[1] > p[0])

    def test_is_stable_for_huge_logits(self):
        p = softmax(np.array([[1000.0, 1001.0], [-1000.0, -1000.0]]))
        self.assertTrue(np.all(np.isfinite(p)))
        np.testing.assert_allclose(p[1], [0.5, 0.5])

    def test_shift_invariant(self):
        z = np.array([0.3, -1.2, 2.0])
        np.testing.assert_allclose(softmax(z), softmax(z + 50))

    def test_cross_entropy(self):
        p = np.array([[1.0, 0.0], [0.5, 0.5]])
        self.assertAlmostEqual(cross_entropy(p, np.array([0, 1])), np.log(2) / 2, places=6)


class GradientTest(unittest.TestCase):
    def test_analytic_gradient_matches_numeric(self):
        """dLoss/dW = x^T (p - y) / N, checked against finite differences."""
        rng = np.random.default_rng(1)
        x = l2_normalize(rng.normal(size=(6, 5)))
        y = np.array([0, 1, 2, 0, 1, 2])
        W = rng.normal(size=(5, 3))
        onehot = np.eye(3)[y]
        p = softmax(x @ W)
        analytic = x.T @ (p - onehot) / len(y)
        numeric = np.zeros_like(W)
        h = 1e-6
        for i in range(W.shape[0]):
            for j in range(W.shape[1]):
                Wp, Wm = W.copy(), W.copy()
                Wp[i, j] += h
                Wm[i, j] -= h
                numeric[i, j] = (cross_entropy(softmax(x @ Wp), y)
                                 - cross_entropy(softmax(x @ Wm), y)) / (2 * h)
        np.testing.assert_allclose(analytic, numeric, atol=1e-6)


class FitTest(unittest.TestCase):
    def test_linear_head_learns_separable_clusters_and_loss_goes_down(self):
        x, ys, _ = synthetic()
        y = np.array([("running", "reading", "cooking").index(v) for v in ys])
        params, losses = fit(x, y, 3, epochs=200)
        self.assertLess(losses[-1], losses[0] * 0.5)
        self.assertTrue(all(b <= a + 1e-9 for a, b in zip(losses, losses[1:])),
                        "1/L step size should never increase the loss")
        p = softmax(x @ params["W"] + params["b"])
        self.assertGreater(accuracy(p, y), 0.95)

    def test_hidden_layer_head_learns_too(self):
        x, ys, _ = synthetic()
        y = np.array([("running", "reading", "cooking").index(v) for v in ys])
        params, losses = fit(x, y, 3, hidden=32, epochs=300, lr=0.1)
        head = Head(["a", "b", "c"], params["W"], params["b"], params["W1"], params["b1"])
        self.assertLess(losses[-1], losses[0])
        self.assertGreater(accuracy(head.predict_proba(x), y), 0.95)

    def test_starting_from_zero_shot_weights_reproduces_them(self):
        x, ys, centres = synthetic()
        W0 = 100 * centres.T
        y = np.array([("running", "reading", "cooking").index(v) for v in ys])
        params, _ = fit(x, y, 3, W0=W0, epochs=0)
        np.testing.assert_allclose(params["W"], W0)


class SplitTest(unittest.TestCase):
    def test_stratified_and_disjoint(self):
        y = np.array([0] * 10 + [1] * 5 + [2] * 1)
        tr, va = split(y, 0.2)
        self.assertEqual(set(tr) & set(va), set())
        self.assertEqual(len(tr) + len(va), len(y))
        self.assertEqual(sorted(y[va].tolist()), [0, 0, 1])  # singleton class stays in train


class TrainHeadTest(unittest.TestCase):
    classes = ["running", "reading", "cooking", "other"]

    def index(self):
        return {c: i for i, c in enumerate(self.classes)}

    def test_refuses_with_too_few_examples_or_classes(self):
        x, ys, _ = synthetic(n_per_class=5)
        ex = [{"embedding": v.tolist(), "activity": a} for v, a in zip(x, ys)]
        head, m = train_head(ex, self.index(), min_examples=20)
        self.assertIsNone(head)
        self.assertFalse(m["trained"])
        two = [e for e in ex if e["activity"] != "cooking"] * 3
        head, m = train_head(two, self.index(), min_examples=20, min_classes=3)
        self.assertIsNone(head)

    def test_trains_reports_metrics_and_skips_unknown_labels(self):
        x, ys, _ = synthetic(n_per_class=25)
        ex = [{"embedding": v.tolist(), "activity": a} for v, a in zip(x, ys)]
        ex.append({"embedding": x[0].tolist(), "activity": "skydiving"})
        ex.append({"activity": "running"})
        head, m = train_head(ex, self.index(), epochs=200)
        self.assertTrue(m["trained"])
        self.assertEqual(m["examples"], 75)
        self.assertEqual(m["skipped"], 2)
        self.assertEqual(m["valExamples"], 15)
        self.assertGreaterEqual(m["valAccuracy"], 0.9)
        self.assertEqual(head.classes, ["running", "reading", "cooking"])  # only seen classes

    def test_save_and_load_round_trip(self):
        x, ys, _ = synthetic(n_per_class=10)
        ex = [{"embedding": v.tolist(), "activity": a} for v, a in zip(x, ys)]
        for hidden in (0, 8):
            head, _ = train_head(ex, self.index(), hidden=hidden, epochs=50, embedding_model="m1")
            with tempfile.TemporaryDirectory() as d:
                path = os.path.join(d, "head.npz")
                head.save(path)
                back = Head.load(path)
            self.assertEqual(back.classes, head.classes)
            self.assertEqual(back.hidden, hidden)
            self.assertEqual(back.meta["embedding_model"], "m1")
            np.testing.assert_allclose(back.predict_proba(x), head.predict_proba(x))

    def test_mismatched_embedding_sizes_are_rejected(self):
        ex = [{"embedding": [0.1] * 4, "activity": "running"},
              {"embedding": [0.1] * 5, "activity": "reading"}]
        with self.assertRaises(ValueError):
            train_head(ex, self.index(), min_examples=1, min_classes=1)


if __name__ == "__main__":
    unittest.main()

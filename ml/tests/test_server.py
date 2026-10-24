"""HTTP smoke tests.

FakeServerTest runs everywhere (a stand-in classifier, no model files).
RealModelTest loads the real CLIP files and is skipped when they have not
been downloaded (python scripts/download_model.py).
"""
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

from app import server

MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "models"))
HAVE_MODEL = os.path.exists(os.path.join(MODEL_DIR, "onnx", "vision_model_quantized.onnx"))


def jpeg(color=(200, 80, 40), size=(320, 240)):
    b = io.BytesIO()
    Image.new("RGB", size, color).save(b, "JPEG")
    return b.getvalue()


def multipart(field, filename, data, boundary="XyZ123"):
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; "
            f"filename=\"{filename}\"\r\nContent-Type: image/jpeg\r\n\r\n").encode() + data + \
           f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


class FakeClassifier:
    def __init__(self):
        self.seen = []
        self.trained = None

    def classify(self, data, top_k=3, with_embedding=False):
        self.seen.append(data)
        res = {"labels": [{"activity": "running", "score": 0.9}][:top_k], "model": "zero-shot",
               "embeddingModel": "fake"}
        if with_embedding:
            res["embedding"] = [0.0] * 512
        return res

    def train(self, examples, **opts):
        self.trained = (examples, opts)
        return {"trained": False, "examples": len(examples)}

    def status(self):
        return {"model": "zero-shot", "classes": ["running"]}


class ServerCase(unittest.TestCase):
    @classmethod
    def start(cls):
        cls.httpd = server.make_server("127.0.0.1", 0)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        server.State.classifier = None

    def call(self, method, path, body=None, ctype="application/octet-stream", headers=None):
        req = urllib.request.Request(self.base + path, data=body, method=method,
                                     headers={"Content-Type": ctype, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")


class FakeServerTest(ServerCase):
    @classmethod
    def setUpClass(cls):
        server.State.classifier = None
        cls.start()

    def setUp(self):
        self.fake = FakeClassifier()
        server.State.classifier = self.fake

    def test_health_is_503_while_loading(self):
        server.State.classifier = None
        status, body = self.call("GET", "/health")
        self.assertEqual(status, 503)
        self.assertEqual(body["status"], "loading")

    def test_health_ok(self):
        status, body = self.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")

    def test_classify_raw_bytes(self):
        img = jpeg()
        status, body = self.call("POST", "/classify", img, "image/jpeg")
        self.assertEqual(status, 200)
        self.assertEqual(body["labels"][0]["activity"], "running")
        self.assertNotIn("embedding", body)
        self.assertEqual(self.fake.seen[-1], img)

    def test_classify_multipart_with_embedding(self):
        img = jpeg()
        data, ctype = multipart("file", "a.jpg", img)
        status, body = self.call("POST", "/classify?embedding=1", data, ctype)
        self.assertEqual(status, 200)
        self.assertEqual(len(body["embedding"]), 512)
        self.assertEqual(self.fake.seen[-1], img)

    def test_classify_empty_body(self):
        status, _ = self.call("POST", "/classify", b"")
        self.assertEqual(status, 400)

    def test_train_accepts_list_and_object(self):
        ex = [{"embedding": [0.1, 0.2], "activity": "running"}]
        status, body = self.call("POST", "/train", json.dumps(ex).encode(), "application/json")
        self.assertEqual((status, body["examples"]), (200, 1))
        status, _ = self.call("POST", "/train", json.dumps({"examples": ex, "hidden": 16}).encode(),
                              "application/json")
        self.assertEqual(status, 200)
        self.assertEqual(self.fake.trained[1], {"hidden": 16})

    def test_train_rejects_bad_json_and_checks_token(self):
        status, _ = self.call("POST", "/train", b"{nope", "application/json")
        self.assertEqual(status, 400)
        os.environ["ML_TOKEN"] = "s3cret"
        try:
            status, _ = self.call("POST", "/train", b"[]", "application/json")
            self.assertEqual(status, 401)
            status, _ = self.call("POST", "/train", b"[]", "application/json", {"X-ML-Token": "s3cret"})
            self.assertEqual(status, 200)
        finally:
            del os.environ["ML_TOKEN"]

    def test_unknown_path(self):
        self.assertEqual(self.call("GET", "/nope")[0], 404)


@unittest.skipUnless(HAVE_MODEL, "CLIP model not downloaded (run scripts/download_model.py)")
class RealModelTest(ServerCase):
    @classmethod
    def setUpClass(cls):
        from app.classifier import Classifier, Config
        cls.tmp = tempfile.mkdtemp()
        os.environ["HEAD_PATH"] = os.path.join(cls.tmp, "head.npz")
        os.environ["MODEL_DIR"] = MODEL_DIR
        server.State.classifier = Classifier(Config())
        cls.start()

    def test_classify_returns_top3_probabilities_and_embedding(self):
        status, body = self.call("POST", "/classify?embedding=true", jpeg(), "image/jpeg")
        self.assertEqual(status, 200)
        self.assertEqual(body["model"], "zero-shot")
        self.assertEqual(len(body["labels"]), 3)
        scores = [l["score"] for l in body["labels"]]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertLessEqual(sum(scores), 1.0001)
        emb = np.array(body["embedding"])
        self.assertEqual(emb.shape, (512,))
        self.assertAlmostEqual(float(np.linalg.norm(emb)), 1.0, places=3)

    def test_garbage_image_is_422(self):
        status, _ = self.call("POST", "/classify", b"definitely not a jpeg", "image/jpeg")
        self.assertEqual(status, 422)

    def test_train_switches_to_head_and_back_is_persisted(self):
        clf = server.State.classifier
        rng = np.random.default_rng(0)
        # Use the class text directions as stand-in image embeddings.
        ex = []
        for k in ("running", "reading", "cooking"):
            centre = clf.text_embeds[clf.class_index[k]]
            for _ in range(10):
                v = centre + 0.3 * rng.normal(size=512) / np.sqrt(512)
                ex.append({"embedding": (v / np.linalg.norm(v)).tolist(), "activity": k})
        status, m = self.call("POST", "/train", json.dumps(ex).encode(), "application/json")
        self.assertEqual(status, 200)
        self.assertTrue(m["trained"], m)
        self.assertEqual(m["model"], "head+zero-shot")
        self.assertTrue(os.path.exists(os.environ["HEAD_PATH"]))
        status, body = self.call("POST", "/classify", jpeg(), "image/jpeg")
        self.assertEqual(body["model"], "head+zero-shot")
        clf.head = None
        self.assertIsNotNone(clf.load_head())


if __name__ == "__main__":
    unittest.main()

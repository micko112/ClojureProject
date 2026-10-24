"""HTTP API of the activity classifier.

    GET  /health      200 {status: "ok", model, embeddingModel, classes, head}
                      503 while the model is still loading
    POST /classify    body: raw image bytes (any Content-Type) or multipart
                      with a `file` field. Query: ?embedding=1 adds the
                      512-number embedding, ?top=N (default 3).
                      -> {labels: [{activity, score}], model, embeddingModel, embedding?}
    POST /train       body: [{embedding, activity, embeddingModel?}] or
                      {examples: [...], hidden?, epochs?}
                      -> metrics (accuracy on a held-out split, ...)

Built on the standard library's ThreadingHTTPServer instead of a web
framework: the service has three endpoints, is only reachable from the
backend on the private Docker network, and spends its time inside ONNX
Runtime (which releases the GIL), so a framework would add dependencies and
image size without adding anything we use.

If ML_TOKEN is set, POST /train requires the header `X-ML-Token: <token>`.
"""
import json
import os
import sys
import threading
import time
import traceback
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", 20 * 1024 * 1024))
MAX_TRAIN_BYTES = int(os.environ.get("MAX_TRAIN_BYTES", 200 * 1024 * 1024))
MAX_PARALLEL = int(os.environ.get("MAX_PARALLEL", 4))


class State:
    classifier = None
    error = None
    started = time.time()
    slots = threading.BoundedSemaphore(MAX_PARALLEL)


def load_classifier(factory=None):
    """Loads the model (a few seconds); the server answers 503 meanwhile."""
    try:
        if factory is None:
            from .classifier import Classifier
            factory = Classifier
        t = time.time()
        State.classifier = factory()
        print(f"[ml] model ready in {time.time() - t:.1f}s "
              f"({State.classifier.status()['model']})", flush=True)
    except Exception as e:  # missing model files etc.
        State.error = f"{type(e).__name__}: {e}"
        traceback.print_exc()


def extract_file(content_type: str, body: bytes):
    """Image bytes from a multipart body (field `file`, else the first file part)."""
    msg = BytesParser(policy=policy.HTTP).parsebytes(
        b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + body)
    first = None
    for part in msg.iter_parts():
        payload = part.get_payload(decode=True)
        if payload is None:
            continue
        name = part.get_param("name", header="content-disposition")
        if name == "file":
            return payload
        if first is None and part.get_filename():
            first = payload
    return first


class Handler(BaseHTTPRequestHandler):
    server_version = "bebetter-ml/1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # one short line per request
        sys.stderr.write("[ml] %s %s\n" % (self.address_string(), fmt % args))

    def _send(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return None, (400, {"error": "empty body"})
        if n > limit:
            self.close_connection = True  # the unread body must not be parsed as the next request
            return None, (413, {"error": f"body too large (max {limit} bytes)"})
        return self.rfile.read(n), None

    def _ready(self):
        if State.classifier is None:
            self._send(503, {"status": "error" if State.error else "loading", "error": State.error})
            return False
        return True

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            if self._ready():
                self._send(200, {"status": "ok", "uptimeSec": round(time.time() - State.started),
                                 **State.classifier.status()})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path == "/classify":
            self._classify(parse_qs(url.query))
        elif url.path == "/train":
            self._train()
        else:
            self._send(404, {"error": "not found"})

    def _classify(self, q):
        body, err = self._body(MAX_IMAGE_BYTES)
        if err:
            return self._send(*err)
        if not self._ready():
            return
        ctype = self.headers.get("Content-Type", "")
        if ctype.startswith("multipart/"):
            body = extract_file(ctype, body)
            if not body:
                return self._send(400, {"error": "multipart body has no file"})
        want_emb = q.get("embedding", ["0"])[0].lower() in ("1", "true", "yes")
        try:
            top = max(1, min(25, int(q.get("top", ["3"])[0])))
        except ValueError:
            top = 3
        with State.slots:
            try:
                res = State.classifier.classify(body, top_k=top, with_embedding=want_emb)
            except Exception as e:
                return self._send(422, {"error": f"could not read image: {type(e).__name__}"})
        self._send(200, res)

    def _train(self):
        token = os.environ.get("ML_TOKEN")
        if token and self.headers.get("X-ML-Token") != token:
            return self._send(401, {"error": "bad token"})
        body, err = self._body(MAX_TRAIN_BYTES)
        if err:
            return self._send(*err)
        if not self._ready():
            return
        try:
            payload = json.loads(body)
        except ValueError:
            return self._send(400, {"error": "body must be JSON"})
        opts = {}
        if isinstance(payload, dict):
            examples = payload.get("examples") or []
            for k in ("hidden", "epochs"):
                if isinstance(payload.get(k), int):
                    opts[k] = payload[k]
        else:
            examples = payload
        if not isinstance(examples, list):
            return self._send(400, {"error": "expected a list of {embedding, activity}"})
        t = time.time()
        try:
            metrics = State.classifier.train([e for e in examples if isinstance(e, dict)], **opts)
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        metrics["seconds"] = round(time.time() - t, 2)
        self._send(200, metrics)


def make_server(host="0.0.0.0", port=8000):
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    return httpd


def main():
    port = int(os.environ.get("PORT", 8000))
    httpd = make_server(os.environ.get("HOST", "0.0.0.0"), port)
    threading.Thread(target=load_classifier, daemon=True).start()
    print(f"[ml] listening on :{port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

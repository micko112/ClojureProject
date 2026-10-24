# BeBetter activity classifier

When someone picks a photo in the composer, the app says
**"Looks like: 🏃 Running 87%"** and pre-fills the activity tag. The tag they
finally post with (kept or changed) is stored as a label, and those labels
train a small neural network that makes the next suggestions better.

This folder is that classifier: a small Python HTTP service the Clojure
backend calls (`web.vision`). It runs on CPU, needs no GPU and no paid API.

```
 photo ──► CLIP image encoder ──► embedding (512 numbers)
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
        zero-shot: compare with the           head: small neural network
        text "a photo of a person running"    trained on users' labels
        (and 23 other activities)             (once there are enough)
                    └─────────────────┬─────────────────┘
                                      ▼
                         blend ──► softmax ──► top 3
```

## The ideas, in simple terms

### What is an embedding?

A list of numbers that describes what is in a picture. CLIP (a model
OpenAI trained on 400 million pictures with their captions) turns any image
into 512 numbers. Pictures of similar things get similar numbers: two photos
of people running point in almost the same direction in this 512-dimensional
space, a photo of a bookshelf points somewhere else.

CLIP also has a **text** encoder that turns a sentence into 512 numbers *in
the same space*. Training pushed each image and its own caption to point the
same way.

"Pointing the same way" is measured with **cosine similarity**: 1 means the
same direction, 0 unrelated. (Embeddings are scaled to length 1, so this is
just the dot product: multiply the numbers pairwise and add them up.)

### Zero-shot classification

We never showed the model a single BeBetter photo. Instead, for every
activity we wrote a few sentences (`app/activities.py`):

```
running:  "a photo of a person running", "a person jogging outdoors", ...
reading:  "a photo of a person reading a book", "an open book", ...
```

We embed those sentences once at start-up and average each activity's
sentences into one direction (a "prompt ensemble" — more robust than one
sentence). For a new photo we compute its embedding and its cosine
similarity with each activity. The most similar activity wins. That's
classification with zero training examples: **zero-shot**.

### Softmax: turning scores into percentages

Similarities are small numbers that are close together (0.21, 0.27, 0.24 …).
We multiply them by CLIP's learned "temperature" of 100 and apply
**softmax**:

```
p[k] = exp(score[k]) / (exp(score[1]) + exp(score[2]) + ... )
```

Every `p` is between 0 and 1, they sum to 1, and the biggest score gets the
biggest share. That's the "87 %" in the app. It's the model's confidence,
not a guarantee.

### The head: a small network that learns from users

Zero-shot is good but generic. Our users' gym photos (mirror selfies,
specific lighting) are a particular kind of photo. So on top of the frozen
CLIP we put a **head**: one layer of a neural network (`app/head.py`):

```
scores = embedding · W + b        (W: 512 × K numbers, b: K numbers, K = activities)
p      = softmax(scores)
```

Each column of `W` is a direction in embedding space for one activity — the
same thing zero-shot uses. So the head **starts as a copy of zero-shot** (W =
100 × the text directions) and training only nudges those directions toward
what real users' photos look like. (`HEAD_HIDDEN=64` adds a hidden layer with
ReLU — more flexible, needs more data, starts from random weights.)

### Cross-entropy: how wrong is it?

For each labelled photo we look at the probability the head gave to the
**correct** activity and take `-log` of it:

| p(correct) | loss |
|---|---|
| 0.99 | 0.01 |
| 0.5  | 0.69 |
| 0.01 | 4.6  |

The average over all labelled photos is the **cross-entropy loss**. Lower is
better. A small extra term keeps `W` close to its zero-shot start, so a
handful of labels can't drag it somewhere silly ("weight decay").

### Gradient descent: how it learns

The gradient tells us, for every number in `W`, which way to move it to make
the loss smaller. For softmax + cross-entropy it is famously simple:

```
d loss / d scores = p − y        (predicted probabilities minus the true one-hot answer)
d loss / d W      = embeddingᵀ · (p − y) / N
```

We move every weight a small step downhill, `W ← W − step · gradient`, and
repeat 500 times. The step size is computed from the data ("1/L", the largest
step that is guaranteed not to overshoot), so there is no learning rate to
tune. All of it is ~40 lines of numpy in `app/head.py`, and
`tests/test_head.py` checks the gradient against a numerical one.

### Blending

The head only knows activities it has seen labels for, and with few labels
it's unreliable. So predictions mix both:

```
p = (1 − a) · p_zero_shot + a · p_head,     a = 0.8 · n / (n + 50)
```

where `n` is the number of labels the head was trained on (20 labels →
a = 0.23, 100 → 0.53, 1000 → 0.76). The response says
`"model": "zero-shot"` or `"head+zero-shot"`.

## How well does it work?

Measured on 1,260 real photos from public datasets (Stanford 40 Actions,
Human Action Recognition, a sports dataset, a yoga-poses dataset), mapped to
our activities:

| | top-1 | top-3 |
|---|---|---|
| zero-shot, all 23 activities | 69 % | 84 % |
| zero-shot without the "other" folder | ~80 % | ~95 % |

Strong: cycling, swimming, climbing, cooking, music, gardening, walking, yoga
(92–100 %). Weak: "writing in a notebook" is usually called *studying*;
floor cleaning / washing dishes is often *cooking*; Olympic weightlifting
photos are called *sports* rather than *gym*; photos that are none of our
activities (horse riding, fishing) are almost never put in *other* —
they get the closest activity instead. Training the head on half of the
photos and testing on the other half: 69 % → 83 % (60 labels), 87 %
(150 labels), 91 % (619 labels). Those labels came from the same datasets
as the test photos, so real-world gains will be smaller, but the trend is
the point: **every confirmed or corrected tag helps.**

## Running it

```bash
cd ml
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python scripts/download_model.py          # ~155 MB into ml/models/ (gitignored)
python -m app                             # http://localhost:8000
curl -s --data-binary @photo.jpg -H 'Content-Type: image/jpeg' localhost:8000/classify
python -m unittest discover -s tests -t . -v
```

With Docker: `docker compose up ml` (the model is downloaded at build time,
pinned to a HuggingFace commit in `scripts/download_model.py`).

### API

| | |
|---|---|
| `GET /health` | `{status, model, embeddingModel, classes, head}`; 503 while loading |
| `POST /classify` | raw image bytes or multipart `file`; `?embedding=1`, `?top=3` → `{labels: [{activity, score}], model, embeddingModel, embedding?}` |
| `POST /train` | `[{embedding, activity}]` or `{examples, hidden?, epochs?}` → metrics |

The backend is the only client. In production the service has no public
port; set `ML_TOKEN` (same value for backend and ml) to also require a token
for `/train`.

### Settings (environment)

| Variable | Default | |
|---|---|---|
| `MODEL_DIR` | `ml/models`, `/opt/model` in Docker | downloaded CLIP files |
| `HEAD_PATH` | `ml/data/head.npz`, `/data/head.npz` in Docker | trained head (volume) |
| `HEAD_MIN_EXAMPLES` / `HEAD_MIN_CLASSES` | 20 / 3 | needed before a head is trained |
| `HEAD_HIDDEN` | 0 | hidden units (0 = single linear layer) |
| `HEAD_EPOCHS` | 500 | gradient descent steps |
| `HEAD_MAX_WEIGHT` / `HEAD_HALF_WEIGHT_AT` | 0.8 / 50 | blending (see above) |
| `ORT_THREADS` | 2 | CPU threads per inference |
| `ML_TOKEN` | – | required header for `/train` when set |

## Retraining

Labels accumulate automatically (`:vision-label/*` in Datomic: one per
photo, `confirmed` when the user kept the top suggestion, `corrected`
otherwise). Training is explicit:

1. **From the app's API** (admins are listed in `ADMIN_USERNAMES`):
   ```bash
   curl -b cookies.txt https://<host>/api/vision/status     # label counts, model mode
   curl -b cookies.txt -X POST https://<host>/api/vision/retrain
   ```
   The response has `valAccuracy` (head, on a held-out 20 %),
   `zeroShotValAccuracy` (zero-shot on the same photos) and `perClass`
   counts. The new head is saved to the volume and used immediately.
2. **From the command line**:
   ```bash
   curl -b cookies.txt https://<host>/api/vision/export > examples.json
   docker compose exec -T ml python -m app.train - < examples.json   # or --dry-run
   ```

Retrain every few hundred new labels, or whenever `acceptanceRate` in the
status drops. To go back to pure zero-shot, delete `head.npz` from the
volume. Changing the prompts in `app/activities.py` only needs a restart;
adding an activity means adding it here **and** in `src/web/vision.clj`
(`activities` and the tag aliases) — the old head is ignored until you retrain.

## Files

| | |
|---|---|
| `app/activities.py` | activity keys + prompts |
| `app/preprocess.py` | image → 224×224 tensor, exactly like HuggingFace's CLIPImageProcessor (verified to 5e-7) |
| `app/classifier.py` | ONNX sessions, zero-shot, blending, training entry point |
| `app/head.py` | softmax, cross-entropy, gradient descent, save/load (`.npz`, no pickle) |
| `app/server.py` | HTTP API (stdlib `http.server`; three endpoints don't need a framework) |
| `app/train.py` | CLI training |
| `scripts/download_model.py` | pinned, checksum-verified model download |

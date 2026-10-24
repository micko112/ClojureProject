"""Command-line training of the head.

    python -m app.train examples.json [--hidden 0] [--epochs 500] [--dry-run]

examples.json is a list of {embedding, activity, embeddingModel?} - exactly
what the backend's GET /api/vision/export returns (admin only), e.g.

    curl -b cookies.txt https://<host>/api/vision/export > examples.json
    docker compose exec -T ml python -m app.train - < examples.json

Writes the head to HEAD_PATH (default ml/data/head.npz; /data/head.npz in the
container). A running service picks the new file up within ~10 seconds.
The easier route is POST /api/vision/retrain from the app, which does the
same thing over HTTP.
"""
import argparse
import json
import sys


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("examples", help="JSON file with [{embedding, activity}], or - for stdin")
    ap.add_argument("--hidden", type=int, default=None, help="hidden units (0 = linear head)")
    ap.add_argument("--epochs", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true", help="report metrics, don't save")
    args = ap.parse_args(argv)

    raw = sys.stdin.read() if args.examples == "-" else open(args.examples).read()
    data = json.loads(raw)
    examples = data.get("examples", []) if isinstance(data, dict) else data

    from .classifier import Classifier
    clf = Classifier()
    if args.dry_run:
        from .head import train_head
        _, metrics = train_head(examples, clf.class_index, clf.zero_shot_W,
                                hidden=clf.config.hidden if args.hidden is None else args.hidden,
                                epochs=clf.config.epochs if args.epochs is None else args.epochs,
                                min_examples=clf.config.min_examples, min_classes=clf.config.min_classes,
                                zero_shot_proba=clf.zero_shot_proba, embedding_model=clf.embedding_model)
    else:
        metrics = clf.train(examples, hidden=args.hidden, epochs=args.epochs)
    print(json.dumps(metrics, indent=2))
    return 0 if metrics.get("trained") else 1


if __name__ == "__main__":
    sys.exit(main())

"""The activity classes the classifier can suggest, and the text prompts that
describe each one to CLIP.

Keys are the lowercase class names shared with the backend
(`web.vision/activities` in src/web/vision.clj must list the same keys). They
cover the activity types in src/database/seed.clj and the keyword recognizer
in backend/src/project/recognizer.clj, plus "other" for photos that are not
any of them.

Why several prompts per class ("prompt ensemble")? CLIP was trained on
captions written by people on the internet, so the same activity is described
in many ways. Averaging the text embeddings of a few phrasings gives a more
robust "centre" for the class than any single sentence; the CLIP paper reports
a few points of accuracy gained this way.
"""

# key -> list of prompts. Order matters only for display ties.
ACTIVITIES = {
    "running": [
        "a photo of a person running",
        "a person jogging outdoors",
        "a runner on a road or track",
        "a photo of a marathon runner",
        "running shoes on a trail run",
    ],
    "gym": [
        "a photo of a person lifting weights in a gym",
        "a person doing a workout at the gym",
        "a photo of dumbbells and barbells",
        "a person doing push-ups or pull-ups",
        "a gym selfie in a mirror",
        "a weightlifter lifting a heavy barbell",
    ],
    "cycling": [
        "a photo of a person riding a bicycle",
        "a cyclist on a road bike",
        "a person mountain biking",
        "a photo of a bicycle ride",
    ],
    "swimming": [
        "a photo of a person swimming",
        "a swimmer in a swimming pool",
        "a person swimming laps",
        "a photo of a person swimming in the sea",
    ],
    "yoga": [
        "a photo of a person doing yoga",
        "a person in a yoga pose on a yoga mat",
        "a yoga class",
    ],
    "stretching": [
        "a photo of a person stretching",
        "a person doing stretching exercises on the floor",
        "a mobility and flexibility workout",
    ],
    "hiking": [
        "a photo of a person hiking in the mountains",
        "a hiker with a backpack on a trail",
        "a mountain summit view on a hike",
        "a photo of trekking in nature",
    ],
    "walking": [
        "a photo of a person walking",
        "a person taking a walk in the park",
        "a walk on a city street",
        "a photo of a person walking a dog",
    ],
    "climbing": [
        "a photo of a person rock climbing",
        "a person bouldering on a climbing wall",
        "an indoor climbing gym",
    ],
    "martial-arts": [
        "a photo of people doing martial arts",
        "a person boxing with boxing gloves",
        "a person training karate or judo",
        "a photo of a punching bag workout",
        "a brazilian jiu-jitsu class",
    ],
    "sports": [
        "a photo of people playing football",
        "a person playing basketball",
        "a person playing tennis",
        "a photo of a team sport match",
    ],
    "cold-shower": [
        "a photo of a person taking a cold shower",
        "a person in an ice bath",
        "a cold plunge in icy water",
        "a person in a shower",
    ],
    "meditation": [
        "a photo of a person meditating",
        "a person sitting cross-legged meditating with closed eyes",
        "a calm meditation session",
    ],
    "reading": [
        "a photo of a person reading a book",
        "an open book",
        "a stack of books",
        "a person reading on an e-reader",
    ],
    "studying": [
        "a photo of a student studying",
        "a desk with notebooks and textbooks for studying",
        "a person taking notes for an exam",
        "handwritten study notes",
    ],
    "coding": [
        "a photo of a person programming on a laptop",
        "a computer screen with source code",
        "a developer writing code",
        "a laptop with a code editor open",
    ],
    "writing": [
        "a photo of a person writing in a notebook",
        "a handwritten journal page",
        "a person writing with a pen",
        "a person typing an essay",
    ],
    "drawing": [
        "a photo of a person drawing",
        "a pencil sketch on paper",
        "a person painting on a canvas",
        "a drawing in a sketchbook",
    ],
    "music": [
        "a photo of a person playing guitar",
        "a person playing the piano",
        "a person playing a musical instrument",
        "a person singing into a microphone",
        "a person playing drums",
    ],
    "cooking": [
        "a photo of a person cooking in a kitchen",
        "food being cooked in a pan",
        "a person baking",
        "chopping vegetables on a cutting board",
    ],
    "nutrition": [
        "a photo of a healthy meal",
        "a plate of salad and vegetables",
        "a meal prep container with healthy food",
        "a healthy breakfast bowl",
        "a person eating a healthy meal",
    ],
    "cleaning": [
        "a photo of a person cleaning the house",
        "a person vacuuming",
        "a tidy clean room",
        "a person washing dishes",
    ],
    "gardening": [
        "a photo of a person gardening",
        "plants growing in a garden",
        "a person planting flowers",
    ],
    "other": [
        "a photo",
        "a random photo",
        "a screenshot of a phone",
        "a photo of a pet",
        "a photo of a building",
        "a picture of a landscape",
        "a meme",
    ],
}

# Display names for logs and the CLI (the backend has its own labels/emoji).
LABELS = {k: k.replace("-", " ").capitalize() for k in ACTIVITIES}

CLASSES = list(ACTIVITIES.keys())

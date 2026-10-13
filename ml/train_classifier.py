"""Train the record-type classifier and export it for the Node.js backend.

Pipeline:  text -> TF-IDF (words and word pairs) -> logistic regression

The trained model is written as plain JSON (vocabulary, IDF weights and
coefficients). The backend loads that file and does the same arithmetic in
JavaScript, so Python is only needed to TRAIN the model, never to run MedSecure.

Run:  python generate_documents.py && python train_classifier.py
"""

import json
import re
from datetime import date
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.svm import LinearSVC

HERE = Path(__file__).parent
MODEL_OUT = HERE.parent / "backend" / "src" / "ml" / "models" / "record-type.json"
PARITY_OUT = HERE.parent / "backend" / "test" / "fixtures" / "record-type-parity.json"
REPORT_OUT = HERE / "reports" / "classifier.json"
CONFIDENCE_THRESHOLD = 0.60  # below this the app makes no suggestion


def clean(text):
    """Lower-case and drop non-ASCII characters. The backend does exactly the same."""
    return re.sub(r"[^\x00-\x7f]", " ", text.lower())


def main():
    rows = [json.loads(line) for line in open(HERE / "data" / "documents.jsonl", encoding="utf-8")]
    seen = [r for r in rows if r["split"] == "seen"]
    unseen = [r for r in rows if r["split"] == "unseen-layout"]
    train, test_seen = train_test_split(seen, test_size=0.2, random_state=7, stratify=[r["label"] for r in seen])

    vectorizer = TfidfVectorizer(preprocessor=clean, token_pattern=r"\b[a-z][a-z]+\b", ngram_range=(1, 2),
                                 sublinear_tf=True, min_df=3, max_features=4000)
    x_train = vectorizer.fit_transform([r["text"] for r in train])
    y_train = [r["label"] for r in train]
    model = LogisticRegression(C=5.0, max_iter=3000)
    model.fit(x_train, y_train)
    classes = list(model.classes_)

    def evaluate(rows_, name):
        x = vectorizer.transform([r["text"] for r in rows_])
        y = [r["label"] for r in rows_]
        proba = model.predict_proba(x)
        pred = [classes[i] for i in proba.argmax(axis=1)]
        confident = proba.max(axis=1) >= CONFIDENCE_THRESHOLD
        result = {
            "documents": len(rows_),
            "accuracy": round(accuracy_score(y, pred), 4),
            "macro_f1": round(f1_score(y, pred, average="macro"), 4),
            "suggestion_rate": round(float(confident.mean()), 4),
            "accuracy_when_suggesting": round(accuracy_score(np.array(y)[confident], np.array(pred)[confident]), 4) if confident.any() else None,
            "confusion_matrix": {"labels": classes, "rows": confusion_matrix(y, pred, labels=classes).tolist()},
            "per_class": {k: {m: round(v, 4) for m, v in d.items()} for k, d in classification_report(y, pred, output_dict=True, zero_division=0).items() if k in classes},
        }
        print(f"{name:<28} n={len(rows_):<5} accuracy={result['accuracy']:.3f}  macro-F1={result['macro_f1']:.3f}  "
              f"suggests on {result['suggestion_rate']:.0%}, right {result['accuracy_when_suggesting']:.1%} of those times")
        return result

    print(f"training documents: {len(train)}, vocabulary: {len(vectorizer.vocabulary_)} terms")
    report = {
        "model": "TF-IDF (1-2 word n-grams, sublinear TF) + multinomial logistic regression",
        "trained_on": str(date.today()),
        "training_documents": len(train),
        "vocabulary_size": len(vectorizer.vocabulary_),
        "confidence_threshold": CONFIDENCE_THRESHOLD,
        "data": "Synthetic documents from generate_documents.py. No real patient data.",
        "test_same_layouts": evaluate(test_seen, "test: layouts seen in training"),
        "test_unseen_layouts": evaluate(unseen, "test: layouts never seen"),
    }

    # Two other common text classifiers on the harder test, for comparison in the report.
    x_unseen = vectorizer.transform([r["text"] for r in unseen])
    y_unseen = [r["label"] for r in unseen]
    report["comparison_on_unseen_layouts"] = {"Logistic regression (used)": report["test_unseen_layouts"]["accuracy"]}
    for label, other in [("Multinomial naive Bayes", MultinomialNB(alpha=0.3)), ("Linear SVM", LinearSVC(C=1.0))]:
        other.fit(x_train, y_train)
        report["comparison_on_unseen_layouts"][label] = round(accuracy_score(y_unseen, other.predict(x_unseen)), 4)
    print("comparison on unseen layouts:", report["comparison_on_unseen_layouts"])

    # Words that push hardest towards each class: a quick look at what the model learned.
    terms = np.array(vectorizer.get_feature_names_out())
    report["strongest_terms"] = {c: terms[np.argsort(model.coef_[i])[-8:][::-1]].tolist() for i, c in enumerate(classes)}

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    json.dump({
        "name": "record-type",
        "description": report["model"],
        "trainedOn": report["trained_on"],
        "classes": classes,
        "threshold": CONFIDENCE_THRESHOLD,
        "ngramRange": [1, 2],
        "sublinearTf": True,
        "vocabulary": {term: int(i) for term, i in vectorizer.vocabulary_.items()},
        "idf": [round(float(v), 5) for v in vectorizer.idf_],
        "coef": [[round(float(v), 5) for v in row] for row in model.coef_],
        "intercept": [round(float(v), 5) for v in model.intercept_],
        "metrics": {"accuracySameLayouts": report["test_same_layouts"]["accuracy"], "accuracyUnseenLayouts": report["test_unseen_layouts"]["accuracy"]},
    }, open(MODEL_OUT, "w"), separators=(",", ":"))

    # A sample of test documents with scikit-learn's own answers. The backend's
    # test suite checks that the JavaScript version gives the same answers.
    sample = (test_seen + unseen)[:: max(1, (len(test_seen) + len(unseen)) // 80)][:80]
    proba = model.predict_proba(vectorizer.transform([r["text"] for r in sample]))
    PARITY_OUT.parent.mkdir(parents=True, exist_ok=True)
    json.dump([{"text": r["text"], "label": classes[int(p.argmax())], "probability": round(float(p.max()), 5)} for r, p in zip(sample, proba)],
              open(PARITY_OUT, "w"))

    REPORT_OUT.parent.mkdir(exist_ok=True)
    json.dump(report, open(REPORT_OUT, "w"), indent=2)
    print(f"model -> {MODEL_OUT.relative_to(HERE.parent)} ({MODEL_OUT.stat().st_size // 1024} KB), report -> {REPORT_OUT.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()

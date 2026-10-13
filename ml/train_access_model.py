"""Train the unusual-access detector and export it for the Node.js backend.

What it looks at
----------------
Only the audit trail that is already on the blockchain: who opened a record,
when, and whether emergency access was used. No medical content is involved.

The trail is cut into one-hour windows per doctor, and each window becomes six
numbers:

    opens            records opened in the hour
    patients         different patients those records belong to
    emergency_uses   times emergency access was used
    night            1 if the hour is between 11 pm and 5 am
    max_burst        most records opened within any 5 minutes
    opens_per_patient

Model
-----
An Isolation Forest is trained on windows of NORMAL behaviour only. It learns
what ordinary hours look like and gives every new window a score from 0 to 1;
the higher the score, the easier the window was to separate from the normal
ones, i.e. the more unusual it is.

Data
----
A real deployment would train on months of real logs. A student project has
no such logs, so normal behaviour and five kinds of misuse are SIMULATED here.
The numbers in the report therefore say how well the detector separates these
simulated patterns, not how it would do in a real hospital.

Run:  python train_access_model.py
"""

import json
from datetime import date
from pathlib import Path

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score, roc_auc_score

HERE = Path(__file__).parent
MODEL_OUT = HERE.parent / "backend" / "src" / "ml" / "models" / "access-anomaly.json"
PARITY_OUT = HERE.parent / "backend" / "test" / "fixtures" / "access-anomaly-parity.json"
REPORT_OUT = HERE / "reports" / "access_anomaly.json"
FEATURES = ["opens", "patients", "emergency_uses", "night", "max_burst", "opens_per_patient"]
FALSE_ALARM_TARGET = 0.005  # at most about 1 normal hour in 200 should be flagged

rng = np.random.default_rng(11)


def is_night(hour):
    return 1 if (hour >= 23 or hour < 5) else 0


def burst(times):
    """Most events within any 300-second span."""
    times = np.sort(times)
    best, start = 0, 0
    for end in range(len(times)):
        while times[end] - times[start] > 300:
            start += 1
        best = max(best, end - start + 1)
    return best


def window(opens_times, patients, emergency_uses, hour):
    opens = len(opens_times)
    return [opens, patients, emergency_uses, is_night(hour), burst(opens_times) if opens else 0, opens / max(1, patients)]


def clustered_times(patients, opens):
    """A doctor looks at a patient's records one after another, then moves on."""
    times = []
    per_patient = np.bincount(rng.integers(0, patients, size=opens), minlength=patients)
    for count in per_patient:
        start = rng.uniform(0, 3400)
        gaps = rng.uniform(25, 150, size=count).cumsum()
        times.extend((start + gaps).tolist())
    return np.array(times)


def normal_window():
    night_shift = rng.random() < 0.15
    emergency_doctor = rng.random() < 0.30
    if night_shift:
        hour = int(rng.choice([20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7]))
        opens = 1 + rng.poisson(1.2)
    else:
        hour = int(rng.choice(np.arange(8, 20))) if rng.random() < 0.97 else int(rng.choice([20, 21, 22, 6, 7]))
        opens = 1 + rng.poisson(2.4)
    emergency = 0
    if emergency_doctor:
        roll = rng.random()
        emergency = 1 if roll < 0.05 else (2 if roll < 0.054 else 0)
    if emergency and rng.random() < 0.3:
        opens = max(1, opens - 1)
    patients = int(min(opens, 1 + rng.binomial(opens - 1, 0.55)))
    return window(clustered_times(patients, opens), patients, emergency, hour)


def misuse_window(kind):
    hour = int(rng.choice(np.arange(8, 20)))
    if kind == "bulk browsing of many patients":
        opens = int(rng.integers(25, 120)); patients = int(rng.integers(15, min(80, opens) + 1))
        return window(rng.uniform(0, 3600, size=opens), patients, 0, hour)
    if kind == "rapid burst of opens":
        opens = int(rng.integers(15, 45)); patients = int(rng.integers(5, opens + 1))
        return window(rng.uniform(600, 880, size=opens), patients, 0, hour)
    if kind == "repeated emergency access":
        uses = int(rng.integers(3, 10)); opens = uses + int(rng.poisson(1))
        return window(rng.uniform(0, 3600, size=opens), uses, uses, hour)
    if kind == "night-time browsing":
        opens = int(rng.integers(8, 30)); patients = int(rng.integers(6, opens + 1))
        return window(rng.uniform(0, 3600, size=opens), patients, 0, int(rng.choice([23, 0, 1, 2, 3, 4])))
    if kind == "one patient opened again and again":
        opens = int(rng.integers(20, 60))
        return window(rng.uniform(0, 3600, size=opens), 1, 0, hour)
    raise ValueError(kind)


MISUSE_KINDS = ["bulk browsing of many patients", "rapid burst of opens", "repeated emergency access",
                "night-time browsing", "one patient opened again and again"]


def main():
    train = np.array([normal_window() for _ in range(20000)], dtype=float)
    validation = np.array([normal_window() for _ in range(10000)], dtype=float)
    test_normal = np.array([normal_window() for _ in range(10000)], dtype=float)
    test_misuse = {kind: np.array([misuse_window(kind) for _ in range(300)], dtype=float) for kind in MISUSE_KINDS}

    model = IsolationForest(n_estimators=150, max_samples=512, random_state=3)
    model.fit(train)
    score = lambda x: -model.score_samples(x)  # 0..1, higher = more unusual

    # Flag anything scoring above what 99.5% of normal hours score.
    threshold = float(np.quantile(score(validation), 1 - FALSE_ALARM_TARGET))

    all_misuse = np.vstack(list(test_misuse.values()))
    y = np.r_[np.zeros(len(test_normal)), np.ones(len(all_misuse))]
    s = np.r_[score(test_normal), score(all_misuse)]
    flagged = s > threshold
    tp, fp = int(flagged[y == 1].sum()), int(flagged[y == 0].sum())
    report = {
        "model": "Isolation Forest (150 trees, 512 samples per tree), trained on normal windows only",
        "trained_on": str(date.today()),
        "features": FEATURES,
        "window": "one clock hour per doctor",
        "data": "Simulated access logs. No real hospital data. See the docstring of train_access_model.py.",
        "training_windows": len(train),
        "threshold": round(threshold, 5),
        "test": {
            "normal_windows": len(test_normal),
            "misuse_windows": len(all_misuse),
            "roc_auc": round(float(roc_auc_score(y, s)), 4),
            "average_precision": round(float(average_precision_score(y, s)), 4),
            "false_alarm_rate": round(fp / len(test_normal), 4),
            "detection_rate": round(tp / len(all_misuse), 4),
            "precision": round(tp / max(1, tp + fp), 4),
            "detection_rate_by_kind": {kind: round(float((score(x) > threshold).mean()), 4) for kind, x in test_misuse.items()},
        },
    }
    t = report["test"]
    print(f"threshold {threshold:.4f} | ROC-AUC {t['roc_auc']} | false alarms {t['false_alarm_rate']:.2%} of normal hours | detected {t['detection_rate']:.1%} of misuse hours")
    for kind, rate in t["detection_rate_by_kind"].items():
        print(f"   {kind:<38} detected {rate:.1%}")

    # Hand-written cases: what should and should not be flagged.
    cases = {
        "ordinary hour: 3 opens, 2 patients": ([3, 2, 0, 0, 2, 1.5], False),
        "busy clinic hour: 8 opens, 5 patients": ([8, 5, 0, 0, 3, 1.6], False),
        "one genuine emergency use": ([2, 2, 1, 0, 1, 1.0], False),
        "night-shift doctor, 2 opens": ([2, 1, 0, 1, 2, 2.0], False),
        "40 opens of 30 patients in an hour": ([40, 30, 0, 0, 6, 1.33], True),
        "25 opens inside five minutes": ([25, 10, 0, 0, 25, 2.5], True),
        "5 emergency uses in an hour": ([6, 5, 5, 0, 2, 1.2], True),
        "18 opens of 15 patients at 2 am": ([18, 15, 0, 1, 4, 1.2], True),
        "30 opens of the same patient": ([30, 1, 0, 0, 5, 30.0], True),
    }
    report["sanity_cases"] = {}
    for label, (vector, expected) in cases.items():
        got = bool(score(np.array([vector], dtype=float))[0] > threshold)
        report["sanity_cases"][label] = {"flagged": got, "expected": expected}
        print(f"   {'ok ' if got == expected else 'MISMATCH'} {label:<40} score {score(np.array([vector], dtype=float))[0]:.3f} flagged={got}")

    trees = []
    for est in model.estimators_:
        tree = est.tree_
        trees.append({
            "feature": tree.feature.tolist(),
            "threshold": [round(float(v), 6) for v in tree.threshold],
            "left": tree.children_left.tolist(),
            "right": tree.children_right.tolist(),
            "samples": tree.n_node_samples.tolist(),
        })
    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    json.dump({
        "name": "access-anomaly",
        "description": report["model"],
        "trainedOn": report["trained_on"],
        "features": FEATURES,
        "windowSeconds": 3600,
        "burstSeconds": 300,
        "nightHours": [23, 5],
        "maxSamples": int(model.max_samples_),
        "threshold": round(threshold, 6),
        # What normal looks like, used to explain a flag in plain words.
        "typical": {name: {"median": float(np.median(train[:, i])), "p99": float(np.quantile(train[:, i], 0.99))} for i, name in enumerate(FEATURES)},
        "metrics": {"rocAuc": t["roc_auc"], "falseAlarmRate": t["false_alarm_rate"], "detectionRate": t["detection_rate"]},
        "trees": trees,
    }, open(MODEL_OUT, "w"), separators=(",", ":"))

    sample = np.vstack([test_normal[:40], all_misuse[::30][:40]])
    PARITY_OUT.parent.mkdir(parents=True, exist_ok=True)
    json.dump([{"features": row.tolist(), "score": round(float(sc), 6)} for row, sc in zip(sample, score(sample))], open(PARITY_OUT, "w"))

    REPORT_OUT.parent.mkdir(exist_ok=True)
    json.dump(report, open(REPORT_OUT, "w"), indent=2)
    print(f"model -> {MODEL_OUT.relative_to(HERE.parent)} ({MODEL_OUT.stat().st_size // 1024} KB), report -> {REPORT_OUT.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()

import fs from "node:fs";

// Unusual-access detector: an Isolation Forest over one-hour windows of the
// audit trail.
//
// Trained in Python (see /ml/train_access_model.py) and exported as JSON.
// This file walks the same trees in JavaScript. Its only input is counts and
// times taken from blockchain events; it never sees any medical content.

const model = JSON.parse(fs.readFileSync(new URL("./models/access-anomaly.json", import.meta.url), "utf8"));
const EULER = 0.5772156649015329;

/** Average path length of an unsuccessful search in a binary tree of n points. */
function averagePathLength(n) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n;
}

const normaliser = averagePathLength(model.maxSamples);

/** Score a feature vector: 0..1, higher means more unusual. */
export function anomalyScore(features) {
  let total = 0;
  for (const tree of model.trees) {
    let node = 0;
    let depth = 0;
    while (tree.left[node] !== -1) {
      node = features[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
      depth += 1;
    }
    total += depth + averagePathLength(tree.samples[node]);
  }
  return 2 ** (-(total / model.trees.length) / normaliser);
}

function isNight(hour) {
  const [from, to] = model.nightHours;
  return hour >= from || hour < to ? 1 : 0;
}

/** Most events within any `burstSeconds` span. */
function maxBurst(times) {
  const sorted = [...times].sort((a, b) => a - b);
  let best = 0;
  let start = 0;
  for (let end = 0; end < sorted.length; end++) {
    while (sorted[end] - sorted[start] > model.burstSeconds) start += 1;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

/** Start of the local clock hour that contains a unix time. */
function hourStart(time) {
  const date = new Date(time * 1000);
  date.setMinutes(0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/** Say in plain words what is unusual about a window, using what normal hours look like. */
function explain(f) {
  const typical = model.typical;
  const reasons = [];
  if (f.opens > typical.opens.p99) {
    reasons.push(`Opened ${f.opens} records in one hour. A normal hour has up to ${typical.opens.p99}.`);
  }
  if (f.patients > typical.patients.p99) {
    reasons.push(`Opened records of ${f.patients} different patients. A normal hour has up to ${typical.patients.p99}.`);
  }
  if (f.emergency_uses > typical.emergency_uses.p99) {
    reasons.push(`Used emergency access ${f.emergency_uses} times in one hour.`);
  }
  if (f.max_burst > typical.max_burst.p99) {
    reasons.push(`Opened ${f.max_burst} records within 5 minutes.`);
  }
  if (f.opens_per_patient > typical.opens_per_patient.p99) {
    reasons.push(`Opened the same patient's records again and again (${Math.round(f.opens_per_patient)} opens per patient).`);
  }
  if (f.night && f.opens > typical.opens.median) {
    reasons.push("The activity was between 11 pm and 5 am.");
  }
  if (reasons.length === 0) reasons.push("An unusual combination of activity for a single hour.");
  return reasons;
}

/**
 * Cut a list of audit events into one-hour windows per doctor and score each.
 * `events` is [{ doctor, patient, time, kind: "open" | "emergency", recordId? }].
 * Returns every window, most unusual first, each with `flagged`.
 */
export function scoreAccessEvents(events) {
  const windows = new Map();
  for (const event of events) {
    const start = hourStart(event.time);
    const key = `${event.doctor.toLowerCase()}|${start}`;
    if (!windows.has(key)) windows.set(key, { doctor: event.doctor, start, events: [] });
    windows.get(key).events.push(event);
  }

  const result = [];
  for (const window of windows.values()) {
    const opens = window.events.filter((e) => e.kind === "open");
    const patients = new Set(window.events.map((e) => e.patient.toLowerCase()));
    const features = {
      opens: opens.length,
      patients: patients.size,
      emergency_uses: window.events.filter((e) => e.kind === "emergency").length,
      night: isNight(new Date(window.start * 1000).getHours()),
      max_burst: maxBurst(opens.map((e) => e.time)),
      opens_per_patient: opens.length / Math.max(1, patients.size),
    };
    const score = anomalyScore(model.features.map((name) => features[name]));
    const flagged = score > model.threshold;
    result.push({
      doctor: window.doctor,
      start: window.start,
      end: window.start + model.windowSeconds,
      features,
      score,
      flagged,
      reasons: flagged ? explain(features) : [],
      patients: [...patients],
      events: window.events,
    });
  }
  return result.sort((a, b) => b.score - a.score);
}

export const accessModelInfo = {
  name: "Unusual access detection",
  method: model.description,
  trainedOn: model.trainedOn,
  threshold: model.threshold,
  metrics: model.metrics,
  data: "Simulated access logs. No real hospital data was used.",
};

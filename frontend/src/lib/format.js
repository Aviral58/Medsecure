const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Format a unix time (seconds) or a date string. */
export function formatDateTime(value) {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return dateTime.format(date);
}

export function formatDate(value) {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return dateOnly.format(date);
}

/** "3 days 4 h", "5 h 12 min", "2 min 10 s" */
export function timeLeft(expiry, now) {
  let seconds = Math.max(0, expiry - now);
  const days = Math.floor(seconds / 86400);
  seconds -= days * 86400;
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  if (days > 0) return `${days} ${days === 1 ? "day" : "days"} ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

/** Shorten a long hash, address or CID for display. */
export function shorten(value, head = 8, tail = 6) {
  if (!value) return "";
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export const RECORD_TYPES = [
  "Lab report",
  "Prescription",
  "Scan or imaging",
  "Discharge summary",
  "Vaccination record",
  "Critical summary",
  "Other",
];

export const SHARE_DURATIONS = [
  { label: "2 minutes", minutes: 2 },
  { label: "1 hour", minutes: 60 },
  { label: "24 hours", minutes: 24 * 60 },
  { label: "7 days", minutes: 7 * 24 * 60 },
  { label: "30 days", minutes: 30 * 24 * 60 },
];

// How many times a doctor may open a shared record. null means no limit.
export const VIEW_LIMITS = [
  { label: "1 time", value: 1 },
  { label: "3 times", value: 3 },
  { label: "10 times", value: 10 },
  { label: "Any number of times", value: null },
];

/** "2 opens left", "1 open left", or "" when there is no limit. */
export function opensLeft(viewsLeft) {
  if (viewsLeft === null || viewsLeft === undefined) return "";
  return `${viewsLeft} ${viewsLeft === 1 ? "open" : "opens"} left`;
}

export const ROLE_LABELS = {
  owner: "Network owner",
  hospitalAdmin: "Hospital admin",
  doctor: "Doctor",
  patient: "Patient",
};

/** "just now", "5 min ago", "3 h ago", "yesterday", otherwise the date. `time` and `now` are unix seconds. */
export function timeAgo(time, now) {
  const seconds = Math.max(0, now - time);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 2 * 86400) return "yesterday";
  return formatDate(time);
}

/** "Today", "Yesterday" or the date, for grouping a list by day. */
export function dayLabel(time) {
  const date = new Date(time * 1000);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(date);
}

const timeOnly = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
export const formatTime = (time) => timeOnly.format(new Date(time * 1000));

/** "2026-09-12" -> "12 Sep 2026" */
export function formatIsoDate(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  if (!year || !month || !day) return String(iso);
  return dateOnly.format(new Date(year, month - 1, day));
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "1 record", "3 records" */
export function count(number, word, plural = `${word}s`) {
  return `${number} ${number === 1 ? word : plural}`;
}

/** "DR" for "Dr Deepa Rao", "MN" for "Meera Nair". */
export function initials(name) {
  const parts = String(name || "").replace(/^dr\.?\s+/i, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

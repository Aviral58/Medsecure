// The small line icons used across MedSecure. Each one is drawn on a 24 x 24
// grid with the same stroke, so they sit well next to text.
//   <Icon name="lock" />

const PATHS = {
  home: <path d="M4 11.5 12 4l8 7.5M6.5 10v9.5h4v-5h3v5h4V10" />,
  records: (
    <>
      <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z" />
      <path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6" />
    </>
  ),
  share: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c.4-3.3 2.6-5.2 5.5-5.2 1.3 0 2.5.4 3.4 1.1M17.5 13v7M14 16.5h7" />
    </>
  ),
  access: (
    <>
      <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" />
      <path d="M7 8.5v7M16.5 12h.01M19 12h.01" />
    </>
  ),
  trends: <path d="M4 4v16h16M7.5 15l3.5-4 3 2.5 5-6.5" />,
  activity: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.3 2" />
    </>
  ),
  hospital: <path d="M5 20.5V6.5l7-3 7 3v14M3 20.5h18M12 8v5M9.5 10.5h5M10 20.5v-4h4v4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  upload: <path d="M12 16V4.5M7.5 9 12 4.5 16.5 9M4.5 15.5v4h15v-4" />,
  download: <path d="M12 4.5V16M7.5 11.5 12 16l4.5-4.5M4.5 19.5h15" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" />
    </>
  ),
  shield: <path d="M12 3.5 5 6v5.5c0 4.3 2.8 7.6 7 9 4.2-1.4 7-4.7 7-9V6zM9 12l2.2 2.2L15.2 10" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  alert: (
    <>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17h.01" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: <path d="M4 4l16 16M9.9 6c.7-.3 1.4-.5 2.1-.5 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M14.5 14.6A3 3 0 0 1 9.4 9.5M6.3 7.8A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.3 3.5-.8" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </>
  ),
  moon: <path d="M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1" />
    </>
  ),
  chevron: <path d="m9 5.5 6.5 6.5L9 18.5" />,
  doctor: (
    <>
      <path d="M6.5 3.5v5a4 4 0 0 0 8 0v-5M10.5 12.5v2.5a4.5 4.5 0 0 0 9 0v-1.5" />
      <circle cx="19.5" cy="11.5" r="2" />
    </>
  ),
  emergency: <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />,
  chain: (
    <>
      <path d="m12 3 7.5 4.3v9.4L12 21l-7.5-4.3V7.3z" />
      <path d="M4.5 7.3 12 11.6l7.5-4.3M12 11.6V21" />
    </>
  ),
  spark: <path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14l-6.7-2 6.7-2z" />,
  logout: <path d="M14 4.5h5v15h-5M10 8l-4 4 4 4M6 12h10" />,
  file: (
    <>
      <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z" />
      <path d="M14 3.5v4h4" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" />
      <circle cx="12" cy="13.2" r="3.3" />
    </>
  ),
  pill: (
    <>
      <rect x="2.9" y="8.5" width="18.2" height="7" rx="3.5" transform="rotate(-40 12 12)" />
      <path d="m9.7 9.3 4.6 5.4" />
    </>
  ),
  flask: <path d="M9.5 3.5h5M10.5 3.5v6L5 19a1 1 0 0 0 .9 1.5h12.2A1 1 0 0 0 19 19l-5.5-9.5v-6M8 15h8" />,
  scan: (
    <>
      <path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3" />
      <path d="M8 12h8M12 8.5v7" />
    </>
  ),
  syringe: <path d="m14.5 4 5.5 5.5M17.2 6.8 8 16l-3 .5.5-3 9.2-9.2M4 20l1.5-1.5M11 9.5l1.5 1.5M8.5 12l1.5 1.5" />,
  bed: (
    <>
      <path d="M3 18.5v-12M3 15.5h18v3M21 15.5v-3a2.5 2.5 0 0 0-2.5-2.5H10v5.5" />
      <circle cx="6.5" cy="11.5" r="1.6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.5-3.3 2.8-5.2 6-5.2s5.5 1.9 6 5.2M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.6c2 .7 3.2 2.4 3.5 4.9" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  send: <path d="M4 12 20 4.5l-5 15.5-3-6.5zM12 13.5 20 4.5" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4M19.5 4.5v4h-4" />,
  settings: (
    <>
      <path d="M5 7h9M18 7h1M5 12h1M10 12h9M5 17h7M16 17h3" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="14" cy="17" r="2" />
    </>
  ),
};

export default function Icon({ name, size = 20, className = "" }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] || null}
    </svg>
  );
}

/** The icon that stands for a kind of record. */
export function recordIcon(recordType) {
  const type = String(recordType || "").toLowerCase();
  if (type.includes("lab")) return "flask";
  if (type.includes("prescription")) return "pill";
  if (type.includes("scan") || type.includes("imaging")) return "scan";
  if (type.includes("discharge")) return "bed";
  if (type.includes("vaccin")) return "syringe";
  if (type.includes("critical") || type.includes("emergency")) return "emergency";
  return "file";
}

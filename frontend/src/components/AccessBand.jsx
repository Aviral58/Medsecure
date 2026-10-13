import { timeLeft } from "../lib/format.js";

/**
 * The wristband: one live permission, with the time it has left.
 * Like a hospital wristband it names one person and is cut off when the stay
 * ends. The strip along the bottom drains from full (just granted) to empty.
 */
export default function AccessBand({ title, subtitle, grantedAt, expiry, now, emergency = false, children, as: Element = "li" }) {
  const total = grantedAt ? Math.max(1, expiry - grantedAt) : null;
  const remaining = Math.max(0, expiry - now);
  const fraction = total ? Math.min(1, remaining / total) : 1;
  const endingSoon = remaining <= 300;

  const classes = ["band"];
  if (emergency) classes.push("band-emergency");
  else if (endingSoon) classes.push("band-ending");

  return (
    <Element className={classes.join(" ")}>
      <div className="band-body">
        <div className="band-text">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <div className="band-time">
          <span className="band-time-value">{timeLeft(expiry, now)}</span>
          <span className="band-time-label">{emergency ? "of emergency access left" : endingSoon ? "left, ending soon" : "left"}</span>
        </div>
        {children && <div className="band-actions">{children}</div>}
      </div>
      <div className="band-meter" aria-hidden="true">
        <div className="band-meter-fill" style={{ width: `${fraction * 100}%` }} />
      </div>
    </Element>
  );
}

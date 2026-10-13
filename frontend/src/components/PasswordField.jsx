import { useId, useState } from "react";
import Icon from "./Icon.jsx";

/** What a new password still needs, and a rough idea of how strong it is. */
function judge(password) {
  const longEnough = password.length >= 10;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const extras = [password.length >= 14, /[^A-Za-z0-9]/.test(password), /[a-z]/.test(password) && /[A-Z]/.test(password)].filter(Boolean).length;
  const meetsRules = longEnough && hasLetter && hasNumber;
  const level = !meetsRules ? 1 : extras === 0 ? 2 : extras === 1 ? 3 : 4;
  return { longEnough, hasLetter, hasNumber, level, label: ["", "Not enough yet", "Acceptable", "Good", "Strong"][level] };
}

/**
 * A password box with a show/hide button.
 * With `strength`, it also shows the rules for a new password as they are met.
 */
export default function PasswordField({ label = "Password", value, onChange, autoComplete = "current-password", strength = false, hint, required = true, minLength }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const verdict = strength ? judge(value) : null;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-box">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          aria-describedby={hint || strength ? `${id}-hint` : undefined}
        />
        <button type="button" className="icon-button" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>
          <Icon name={visible ? "eyeOff" : "eye"} />
        </button>
      </div>
      {strength && (
        <div id={`${id}-hint`} className="strength">
          {value.length > 0 && (
            <div className={`strength-meter strength-${verdict.level}`} role="img" aria-label={`Password strength: ${verdict.label}`}>
              <span />
              <span />
              <span />
              <span />
              <em>{verdict.label}</em>
            </div>
          )}
          <ul className="strength-rules">
            <li className={verdict.longEnough ? "met" : ""}>
              <Icon name="check" size={14} /> 10 characters or more
            </li>
            <li className={verdict.hasLetter ? "met" : ""}>
              <Icon name="check" size={14} /> a letter
            </li>
            <li className={verdict.hasNumber ? "met" : ""}>
              <Icon name="check" size={14} /> a number
            </li>
          </ul>
        </div>
      )}
      {hint && <small id={strength ? undefined : `${id}-hint`}>{hint}</small>}
    </div>
  );
}

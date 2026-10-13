import { Brand, ThemeToggle } from "./Layout.jsx";

// Shared frame for the login and sign-up pages: what MedSecure does on the
// left, and the form on the right.
export default function AuthFrame({ children }) {
  return (
    <div className="auth">
      <section className="auth-story">
        <Brand />
        <h1>Your medical records, opened only with your permission.</h1>
        <p className="auth-lede">
          Every hospital you visit adds to one file. Nobody can read it until you say so, and you decide for how long.
        </p>

        <ol className="auth-steps">
          <li>
            <strong>Encrypted before it is stored.</strong> Each record is locked with its own key the moment it is added.
          </li>
          <li>
            <strong>Kept on IPFS, fingerprinted on the blockchain.</strong> Any change to a stored file is detected when it is opened.
          </li>
          <li>
            <strong>Shared for a set time.</strong> A doctor's access ends by itself, or the moment you revoke it.
          </li>
          <li>
            <strong>Explained by AI that stays on this computer.</strong> Summaries and answers are made from the record itself, and nothing is sent
            anywhere.
          </li>
        </ol>
      </section>
      <section className="auth-form">
        <div className="auth-form-inner">{children}</div>
        <div className="auth-theme">
          <ThemeToggle />
        </div>
      </section>
    </div>
  );
}

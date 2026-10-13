import { useState } from "react";
import { Link } from "react-router-dom";
import AuthFrame from "../components/AuthFrame.jsx";
import PasswordField from "../components/PasswordField.jsx";
import { useAuth } from "../lib/auth.jsx";

export default function Login() {
  const { login, notice } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
    } catch (problem) {
      setError(problem.message);
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <h2>Log in</h2>
      {notice && !error && <p className="notice notice-waiting">{notice}</p>}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={onSubmit} className="form">
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
        </label>
        <PasswordField value={password} onChange={setPassword} />
        <button type="submit" className="button button-primary button-wide" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="auth-switch">
        New to MedSecure? <Link to="/signup">Create an account</Link>
      </p>
    </AuthFrame>
  );
}

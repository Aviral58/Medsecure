import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, clearToken, getToken, setToken } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  // On page load, restore the session if a token is saved.
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (getToken()) {
        try {
          const data = await api("/auth/me");
          if (!cancelled) setUser(data.user);
        } catch {
          clearToken();
        }
      }
      if (!cancelled) setLoading(false);
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // The API layer fires this when the server says the session is over.
  useEffect(() => {
    function onSessionEnded() {
      clearToken();
      setUser(null);
      setNotice("Your session has ended. Log in again.");
    }
    window.addEventListener("medsecure:session-ended", onSessionEnded);
    return () => window.removeEventListener("medsecure:session-ended", onSessionEnded);
  }, []);

  // Automatic logout after a period with no mouse, keyboard or touch input.
  // The server enforces the same limit on its side; this makes the screen
  // lock visibly instead of failing on the next click.
  const lastActivity = useRef(Date.now());
  const lastPing = useRef(Date.now());
  const idleMinutes = user?.sessionIdleMinutes || 15;
  const loggedIn = Boolean(user);

  useEffect(() => {
    if (!loggedIn) return;
    lastActivity.current = Date.now();
    lastPing.current = Date.now();
    const markActive = () => {
      lastActivity.current = Date.now();
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((name) => window.addEventListener(name, markActive, { passive: true }));

    const timer = setInterval(() => {
      const now = Date.now();
      const idleFor = now - lastActivity.current;
      if (idleFor > idleMinutes * 60_000) {
        api("/auth/logout", { method: "POST" }).catch(() => {});
        clearToken();
        setUser(null);
        setNotice(
          `You were logged out after ${idleMinutes} ${idleMinutes === 1 ? "minute" : "minutes"} without activity. Log in again.`,
        );
      } else if (idleFor < 60_000 && now - lastPing.current > (idleMinutes * 60_000) / 3) {
        // Still here (reading, typing): tell the server so it keeps the session.
        lastPing.current = now;
        api("/auth/me").catch(() => {});
      }
    }, 2000);

    return () => {
      clearInterval(timer);
      events.forEach((name) => window.removeEventListener(name, markActive));
    };
  }, [loggedIn, idleMinutes]);

  const login = useCallback(async (email, password) => {
    const data = await api("/auth/login", { method: "POST", body: { email, password } });
    setToken(data.token);
    setNotice("");
    setUser(data.user);
  }, []);

  const signup = useCallback(async (details) => {
    const data = await api("/auth/signup", { method: "POST", body: details });
    setToken(data.token);
    setNotice("");
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Logging out locally is enough if the server cannot be reached.
    }
    clearToken();
    setUser(null);
  }, []);

  // `options` can be { background: true } for a refresh the page does by itself.
  const refreshUser = useCallback(async (options) => {
    const data = await api("/auth/me", options);
    setUser(data.user);
    return data.user;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, notice, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

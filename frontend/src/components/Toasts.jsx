import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";

// Short messages that appear at the corner of the screen after an action:
//   const toast = useToast();
//   toast.success("Record added");   toast.error(error);
// A success goes away by itself. A problem stays until it is closed.

const ToastContext = createContext(null);
const SUCCESS_MS = 6000;
const ERROR_MS = 14000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);

  const show = useCallback(
    (kind, text) => {
      const id = nextId.current++;
      // The same message twice in a row is shown once.
      setToasts((list) => [...list.filter((toast) => toast.text !== text).slice(-3), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === "error" ? ERROR_MS : SUCCESS_MS);
    },
    [dismiss],
  );

  const toast = useMemo(
    () => ({
      success: (text) => show("success", text),
      error: (problem) => show("error", problem?.message || String(problem)),
      clear: () => setToasts([]),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.kind}`} role={item.kind === "error" ? "alert" : "status"}>
            <Icon name={item.kind === "error" ? "alert" : "check"} />
            <p>{item.text}</p>
            <button type="button" className="icon-button" onClick={() => dismiss(item.id)} aria-label="Close this message">
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

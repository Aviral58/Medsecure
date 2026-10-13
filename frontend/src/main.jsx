import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource/atkinson-hyperlegible-mono/400.css";
import "./styles.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { ToastProvider } from "./components/Toasts.jsx";
import { AuthProvider } from "./lib/auth.jsx";
import { applyTheme, currentTheme } from "./lib/theme.js";

applyTheme(currentTheme());

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

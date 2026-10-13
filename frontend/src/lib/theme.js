// Light or dark colours. The choice is remembered in this browser only.
const KEY = "medsecure.theme";

function saved() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The theme in use: the saved choice, or else what the computer is set to. */
export function currentTheme() {
  const choice = saved();
  if (choice === "light" || choice === "dark") return choice;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme) {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private windows may refuse storage; the theme still applies until reload.
  }
}

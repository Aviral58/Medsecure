// All communication with the backend goes through this file.

const TOKEN_KEY = "medsecure.token";

// The login token lives in sessionStorage, so it is gone as soon as the tab
// or the browser is closed. Nobody who opens the browser later is logged in.
export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (token) => sessionStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = "GET", body, form, background = false } = {}) {
  const headers = {};
  // A refresh the page does by itself. The server does not count it as the
  // person being active, so it cannot keep an unattended session alive.
  if (background) headers["X-Background"] = "1";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`/api${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  } catch {
    throw new ApiError("Cannot reach the MedSecure server. Check that `npm start` is still running.", 0);
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && (data.code === "SESSION_EXPIRED" || data.code === "NOT_LOGGED_IN")) {
      window.dispatchEvent(new CustomEvent("medsecure:session-ended"));
    }
    const fallback =
      response.status >= 500
        ? "The MedSecure server is not responding. Check that `npm start` is still running."
        : `Request failed (${response.status}).`;
    throw new ApiError(data.error || fallback, response.status, data.code);
  }
  return response;
}

/** Call a JSON endpoint. */
export async function api(path, options) {
  const response = await request(path, options);
  return response.json();
}

/** Download a decrypted record. Returns the file and whether its integrity was verified. */
export async function fetchRecordFile(path) {
  const response = await request(path);
  const blob = await response.blob();

  // The reply carries a one-time ticket for the record's AI summary.
  // `undefined` means the summary could not be fetched; `null` means the
  // record has none (for example a photo).
  // `ask` is a short-lived session for asking questions about this record.
  let summary;
  let ask = null;
  const ticket = response.headers.get("X-Summary-Ticket");
  if (ticket) {
    try {
      const opened = await api(`/ai/summary/${ticket}`);
      summary = opened.summary;
      ask = opened.ask;
    } catch {
      summary = undefined;
    }
  }

  return {
    blob,
    summary,
    ask,
    mimeType: (response.headers.get("Content-Type") || "").split(";")[0].trim(),
    filename: decodeURIComponent(response.headers.get("X-File-Name") || "record"),
    verified: response.headers.get("X-Integrity") === "verified",
  };
}

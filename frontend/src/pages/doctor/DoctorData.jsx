import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import RecordViewer from "../../components/RecordViewer.jsx";
import { useToast } from "../../components/Toasts.jsx";
import useNow from "../../components/useNow.js";
import { api, fetchRecordFile } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";

// What the doctor's pages share: the records open to them right now, and the
// viewer that shows one.

const DoctorContext = createContext(null);
export const useDoctor = () => useContext(DoctorContext);

export function DoctorProvider({ children }) {
  const { refreshUser } = useAuth();
  const toast = useToast();
  const now = useNow();
  const [shared, setShared] = useState(null); // { shared, emergency }
  const [viewer, setViewer] = useState(null);
  const [opening, setOpening] = useState(null); // "patientId-recordId" being decrypted

  const loadShared = useCallback(() => api("/doctor/shared").then(setShared), []);

  // Run at the start and each time the doctor moves to another page. It picks
  // up a verification or emergency role given since the last look, and any
  // record a patient has just shared.
  const { pathname } = useLocation();
  useEffect(() => {
    refreshUser().catch(() => {});
    loadShared().catch(toast.error);
  }, [refreshUser, loadShared, toast, pathname]);

  // New shares arrive while the doctor is working, so look again every half minute.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      api("/doctor/shared", { background: true })
        .then(setShared)
        .catch(() => {});
      refreshUser({ background: true }).catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, [refreshUser]);

  const openRecord = useCallback(
    async (item) => {
      const key = `${item.patientId}-${item.recordId}`;
      setOpening(key);
      try {
        const file = await fetchRecordFile(`/doctor/records/${item.patientId}/${item.recordId}/file`);
        setViewer({ file, title: `${item.patientName}: ${item.recordType}` });
      } catch (problem) {
        toast.error(problem);
      } finally {
        setOpening(null);
        // Opening uses up one of the allowed opens, so refresh the list.
        loadShared().catch(() => {});
      }
    },
    [loadShared, toast],
  );

  const liveShared = useMemo(() => (shared?.shared || []).filter((item) => item.expiry > now), [shared, now]);
  const liveEmergency = useMemo(() => (shared?.emergency || []).filter((item) => item.expiry > now), [shared, now]);

  return (
    <DoctorContext.Provider value={{ now, shared, liveShared, liveEmergency, opening, openRecord, loadShared }}>
      {children}
      {viewer && <RecordViewer file={viewer.file} title={viewer.title} audience="doctor" onClose={() => setViewer(null)} />}
    </DoctorContext.Provider>
  );
}

/** The button that opens one shared record. */
export function OpenButton({ item }) {
  const { opening, openRecord } = useDoctor();
  const key = `${item.patientId}-${item.recordId}`;
  return (
    <button type="button" className="button button-primary" disabled={opening === key} onClick={() => openRecord(item)}>
      {opening === key ? "Decrypting…" : "Open record"}
    </button>
  );
}

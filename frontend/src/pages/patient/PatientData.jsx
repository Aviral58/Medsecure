import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { ConfirmDialog } from "../../components/Dialog.jsx";
import RecordViewer from "../../components/RecordViewer.jsx";
import ShareDialog from "../../components/ShareDialog.jsx";
import { useToast } from "../../components/Toasts.jsx";
import useNow from "../../components/useNow.js";
import { api, fetchRecordFile } from "../../lib/api.js";
import { count } from "../../lib/format.js";

// Everything the patient's pages share: their records, who has access, the
// activity log, and the actions (open, share, revoke) with their dialogs.
// It is loaded once and kept while the patient moves between pages.

const PatientContext = createContext(null);
export const usePatient = () => useContext(PatientContext);

export function PatientProvider({ children }) {
  const toast = useToast();
  const now = useNow();
  const [records, setRecords] = useState(null);
  const [hospitals, setHospitals] = useState([]); // hospitals that have added to this file
  const [doctors, setDoctors] = useState([]);
  const [access, setAccess] = useState(null); // { grants, emergencyWindows }
  const [activity, setActivity] = useState(null);
  const [security, setSecurity] = useState(null); // { alerts, model } from the unusual-access model
  const [viewer, setViewer] = useState(null); // { file, title }
  const [opening, setOpening] = useState(null); // id of the record being decrypted
  const [sharing, setSharing] = useState(null); // null, or { recordIds, onShared } ([] lets the patient tick them)
  const [revoking, setRevoking] = useState(null); // { grants, doctorName }
  const [busy, setBusy] = useState(false);

  const loadRecords = useCallback(
    () =>
      api("/patient/records").then((data) => {
        setRecords(data.records);
        setHospitals(data.hospitals || []);
      }),
    [],
  );
  const loadAccess = useCallback(() => api("/patient/grants").then(setAccess), []);
  const loadDoctors = useCallback(() => api("/patient/doctors").then((data) => setDoctors(data.doctors)), []);
  const loadActivity = useCallback(() => api("/patient/activity").then((data) => setActivity(data.activity)), []);
  const loadSecurity = useCallback(() => api("/patient/alerts").then(setSecurity), []);

  const reload = useCallback(
    () => Promise.all([loadRecords(), loadAccess(), loadDoctors(), loadActivity(), loadSecurity()]).catch(toast.error),
    [loadRecords, loadAccess, loadDoctors, loadActivity, loadSecurity, toast],
  );

  // Read everything at the start, and again each time the patient moves to
  // another page, so a record a doctor has just added is there without
  // refreshing the browser.
  const { pathname } = useLocation();
  useEffect(() => {
    reload();
  }, [reload, pathname]);

  // A doctor may add or open a record, or use emergency access, while the
  // patient is looking at this screen, so the records, the access list and
  // the log are read again every half minute.
  useEffect(() => {
    const quiet = { background: true };
    const timer = setInterval(() => {
      if (document.hidden) return;
      Promise.all([
        api("/patient/records", quiet).then((data) => {
          setRecords(data.records);
          setHospitals(data.hospitals || []);
        }),
        api("/patient/grants", quiet).then(setAccess),
        api("/patient/activity", quiet).then((data) => setActivity(data.activity)),
        api("/patient/alerts", quiet).then(setSecurity),
      ]).catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const openRecord = useCallback(
    async (record) => {
      setOpening(record.id);
      try {
        const file = await fetchRecordFile(`/patient/records/${record.id}/file`);
        setViewer({ file, title: record.recordType });
      } catch (problem) {
        toast.error(problem);
      } finally {
        setOpening(null);
      }
    },
    [toast],
  );

  const setEmergency = useCallback(
    async (record) => {
      try {
        await api(`/patient/records/${record.id}/emergency`, { method: "POST" });
        await Promise.all([loadRecords(), loadActivity()]);
        toast.success(`${record.recordType} is now your emergency summary.`);
      } catch (problem) {
        toast.error(problem);
      }
    },
    [loadRecords, loadActivity, toast],
  );

  async function confirmRevoke() {
    setBusy(true);
    try {
      for (const grant of revoking.grants) {
        await api("/patient/grants/revoke", { method: "POST", body: { doctorId: grant.doctorId, recordId: grant.recordId } });
      }
      await Promise.all([loadAccess(), loadActivity()]);
      toast.success(`Access revoked for ${revoking.doctorName}.`);
      setRevoking(null);
    } catch (problem) {
      toast.error(problem);
      loadAccess().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  const liveGrants = useMemo(() => (access?.grants || []).filter((grant) => grant.expiry > now), [access, now]);
  const liveEmergency = useMemo(() => (access?.emergencyWindows || []).filter((window) => window.expiry > now), [access, now]);

  const value = {
    now,
    records,
    hospitals,
    doctors,
    access,
    activity,
    security,
    liveGrants,
    liveEmergency,
    opening,
    reload,
    loadRecords,
    loadAccess,
    loadActivity,
    loadSecurity,
    openRecord,
    setEmergency,
    /** Open the share dialog. Pass record ids, or nothing to let the patient tick them there. */
    share: (recordIds = [], onShared) => setSharing({ recordIds, onShared }),
    /** Ask for confirmation, then revoke one grant or several from the same doctor. */
    revoke: (grants) => setRevoking({ grants, doctorName: grants[0].doctorName }),
  };

  return (
    <PatientContext.Provider value={value}>
      {children}

      {sharing && records && (
        <ShareDialog
          records={records}
          recordIds={sharing.recordIds}
          doctors={doctors}
          onClose={() => setSharing(null)}
          onShared={() => {
            if (sharing.onShared) sharing.onShared();
            setSharing(null);
            Promise.all([loadAccess(), loadActivity()]).catch(toast.error);
          }}
        />
      )}

      {revoking && (
        <ConfirmDialog
          title={`Revoke access for ${revoking.doctorName}?`}
          confirmLabel="Revoke access"
          busyLabel="Revoking…"
          busy={busy}
          danger
          onConfirm={confirmRevoke}
          onCancel={() => setRevoking(null)}
        >
          <p>
            {revoking.doctorName} will no longer be able to open{" "}
            {revoking.grants.length === 1 ? `your ${revoking.grants[0].recordType.toLowerCase()}` : `these ${count(revoking.grants.length, "record")}`}. It
            takes effect at once and is written to the blockchain. Anything already downloaded stays with them.
          </p>
        </ConfirmDialog>
      )}

      {viewer && (
        <RecordViewer
          file={viewer.file}
          title={viewer.title}
          audience="patient"
          onClose={() => {
            setViewer(null);
            loadActivity().catch(() => {});
          }}
        />
      )}
    </PatientContext.Provider>
  );
}

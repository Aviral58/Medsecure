import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CopyValue, Empty, PageHead, SearchBox, Skeleton } from "../../components/Bits.jsx";
import Icon, { recordIcon } from "../../components/Icon.jsx";
import { useToast } from "../../components/Toasts.jsx";
import { api } from "../../lib/api.js";
import { count, formatDateTime } from "../../lib/format.js";

export default function DoctorUploads() {
  const toast = useToast();
  const [uploads, setUploads] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api("/doctor/uploads")
      .then((data) => setUploads(data.uploads))
      .catch(toast.error);
  }, [toast]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (uploads || []).filter((upload) => words.every((word) => `${upload.patientName} ${upload.patientEmail} ${upload.recordType}`.toLowerCase().includes(word)));
  }, [uploads, query]);

  return (
    <>
      <PageHead title="Records you added">
        A list of what you have put into patients' files. Adding a record does not let you open it again: the patient has to share it with you.
      </PageHead>

      {uploads === null && <Skeleton rows={3} />}
      {uploads?.length === 0 && (
        <Empty
          icon="records"
          title="You have not added a record yet"
          action={
            <Link className="button button-primary" to="/add">
              Add a record
            </Link>
          }
        >
          Records you add to a patient's file are listed here.
        </Empty>
      )}

      {uploads?.length > 0 && (
        <>
          <div className="toolbar">
            <SearchBox value={query} onChange={setQuery} placeholder="Search by patient or kind of record" />
            <p className="toolbar-count">{query ? `${shown.length} of ${count(uploads.length, "record")}` : count(uploads.length, "record")}</p>
          </div>
          <ul className="rows">
            {shown.map((upload) => (
              <li key={`${upload.patientEmail}-${upload.recordId}`} className="row">
                <span className="row-icon">
                  <Icon name={recordIcon(upload.recordType)} />
                </span>
                <div className="row-main">
                  <strong>{upload.recordType}</strong>
                  <p className="row-meta">
                    For {upload.patientName} ({upload.patientEmail}). Added {formatDateTime(upload.timestamp)}.
                  </p>
                </div>
                <div className="row-actions">
                  <CopyValue value={upload.cid} label="IPFS address" head={12} tail={6} />
                </div>
              </li>
            ))}
          </ul>
          {shown.length === 0 && (
            <Empty icon="search" title="No record matches">
              Try fewer words.
            </Empty>
          )}
        </>
      )}
    </>
  );
}

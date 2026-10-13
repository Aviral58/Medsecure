import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Chips, CopyValue, Empty, PageHead, SearchBox, Skeleton, Tag } from "../../components/Bits.jsx";
import Dialog from "../../components/Dialog.jsx";
import Icon, { recordIcon } from "../../components/Icon.jsx";
import RecordForm from "../../components/RecordForm.jsx";
import { count, formatDateTime, timeLeft } from "../../lib/format.js";
import { usePatient } from "./PatientData.jsx";

const OWN_RECORDS = "Added by you";
const SORTS = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "type", label: "By type" },
];

export default function PatientRecords() {
  const { records, liveGrants, now, opening, openRecord, share, setEmergency, loadRecords, loadActivity } = usePatient();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(null); // id of the record whose details are open
  const [adding, setAdding] = useState(Boolean(location.state?.add));
  const source = params.get("from") || "all"; // which hospital's records to show

  // "Add a record" on the home page lands here with the dialog open, once.
  useEffect(() => {
    if (location.state?.add) navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location, navigate]);

  // Where the records came from: one entry per hospital, plus the patient's own uploads.
  const sources = useMemo(() => {
    const bySource = new Map();
    for (const record of records || []) {
      const key = String(record.hospitalId || 0);
      const label = record.hospitalId ? record.uploaderHospital || "Unknown hospital" : OWN_RECORDS;
      const entry = bySource.get(key) || { key, label, count: 0 };
      entry.count += 1;
      bySource.set(key, entry);
    }
    return [...bySource.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [records]);

  const types = useMemo(() => {
    const counts = new Map();
    for (const record of records || []) counts.set(record.recordType, (counts.get(record.recordType) || 0) + 1);
    return [{ id: "all", label: "All", count: records?.length || 0 }, ...[...counts].map(([name, number]) => ({ id: name, label: name, count: number }))];
  }, [records]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = (records || []).filter((record) => {
      if (source !== "all" && String(record.hospitalId || 0) !== source) return false;
      if (type !== "all" && record.recordType !== type) return false;
      const haystack = `${record.recordType} ${record.uploaderHospital || ""} ${record.uploaderName} ${formatDateTime(record.timestamp)}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
    if (sort === "oldest") list.reverse();
    if (sort === "type") list.sort((a, b) => a.recordType.localeCompare(b.recordType) || b.timestamp - a.timestamp);
    return list;
  }, [records, source, type, query, sort]);

  const selectedIds = (records || []).filter((record) => selected.has(record.id)).map((record) => record.id);
  const allShownSelected = shown.length > 0 && shown.every((record) => selected.has(record.id));
  const filtered = query || type !== "all" || source !== "all";

  function toggle(recordId) {
    const next = new Set(selected);
    if (next.has(recordId)) next.delete(recordId);
    else next.add(recordId);
    setSelected(next);
  }

  function toggleAllShown() {
    const next = new Set(selected);
    for (const record of shown) {
      if (allShownSelected) next.delete(record.id);
      else next.add(record.id);
    }
    setSelected(next);
  }

  function clearFilters() {
    setQuery("");
    setType("all");
    setParams({});
  }

  return (
    <>
      <PageHead
        title="Records"
        actions={
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} />
            Add a record
          </button>
        }
      >
        Everything in your file, from every hospital. Open a record to read it with its AI summary, or share it with a doctor.
      </PageHead>

      {records === null && <Skeleton rows={4} />}

      {records?.length === 0 && (
        <Empty
          icon="records"
          title="No records yet"
          action={
            <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
              Add your first record
            </button>
          }
        >
          Add a report you already have as a PDF or a photo. Or give your email address to a doctor at any hospital on the network, and they can add
          records to your file.
        </Empty>
      )}

      {records?.length > 0 && (
        <>
          <div className="toolbar">
            <SearchBox value={query} onChange={setQuery} placeholder="Search by type, hospital or doctor" />
            {sources.length > 1 && (
              <label className="field field-inline">
                <span className="visually-hidden">Show records from</span>
                <select value={source} onChange={(event) => setParams(event.target.value === "all" ? {} : { from: event.target.value })}>
                  <option value="all">From everywhere</option>
                  {sources.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label} ({entry.count})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field field-inline">
              <span className="visually-hidden">Order</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {types.length > 2 && <Chips options={types} value={type} onChange={setType} label="Kind of record" />}

          <div className="list-head">
            <label className="check-line">
              <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} disabled={shown.length === 0} />
              {filtered ? `${shown.length} of ${count(records.length, "record")}` : count(records.length, "record")}
            </label>
            {filtered && (
              <button type="button" className="link-button" onClick={clearFilters}>
                Show all
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <Empty icon="search" title="No record matches">
              Try fewer words, or show all records.
            </Empty>
          ) : (
            <ul className="rows">
              {shown.map((record) => {
                const origin = record.hospitalId ? record.uploaderHospital || "Unknown hospital" : "";
                const shares = liveGrants.filter((grant) => grant.recordId === record.id);
                const open = expanded === record.id;
                return (
                  <li key={record.id} className={selected.has(record.id) ? "row row-ticked" : "row"}>
                    <input
                      type="checkbox"
                      className="row-tick"
                      checked={selected.has(record.id)}
                      onChange={() => toggle(record.id)}
                      aria-label={`Tick ${record.recordType}${origin ? ` from ${origin}` : ""} for sharing`}
                    />
                    <span className="row-icon">
                      <Icon name={recordIcon(record.recordType)} />
                    </span>
                    <div className="row-main">
                      <div className="row-title">
                        <strong>{record.recordType}</strong>
                        {record.isEmergencySummary && <Tag tone="alert">Emergency summary</Tag>}
                        {shares.length > 0 && (
                          <Tag tone="primary">
                            Shared with {shares.length === 1 ? shares[0].doctorName : `${shares.length} doctors`}, {timeLeft(Math.max(...shares.map((grant) => grant.expiry)), now)} left
                          </Tag>
                        )}
                      </div>
                      <p className="row-meta">
                        {origin ? (
                          <>
                            {origin}. Added {formatDateTime(record.timestamp)} by {record.uploaderName}.
                          </>
                        ) : (
                          <>Added {formatDateTime(record.timestamp)} by you.</>
                        )}
                      </p>
                    </div>
                    <div className="row-actions">
                      <button type="button" className="button button-primary" disabled={opening === record.id} onClick={() => openRecord(record)}>
                        {opening === record.id ? "Decrypting…" : "Open"}
                      </button>
                      <button type="button" className="button" onClick={() => share([record.id])}>
                        Share
                      </button>
                      <button type="button" className="button button-quiet" aria-expanded={open} onClick={() => setExpanded(open ? null : record.id)}>
                        Details
                      </button>
                    </div>

                    {open && (
                      <div className="row-details">
                        <dl className="proof">
                          <div>
                            <dt>Record number on the blockchain</dt>
                            <dd>{record.id}</dd>
                          </div>
                          <div>
                            <dt>Where the encrypted file is (IPFS)</dt>
                            <dd>
                              <CopyValue value={record.cid} label="IPFS address" head={14} tail={8} />
                            </dd>
                          </div>
                          <div>
                            <dt>Fingerprint of the file (SHA-256)</dt>
                            <dd>
                              <CopyValue value={record.fileHash} label="fingerprint" head={14} tail={8} />
                            </dd>
                          </div>
                          <div>
                            <dt>Added by the account</dt>
                            <dd>
                              <CopyValue value={record.uploader} label="account address" head={12} tail={8} />
                            </dd>
                          </div>
                        </dl>
                        {record.isEmergencySummary ? (
                          <p className="row-details-note">
                            This is your emergency summary. A doctor with the emergency role can open it for one hour without asking you, and you will see
                            it in your activity.
                          </p>
                        ) : (
                          <button type="button" className="button" onClick={() => setEmergency(record)}>
                            <Icon name="emergency" size={18} />
                            Use as my emergency summary
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {selectedIds.length > 0 && (
        <div className="selection-bar" role="region" aria-label="Ticked records">
          <p>
            <strong>{count(selectedIds.length, "record")} ticked</strong>
          </p>
          <button type="button" className="button button-quiet" onClick={() => setSelected(new Set())}>
            Untick all
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => share(selectedIds, () => setSelected(new Set()))}
          >
            <Icon name="share" size={18} />
            Share with a doctor
          </button>
        </div>
      )}

      {adding && (
        <Dialog title="Add a record" intro="The file is encrypted on this computer's server before it is stored. Only you will be able to open it." onClose={() => setAdding(false)}>
          <RecordForm
            endpoint="/patient/records"
            onStored={() => Promise.all([loadRecords(), loadActivity()]).catch(() => {})}
            onDone={() => setAdding(false)}
          />
        </Dialog>
      )}
    </>
  );
}

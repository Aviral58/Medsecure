import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Empty, PageHead, Skeleton, Tag } from "../../components/Bits.jsx";
import Dialog from "../../components/Dialog.jsx";
import { EMPTY_HOSPITAL_DETAILS, HospitalFields, detailsOf, fullAddress } from "../../components/HospitalDetails.jsx";
import Icon from "../../components/Icon.jsx";
import PasswordField from "../../components/PasswordField.jsx";
import { useToast } from "../../components/Toasts.jsx";
import { api } from "../../lib/api.js";
import { count } from "../../lib/format.js";

const EMPTY_FORM = { hospitalName: "", ...EMPTY_HOSPITAL_DETAILS, adminName: "", adminEmail: "", adminPassword: "" };

export default function OwnerHospitals() {
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [hospitals, setHospitals] = useState(null);
  const [adding, setAdding] = useState(Boolean(location.state?.add));
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null); // hospital being edited
  const [editForm, setEditForm] = useState(EMPTY_HOSPITAL_DETAILS);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const load = useCallback(() => api("/admin/hospitals").then((data) => setHospitals(data.hospitals)), []);

  useEffect(() => {
    load().catch(toast.error);
  }, [load, toast]);

  // "Add a hospital" on the overview lands here with the form open, once.
  useEffect(() => {
    if (location.state?.add) navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  async function addHospital(event) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      await api("/admin/hospitals", { method: "POST", body: form });
      await load();
      toast.success(`${form.hospitalName} joined the network. Give ${form.adminEmail} their password so they can log in.`);
      setForm(EMPTY_FORM);
      setAdding(false);
    } catch (error) {
      setProblem(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails(event) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      await api(`/admin/hospitals/${editing.id}`, { method: "PUT", body: editForm });
      await load();
      toast.success(`Details saved for ${editing.name}.`);
      setEditing(null);
    } catch (error) {
      setProblem(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Hospitals"
        actions={
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setProblem("");
              setAdding(true);
            }}
          >
            <Icon name="plus" size={18} />
            Add a hospital
          </button>
        }
      >
        Every hospital on the network. Adding one registers it on the blockchain and creates the login for its admin.
      </PageHead>

      {hospitals === null && <Skeleton rows={3} />}
      {hospitals?.length === 0 && (
        <Empty
          icon="hospital"
          title="No hospitals yet"
          action={
            <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
              Add the first hospital
            </button>
          }
        >
          Doctors can sign up only after their hospital is on the network.
        </Empty>
      )}

      {hospitals?.length > 0 && (
        <ul className="hospital-list">
          {hospitals.map((hospital) => (
            <li key={hospital.id}>
              <div className="hospital-list-head">
                <span className="row-icon">
                  <Icon name="hospital" />
                </span>
                <div>
                  <h2>
                    {hospital.name} {!hospital.complete && <Tag tone="warning">Details incomplete</Tag>}
                  </h2>
                  <p>{[hospital.type, hospital.registrationNumber && `Registration ${hospital.registrationNumber}`].filter(Boolean).join(", ") || "No details yet"}</p>
                </div>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setProblem("");
                    setEditForm(detailsOf(hospital));
                    setEditing(hospital);
                  }}
                >
                  Edit details
                </button>
              </div>
              <dl className="facts">
                <div>
                  <dt>Address</dt>
                  <dd>{fullAddress(hospital) || <span className="muted">Not entered</span>}</dd>
                </div>
                <div>
                  <dt>Contact</dt>
                  <dd>{[hospital.phone, hospital.email].filter(Boolean).join(", ") || <span className="muted">Not entered</span>}</dd>
                </div>
                <div>
                  <dt>Admin</dt>
                  <dd>
                    {hospital.adminName} ({hospital.adminEmail})
                  </dd>
                </div>
                <div>
                  <dt>Doctors</dt>
                  <dd>{hospital.doctorCount === 0 ? "None signed up yet" : `${count(hospital.doctorCount, "doctor")} signed up`}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <Dialog title="Add a hospital" intro="The name is written to the blockchain and cannot be changed later. Everything else can." size="large" onClose={() => setAdding(false)}>
          <form className="form form-grid" onSubmit={addHospital}>
            <label className="field field-wide">
              <span>Hospital name</span>
              <input value={form.hospitalName} onChange={update("hospitalName")} required minLength={2} />
            </label>
            <HospitalFields value={form} onChange={(field, value) => setForm({ ...form, [field]: value })} />
            <p className="form-subhead">The person who will run this hospital's account and verify its doctors</p>
            <label className="field">
              <span>Admin's full name</span>
              <input value={form.adminName} onChange={update("adminName")} required minLength={2} />
            </label>
            <label className="field">
              <span>Admin's email</span>
              <input type="email" value={form.adminEmail} onChange={update("adminEmail")} required autoComplete="off" />
            </label>
            <div className="field-wide">
              <PasswordField
                label="Password for the admin"
                value={form.adminPassword}
                onChange={(value) => setForm({ ...form, adminPassword: value })}
                autoComplete="new-password"
                strength
                minLength={10}
                hint="Pass it on to the admin yourself. It is not shown again."
              />
            </div>
            {problem && (
              <p className="notice notice-error field-wide" role="alert">
                {problem}
              </p>
            )}
            <div className="form-grid-end form-actions form-actions-end">
              <button type="button" className="button button-quiet" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? "Adding hospital…" : "Add hospital"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {editing && (
        <Dialog title={`Edit details: ${editing.name}`} size="large" onClose={() => setEditing(null)}>
          <form className="form form-grid" onSubmit={saveDetails}>
            <HospitalFields value={editForm} onChange={(field, value) => setEditForm({ ...editForm, [field]: value })} />
            {problem && (
              <p className="notice notice-error field-wide" role="alert">
                {problem}
              </p>
            )}
            <div className="form-grid-end form-actions form-actions-end">
              <button type="button" className="button button-quiet" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? "Saving…" : "Save details"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

// The details kept for every hospital, as a form (HospitalFields) and as a
// read-only summary (HospitalFacts).

export const HOSPITAL_TYPES = ["Government", "Private", "Charitable trust", "Clinic or nursing home"];

export const EMPTY_HOSPITAL_DETAILS = {
  type: "",
  registrationNumber: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  phone: "",
  email: "",
};

/** Pick just the detail fields out of a hospital object, for editing. */
export function detailsOf(hospital) {
  const details = {};
  for (const field of Object.keys(EMPTY_HOSPITAL_DETAILS)) details[field] = hospital?.[field] || "";
  return details;
}

/** Form inputs for a hospital's details. `onChange(field, value)` is called on every edit. */
export function HospitalFields({ value, onChange }) {
  const bind = (field) => ({ value: value[field], onChange: (event) => onChange(field, event.target.value) });
  return (
    <>
      <label className="field">
        <span>Type of hospital</span>
        <select {...bind("type")} required>
          <option value="">Choose a type</option>
          {HOSPITAL_TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Registration number</span>
        <input {...bind("registrationNumber")} required minLength={3} />
        <small>The hospital's clinical establishment or licence number.</small>
      </label>
      <label className="field field-wide">
        <span>Street address</span>
        <input {...bind("address")} required minLength={5} autoComplete="off" />
      </label>
      <label className="field">
        <span>City</span>
        <input {...bind("city")} required minLength={2} />
      </label>
      <label className="field">
        <span>State</span>
        <input {...bind("state")} required minLength={2} />
      </label>
      <label className="field">
        <span>PIN code (optional)</span>
        <input {...bind("pincode")} inputMode="numeric" pattern="[0-9]{6}" title="6 digits" />
      </label>
      <label className="field">
        <span>Phone</span>
        <input {...bind("phone")} type="tel" required />
      </label>
      <label className="field">
        <span>Hospital email (optional)</span>
        <input {...bind("email")} type="email" autoComplete="off" />
      </label>
    </>
  );
}

/** One line for where a hospital is: "12 Mall Road, Kanpur, Uttar Pradesh 208001". */
export function fullAddress(hospital) {
  const cityLine = [hospital.city, [hospital.state, hospital.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [hospital.address, cityLine].filter(Boolean).join(", ");
}

/** Read-only summary of a hospital's details. */
export function HospitalFacts({ hospital }) {
  const rows = [
    ["Type", hospital.type],
    ["Registration number", hospital.registrationNumber],
    ["Address", fullAddress(hospital)],
    ["Phone", hospital.phone],
    ["Email", hospital.email],
  ].filter(([, value]) => value);

  if (rows.length === 0) return <p className="muted">No details have been entered for this hospital yet.</p>;
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

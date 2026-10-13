import { useState } from "react";
import { PageHead, Skeleton } from "../../components/Bits.jsx";
import Icon from "../../components/Icon.jsx";
import { useToast } from "../../components/Toasts.jsx";
import UnusualAccess from "../../components/UnusualAccess.jsx";
import { useHospital } from "./HospitalData.jsx";

export default function HospitalAlerts() {
  const { security, loadSecurity } = useHospital();
  const toast = useToast();
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      await loadSecurity();
      toast.success("Checked the access log again.");
    } catch (problem) {
      toast.error(problem);
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <PageHead
        title="Unusual access"
        actions={
          <button type="button" className="button" onClick={check} disabled={checking}>
            <Icon name="refresh" size={18} />
            {checking ? "Checking…" : "Check again"}
          </button>
        }
      >
        Hours in which one of your doctors used the system in a way that does not look like normal work. You see what they did in numbers, never which
        patients were involved.
      </PageHead>
      {security === null ? <Skeleton rows={2} /> : <UnusualAccess alerts={security.alerts} model={security.model} audience="hospital" />}
    </>
  );
}

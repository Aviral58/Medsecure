import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useToast } from "../../components/Toasts.jsx";
import { api } from "../../lib/api.js";

// What the hospital admin's pages share: the hospital's doctors, its details
// and the unusual-access alerts.

const HospitalContext = createContext(null);
export const useHospital = () => useContext(HospitalContext);

export function HospitalProvider({ children }) {
  const toast = useToast();
  const [doctors, setDoctors] = useState(null);
  const [hospital, setHospital] = useState(null);
  const [security, setSecurity] = useState(null); // { alerts, model }

  const loadDoctors = useCallback(() => api("/hospital/doctors").then((data) => setDoctors(data.doctors)), []);
  const loadHospital = useCallback(() => api("/hospital/profile").then((data) => setHospital(data.hospital)), []);
  const loadSecurity = useCallback(() => api("/hospital/alerts").then(setSecurity), []);

  // Read at the start and each time the admin moves to another page, so a
  // doctor who has just signed up is there without refreshing the browser.
  const { pathname } = useLocation();
  useEffect(() => {
    Promise.all([loadDoctors(), loadHospital(), loadSecurity()]).catch(toast.error);
  }, [loadDoctors, loadHospital, loadSecurity, toast, pathname]);

  const waiting = (doctors || []).filter((doctor) => !doctor.verified);

  return (
    <HospitalContext.Provider value={{ doctors, hospital, security, waiting, loadDoctors, loadHospital, loadSecurity }}>{children}</HospitalContext.Provider>
  );
}

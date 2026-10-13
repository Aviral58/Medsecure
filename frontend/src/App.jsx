import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { useAuth } from "./lib/auth.jsx";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";
import DoctorAdd from "./pages/doctor/Add.jsx";
import { DoctorProvider, useDoctor } from "./pages/doctor/DoctorData.jsx";
import DoctorEmergency from "./pages/doctor/Emergency.jsx";
import DoctorHome from "./pages/doctor/Home.jsx";
import DoctorUploads from "./pages/doctor/Uploads.jsx";
import HospitalAlerts from "./pages/hospital/Alerts.jsx";
import HospitalDetailsPage from "./pages/hospital/Details.jsx";
import HospitalDoctors from "./pages/hospital/Doctors.jsx";
import HospitalHome from "./pages/hospital/Home.jsx";
import { HospitalProvider, useHospital } from "./pages/hospital/HospitalData.jsx";
import OwnerHospitals from "./pages/owner/Hospitals.jsx";
import OwnerLedger from "./pages/owner/Ledger.jsx";
import OwnerModels from "./pages/owner/Models.jsx";
import OwnerOverview from "./pages/owner/Overview.jsx";
import PatientActivity from "./pages/patient/Activity.jsx";
import PatientHome from "./pages/patient/Home.jsx";
import PatientHospitals from "./pages/patient/Hospitals.jsx";
import { PatientProvider, usePatient } from "./pages/patient/PatientData.jsx";
import PatientRecords from "./pages/patient/Records.jsx";
import PatientSharing from "./pages/patient/Sharing.jsx";
import PatientTrends from "./pages/patient/Trends.jsx";

// Each kind of user has their own set of pages. A page is { to, label, icon, element }.
// The menu down the side is built from the same list, so the two cannot disagree.

function Pages({ pages }) {
  return (
    <Layout nav={pages}>
      <Routes>
        {pages.map((page) => (
          <Route key={page.to} path={page.to} element={page.element} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function PatientPages() {
  const { liveGrants, liveEmergency, security } = usePatient();
  return (
    <Pages
      pages={[
        { to: "/", label: "Home", icon: "home", element: <PatientHome /> },
        { to: "/records", label: "Records", icon: "records", element: <PatientRecords /> },
        { to: "/sharing", label: "Who has access", icon: "access", element: <PatientSharing />, badge: liveGrants.length + liveEmergency.length },
        { to: "/trends", label: "Health trends", icon: "trends", element: <PatientTrends /> },
        { to: "/activity", label: "Activity", icon: "activity", element: <PatientActivity />, badge: security?.alerts.length || 0, badgeTone: "alert" },
        { to: "/hospitals", label: "Hospitals", icon: "hospital", element: <PatientHospitals /> },
      ]}
    />
  );
}

function DoctorPages() {
  const { liveShared, liveEmergency } = useDoctor();
  return (
    <Pages
      pages={[
        { to: "/", label: "Shared with me", icon: "access", element: <DoctorHome />, badge: liveShared.length },
        { to: "/add", label: "Add a record", icon: "plus", element: <DoctorAdd /> },
        { to: "/emergency", label: "Emergency access", icon: "emergency", element: <DoctorEmergency />, badge: liveEmergency.length, badgeTone: "alert" },
        { to: "/uploads", label: "Records I added", icon: "records", element: <DoctorUploads /> },
      ]}
    />
  );
}

function HospitalPages() {
  const { waiting, security } = useHospital();
  return (
    <Pages
      pages={[
        { to: "/", label: "Home", icon: "home", element: <HospitalHome /> },
        { to: "/doctors", label: "Doctors", icon: "doctor", element: <HospitalDoctors />, badge: waiting.length, badgeTone: "alert" },
        { to: "/alerts", label: "Unusual access", icon: "alert", element: <HospitalAlerts />, badge: security?.alerts.length || 0, badgeTone: "alert" },
        { to: "/details", label: "Hospital details", icon: "hospital", element: <HospitalDetailsPage /> },
      ]}
    />
  );
}

const OWNER_PAGES = [
  { to: "/", label: "Overview", icon: "home", element: <OwnerOverview /> },
  { to: "/hospitals", label: "Hospitals", icon: "hospital", element: <OwnerHospitals /> },
  { to: "/ledger", label: "Blockchain ledger", icon: "chain", element: <OwnerLedger /> },
  { to: "/models", label: "AI models", icon: "spark", element: <OwnerModels /> },
];

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <p className="page-loading">Loading MedSecure…</p>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  switch (user.role) {
    case "patient":
      return (
        <PatientProvider>
          <PatientPages />
        </PatientProvider>
      );
    case "doctor":
      return (
        <DoctorProvider>
          <DoctorPages />
        </DoctorProvider>
      );
    case "hospitalAdmin":
      return (
        <HospitalProvider>
          <HospitalPages />
        </HospitalProvider>
      );
    default:
      return <Pages pages={OWNER_PAGES} />;
  }
}

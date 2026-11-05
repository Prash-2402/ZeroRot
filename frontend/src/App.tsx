import { Route, Routes } from "react-router-dom";
import { Layout, Toasts } from "./components/Layout";
import { useLiveSocket } from "./lib/ws";
import ControlRoom from "./pages/ControlRoom";
import Batches from "./pages/Batches";
import Twin from "./pages/Twin";
import Decide from "./pages/Decide";
import Markets from "./pages/Markets";
import Transport from "./pages/Transport";
import Passport, { PublicPassport } from "./pages/Passport";
import Impact from "./pages/Impact";
import Settings from "./pages/Settings";
import Judge from "./pages/Judge";

function Shell({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>;
}

export default function App() {
  useLiveSocket();
  return (
    <>
      <Routes>
        <Route path="/" element={<ControlRoom />} />
        <Route path="/judge" element={<Judge />} />
        <Route path="/p/:token" element={<PublicPassport />} />
        <Route path="/batches" element={<Shell><Batches /></Shell>} />
        <Route path="/twin" element={<Shell><Twin /></Shell>} />
        <Route path="/decide" element={<Shell><Decide /></Shell>} />
        <Route path="/markets" element={<Shell><Markets /></Shell>} />
        <Route path="/transport" element={<Shell><Transport /></Shell>} />
        <Route path="/passport" element={<Shell><Passport /></Shell>} />
        <Route path="/impact" element={<Shell><Impact /></Shell>} />
        <Route path="/settings" element={<Shell><Settings /></Shell>} />
        <Route path="*" element={<Shell><div className="p-10 text-center text-charcoal-400">Page not found.</div></Shell>} />
      </Routes>
      <Toasts />
    </>
  );
}

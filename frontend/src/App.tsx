import { Route, Routes } from "react-router-dom";
import { Layout, Toasts } from "./components/Layout";
import { useLiveSocket } from "./lib/ws";
import FarmPage from "./farm/FarmPage";
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
        {/* Farmer view (default) */}
        <Route path="/" element={<FarmPage />} />
        <Route path="/judge" element={<Judge />} />
        <Route path="/p/:token" element={<PublicPassport />} />
        {/* Analytics / operator view (reached from Detailed mode) */}
        <Route path="/ops" element={<ControlRoom />} />
        <Route path="/ops/batches" element={<Shell><Batches /></Shell>} />
        <Route path="/ops/twin" element={<Shell><Twin /></Shell>} />
        <Route path="/ops/decide" element={<Shell><Decide /></Shell>} />
        <Route path="/ops/markets" element={<Shell><Markets /></Shell>} />
        <Route path="/ops/transport" element={<Shell><Transport /></Shell>} />
        <Route path="/ops/passport" element={<Shell><Passport /></Shell>} />
        <Route path="/ops/impact" element={<Shell><Impact /></Shell>} />
        <Route path="/ops/settings" element={<Shell><Settings /></Shell>} />
        <Route path="*" element={<FarmPage />} />
      </Routes>
      <Toasts />
    </>
  );
}

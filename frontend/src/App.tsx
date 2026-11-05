import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { Loading } from "./components/ui";
import { useAuth } from "./stores/auth";

const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const Overview = lazy(() => import("./pages/Overview"));
const PostHarvest = lazy(() => import("./pages/PostHarvest"));
const Traditional = lazy(() => import("./pages/Traditional"));
const Advanced = lazy(() => import("./pages/Advanced"));
const ColdStorage = lazy(() => import("./pages/ColdStorage"));
const Price = lazy(() => import("./pages/Price"));
const ColdChain = lazy(() => import("./pages/ColdChain"));
const Lab = lazy(() => import("./pages/Lab"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Settings = lazy(() => import("./pages/Settings"));
const Mobile = lazy(() => import("./pages/Mobile"));

function Protected({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <AppLayout>{children}</AppLayout>;
}

export default function App() {
  const page = (el: ReactNode) => <Protected><Suspense fallback={<Loading />}>{el}</Suspense></Protected>;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/m/:token" element={<Mobile />} />
        <Route path="/app" element={page(<Overview />)} />
        <Route path="/app/post-harvest" element={page(<PostHarvest />)} />
        <Route path="/app/traditional" element={page(<Traditional />)} />
        <Route path="/app/advanced" element={page(<Advanced />)} />
        <Route path="/app/cold-storage" element={page(<ColdStorage />)} />
        <Route path="/app/price" element={page(<Price />)} />
        <Route path="/app/cold-chain" element={page(<ColdChain />)} />
        <Route path="/app/lab" element={page(<Lab />)} />
        <Route path="/app/alerts" element={page(<Alerts />)} />
        <Route path="/app/analytics" element={page(<Analytics />)} />
        <Route path="/app/settings" element={page(<Settings />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

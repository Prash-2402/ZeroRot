import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, post } from "../lib/api";
import { Logo } from "../components/AppLayout";
import { ErrorBox, Field, Loading, Note, Spinner } from "../components/ui";
import { useAuth } from "../stores/auth";

export default function Login() {
  const nav = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);
  const setup = useQuery({ queryKey: ["setup"], queryFn: () => api("/auth/setup") });
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const needsAdmin = setup.data?.needs_admin;
  const m = useMutation({
    mutationFn: () => post(needsAdmin ? "/auth/register" : "/auth/login", needsAdmin ? f : { email: f.email, password: f.password }),
    onSuccess: (d) => { setAuth(d.access_token, d.user); nav("/world"); },
  });
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink p-10 text-paper lg:flex">
        <Link to="/"><Logo /></Link>
        <div>
          <div className="font-display text-5xl font-bold leading-tight">Intelligent Agriculture.<br /><span className="text-gold">Reduced Losses.</span><br />Better Profits.</div>
          <p className="mt-4 max-w-md text-sm text-ink-300">Sign in to monitor storage rooms, cold rooms and refrigerated trucks through physics-based digital twins.</p>
        </div>
        <div className="text-xs text-ink-400">ZERO ROT · post-harvest digital twin</div>
      </div>
      <div className="flex items-center justify-center bg-paper p-6">
        <form className="w-full max-w-sm space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <div className="lg:hidden"><Logo light={false} /></div>
          {setup.isLoading ? <Loading /> : setup.error ? <ErrorBox error={setup.error} /> : (
            <>
              <div>
                <h1 className="h1">{needsAdmin ? "Create the admin account" : "Sign in"}</h1>
                <p className="mt-1 text-sm text-ink-400">{needsAdmin ? "No users exist yet. The first account becomes the administrator; it can add operators and farmers later." : "Use the account your administrator created."}</p>
              </div>
              {needsAdmin && <Field label="Full name"><input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>}
              <Field label="Username or email"><input className="input" type="text" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" /></Field>
              <Field label="Password" hint={needsAdmin ? "At least 8 characters" : undefined}><input className="input" type="password" required minLength={needsAdmin ? 8 : 1} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={needsAdmin ? "new-password" : "current-password"} /></Field>
              <ErrorBox error={m.error} />
              <button className="btn-gold w-full py-2.5" disabled={m.isPending}>{m.isPending ? <Spinner /> : needsAdmin ? "Create admin & continue" : "Sign in"}</button>
              {needsAdmin && <Note>Passwords are stored as bcrypt hashes. Sessions use signed, expiring tokens.</Note>}
            </>
          )}
        </form>
      </div>
    </div>
  );
}

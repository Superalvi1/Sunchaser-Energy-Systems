import React, { useEffect, useMemo, useState } from "react";
import { Key, Lock, Loader2, UserPlus, Mail, ArrowLeft } from "lucide-react";
import {
  loginUser,
  registerUser,
  verifyEmailToken,
  requestPasswordReset,
  resetPasswordWithToken,
} from "../services/api";
import { LOGIN_UNABLE_CONNECT_MESSAGE } from "../lib/startupFetch";
import { SELF_REGISTER_ROLES } from "../lib/roles";
import type { User } from "../types";
import AppLogo from "./AppLogo";

type AuthMode = "login" | "register" | "forgot" | "reset" | "verify";

interface AuthHubProps {
  onLoginSuccess: (user: User) => void | Promise<void>;
  initialUsername?: string;
}

function readUrlAuthHint(): { mode: AuthMode; token: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const path = window.location.pathname || "";
  if (path.includes("verify-email") || params.get("verify") === "1") {
    return { mode: "verify", token };
  }
  if (path.includes("reset-password") || params.get("reset") === "1") {
    return { mode: "reset", token };
  }
  return null;
}

export default function AuthHub({ onLoginSuccess, initialUsername = "" }: AuthHubProps) {
  const urlHint = useMemo(() => readUrlAuthHint(), []);
  const [mode, setMode] = useState<AuthMode>(urlHint?.mode || "login");
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(SELF_REGISTER_ROLES[0]);
  const [token, setToken] = useState(urlHint?.token || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (urlHint?.mode === "verify" && urlHint.token) {
      void runVerify(urlHint.token);
    }
  }, []);

  const runVerify = async (t: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await verifyEmailToken(t);
      setInfo(res.message);
      setMode("login");
    } catch (err: any) {
      setError(err.message || "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please enter username and password.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await loginUser({ username, password });
      if (!res.success || !res.user) {
        setError("Login authorization rejected.");
        return;
      }
      await onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || LOGIN_UNABLE_CONNECT_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await registerUser({ username, password, name, email, role });
      setInfo(res.message);
      if (!res.needsApproval && role === "Customer") {
        setMode("login");
      }
    } catch (err: any) {
      setError(err.message || "Registration failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await requestPasswordReset(email);
      setInfo(res.message);
    } catch (err: any) {
      setError(err.message || "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await resetPasswordWithToken(token, password);
      setInfo(res.message);
      setMode("login");
    } catch (err: any) {
      setError(err.message || "Reset failed.");
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "register"
      ? "Create account"
      : mode === "forgot"
        ? "Forgot password"
        : mode === "reset"
          ? "Set new password"
          : mode === "verify"
            ? "Email verification"
            : "Sign in";

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-6 fade-in-entry">
      <div className="text-center space-y-2">
        <AppLogo className="h-14 w-auto mx-auto mb-2" />
        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold">
          SUNCHASER ACCESS
        </span>
        <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white">Solar Business Login Hub</h2>
        <p className="text-slate-400 text-sm max-w-lg mx-auto">
          Staff, technicians, sales, and customers — register or sign in with role-based access.
        </p>
      </div>

      <div className="grid grid-cols-1 max-w-md gap-4 mx-auto">
        <div className="w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-5 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {mode === "login" ? (
                <Lock className="text-amber-500 h-5 w-5" />
              ) : (
                <UserPlus className="text-amber-500 h-5 w-5" />
              )}
              <h3 className="text-lg font-bold">{title}</h3>
            </div>
            {mode !== "login" && mode !== "verify" && (
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError(null);
                  setInfo(null);
                }}
                className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1"
              >
                <ArrowLeft className="h-3 w-3" /> Back
              </button>
            )}
          </div>

          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4 text-xs font-mono">
              <label className="text-slate-400 block font-semibold">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 text-sm font-sans"
                placeholder="username"
              />
              <label className="text-slate-400 block font-semibold">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 text-sm"
              />
              {error && <p className="text-red-400 text-center text-[11px]">{error}</p>}
              {info && <p className="text-emerald-400 text-center text-[11px]">{info}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-extrabold text-sm py-3 rounded-xl flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
                {busy ? "Connecting to Sunchaser..." : "Sign in"}
              </button>
              <div className="flex flex-col gap-2 pt-2 text-center text-[11px] text-slate-400">
                <button type="button" className="hover:text-amber-400" onClick={() => setMode("forgot")}>
                  Forgot password?
                </button>
                <button type="button" className="hover:text-amber-400" onClick={() => setMode("register")}>
                  Register new account
                </button>
              </div>
            </form>
          )}

          {mode === "register" && (
            <form onSubmit={handleRegister} className="space-y-3 text-xs font-mono">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100"
              >
                {SELF_REGISTER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                    {r === "Technician" || r === "Sales Executive" ? " (needs approval)" : ""}
                  </option>
                ))}
              </select>
              <input
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <input
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              {error && <p className="text-red-400 text-[11px]">{error}</p>}
              {info && <p className="text-emerald-400 text-[11px]">{info}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full bg-amber-500 text-slate-950 font-bold py-3 rounded-xl"
              >
                {busy ? "Submitting..." : "Register"}
              </button>
            </form>
          )}

          {mode === "forgot" && (
            <form onSubmit={handleForgot} className="space-y-3">
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <Mail className="h-4 w-4" />
                <span>We will email a reset link if the account exists.</span>
              </div>
              <input
                type="email"
                placeholder="Account email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              {error && <p className="text-red-400 text-[11px]">{error}</p>}
              {info && <p className="text-emerald-400 text-[11px]">{info}</p>}
              <button type="submit" disabled={busy} className="w-full bg-amber-500 text-slate-950 font-bold py-3 rounded-xl">
                Send reset link
              </button>
            </form>
          )}

          {mode === "reset" && (
            <form onSubmit={handleReset} className="space-y-3">
              <input
                placeholder="Reset token (from email link)"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono"
              />
              <input
                type="password"
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              {error && <p className="text-red-400 text-[11px]">{error}</p>}
              {info && <p className="text-emerald-400 text-[11px]">{info}</p>}
              <button type="submit" disabled={busy} className="w-full bg-amber-500 text-slate-950 font-bold py-3 rounded-xl">
                Update password
              </button>
            </form>
          )}

          {mode === "verify" && (
            <div className="space-y-3 text-sm text-slate-300">
              <p>Verifying your email…</p>
              {!urlHint?.token && (
                <input
                  placeholder="Paste verification token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono"
                />
              )}
              <button
                type="button"
                disabled={busy || !token}
                onClick={() => runVerify(token)}
                className="w-full bg-amber-500 text-slate-950 font-bold py-3 rounded-xl"
              >
                Verify email
              </button>
              {error && <p className="text-red-400 text-[11px]">{error}</p>}
              {info && <p className="text-emerald-400 text-[11px]">{info}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

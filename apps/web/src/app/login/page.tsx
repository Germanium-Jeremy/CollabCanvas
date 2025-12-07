"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Github, Chrome } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "oauth" ? "OAuth sign-in failed. Please try again." : null,
  );
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      } else {
        await api("/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) });
      }
      router.push(searchParams.get("next") ?? "/rooms");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError("Invalid email or password.");
      else if (err instanceof ApiError && err.status === 409) setError("That email is already registered.");
      else if (err instanceof ApiError && err.status === 429) setError("Too many attempts — try again in a few minutes.");
      else setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 w-full max-w-sm rounded-xl border bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold">{mode === "login" ? "Sign in" : "Create account"}</h1>

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href={`${env.apiUrl}/api/auth/oauth/github`}
          className="flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <Github className="h-4 w-4" aria-hidden /> GitHub
        </a>
        <a
          href={`${env.apiUrl}/api/auth/oauth/google`}
          className="flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <Chrome className="h-4 w-4" aria-hidden /> Google
        </a>
      </div>

      <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" /> or with email <span className="h-px flex-1 bg-slate-200" />
      </div>

      <form onSubmit={submit} className="space-y-3">
        {mode === "register" ? (
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">
              Name
            </label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </div>
        ) : null}
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <button
        type="button"
        className="mt-4 w-full text-center text-sm text-blue-600 hover:underline"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError(null);
        }}
      >
        {mode === "login" ? "No account? Register" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="px-4 pb-16">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { colorForUser } from "@/lib/user-colors";

interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/**
 * Session-aware header nav: shows the signed-in identity (avatar + Sign out)
 * or a Sign in link when there is no session. The root layout persists across
 * client-side navigations, so the menu re-checks on route changes (e.g. right
 * after login redirects to /rooms) and on auth-change events.
 */
export function UserMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const check = useCallback(async (signal: { cancelled: boolean }) => {
    try {
      const data = await api<{ user: SessionUser | null }>("/auth/me");
      if (!signal.cancelled) {
        setUser(data.user);
        setReady(true);
      }
    } catch {
      // 401 after a failed silent refresh = signed out; anything else (network
      // down) must not flip a signed-in header to "Sign in".
      if (!signal.cancelled) {
        setUser(null);
        setReady(true);
      }
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void check(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [check, pathname]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      setUser(null);
      router.push("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }, [router]);

  if (!ready) {
    // Reserved space keeps the header height stable while the session is checked.
    return <div className="h-8 w-24" aria-hidden />;
  }

  if (!user) {
    return (
      <Link href="/login" className="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700">
        Sign in
      </Link>
    );
  }

  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-2 text-sm text-slate-700" data-testid="header-user">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: colorForUser(user.id) }}
          aria-hidden
        >
          {initials}
        </span>
        <span className="max-w-[10rem] truncate">{user.name ?? user.email}</span>
      </span>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={signingOut}
        className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
        data-testid="sign-out"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

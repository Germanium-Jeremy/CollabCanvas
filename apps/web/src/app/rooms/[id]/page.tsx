"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { RoomRole } from "@collabcanvas/shared";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Board } from "@/components/board/Board";

interface RoomInfo {
  id: string;
  name: string;
  isPublic: boolean;
  ownerId: string;
  inviteCode: string | null;
  role: RoomRole;
  isMember: boolean;
}

interface Me {
  user: { id: string; email: string; name: string | null; image: string | null } | null;
}

function RoomView() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = params.id;

  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [me, setMe] = useState<Me["user"]>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "unauth" | "notfound">("loading");
  const [code, setCode] = useState(searchParams.get("code") ?? "");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [redeemState, setRedeemState] = useState<"idle" | "busy" | "error">("idle");
  const [redeemError, setRedeemError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [roomInfo, meInfo] = await Promise.all([api<RoomInfo>(`/rooms/${roomId}`), api<Me>("/auth/me")]);
      setRoom(roomInfo);
      setMe(meInfo.user);
      setState("ready");
    } catch (err) {
      // A private-room link (?code=…) is an explicit invitation: following it
      // is the intent to join, so the code join happens once, automatically.
      // A bare private URL (no code) lands on the manual code form instead.
      const shareCode = new URLSearchParams(window.location.search).get("code");
      if (err instanceof ApiError && err.status === 403 && shareCode) {
        try {
          await api(`/rooms/${roomId}/join`, { method: "POST", body: JSON.stringify({ code: shareCode }) });
          const [roomInfo, meInfo] = await Promise.all([api<RoomInfo>(`/rooms/${roomId}`), api<Me>("/auth/me")]);
          setRoom(roomInfo);
          setMe(meInfo.user);
          setState("ready");
          return;
        } catch {
          // Invalid code: fall through to the manual form below.
        }
      }
      if (err instanceof ApiError) {
        if (err.status === 401) setState("unauth");
        else if (err.status === 403) setState("forbidden");
        else if (err.status === 404) setState("notfound");
        else setState("notfound");
      } else {
        setState("notfound");
      }
    }
  }, [roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Explicit join. Opening a board never mutates membership: a public-room
   * visitor stays VIEWER until the owner promotes them; a private room needs
   * its share-link code (?code=…). Links never grant edit rights.
   */
  async function join(event: React.FormEvent) {
    event.preventDefault();
    setJoining(true);
    setJoinError(null);
    try {
      await api(`/rooms/${roomId}/join`, { method: "POST", body: JSON.stringify({ code: code || undefined }) });
      await load();
    } catch (err) {
      setJoinError(
        err instanceof ApiError && err.status === 403
          ? "This room is private — a valid invite code is required."
          : "Could not join the room.",
      );
    } finally {
      setJoining(false);
    }
  }

  /** Consume an email invitation (?invite=<code>&email=<address>). */
  const inviteParam = searchParams.get("invite");
  const emailParam = searchParams.get("email");

  async function redeemInvite() {
    if (!inviteParam || !emailParam) return;
    setRedeemState("busy");
    setRedeemError(null);
    try {
      await api(`/rooms/${roomId}/invitations/redeem`, {
        method: "POST",
        body: JSON.stringify({ email: emailParam, code: inviteParam }),
      });
      setRedeemState("idle");
      await load();
    } catch (err) {
      setRedeemState("error");
      setRedeemError(err instanceof ApiError && err.status === 403 ? "This invitation is not valid." : "Could not accept the invitation.");
    }
  }

  if (state === "loading") {
    return <div className="p-10 text-sm text-slate-500">Loading room…</div>;
  }

  if (state === "unauth") {
    router.push(`/login?next=/rooms/${roomId}`);
    return null;
  }

  if (state === "forbidden") {
    // An invited user on a private room is not a member yet, so the room GET
    // 403s. The email invitation must be redeemable from exactly this state.
    const forbiddenInvite = Boolean(inviteParam && emailParam);
    return (
      <main className="mx-auto mt-20 max-w-sm space-y-4">
        {forbiddenInvite ? (
          <div className="rounded-xl border bg-blue-50 p-4 text-sm" data-testid="invite-banner">
            <p>
              You were invited to this private board.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={() => void redeemInvite()} disabled={redeemState === "busy"} data-testid="accept-invite">
                {redeemState === "busy" ? "Accepting…" : "Accept invitation"}
              </Button>
            </div>
            {redeemError ? (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {redeemError}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h1 className="font-semibold">Private room</h1>
          <p className="mt-2 text-sm text-slate-600">Enter the invite code to join this board.</p>
          <form onSubmit={join} className="mt-4 space-y-3">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Invite code"
              aria-label="Invite code"
            />
            {joinError ? (
              <p role="alert" className="text-sm text-red-700">
                {joinError}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={joining}>
              {joining ? "Joining…" : "Join room"}
            </Button>
          </form>
        </div>
      </main>
    );
  }

  if (state === "notfound" || !room || !me) {
    return (
      <main className="mx-auto mt-20 max-w-sm text-center">
        <h1 className="font-semibold">Room not found</h1>
        <p className="mt-2 text-sm text-slate-600">It may have been deleted by its owner.</p>
        <Link href="/rooms" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          Back to my rooms
        </Link>
      </main>
    );
  }

  // An email invitation in the URL surfaces as an explicit, cancelable offer.
  const hasPendingInvite = Boolean(inviteParam && emailParam) && room.role === "VIEWER";
  // Public visitors view by default; joining records membership so the owner
  // can see and promote them from the roster.
  const showJoinBanner = room.isPublic && !room.isMember && room.role === "VIEWER";

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {showJoinBanner ? (
        <div className="flex items-center justify-between gap-3 border-b bg-amber-50 px-4 py-2 text-sm" data-testid="join-banner">
          <span>You are viewing this board as a guest.</span>
          <Button size="sm" variant="secondary" onClick={() => void join({ preventDefault() {} } as React.FormEvent)} data-testid="join-button">
            {joining ? "Joining…" : "Join board"}
          </Button>
        </div>
      ) : null}
      {hasPendingInvite ? (
        <div className="flex items-center justify-between gap-3 border-b bg-blue-50 px-4 py-2 text-sm">
          <span>
            You were invited to <strong>{room.name}</strong> as{" "}
            <strong>{searchParams.get("role") === "EDITOR" ? "editor" : "viewer"}</strong>.
          </span>
          <span className="flex items-center gap-2">
            <Button size="sm" onClick={() => void redeemInvite()} disabled={redeemState === "busy"} data-testid="accept-invite">
              {redeemState === "busy" ? "Accepting…" : "Accept invitation"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => router.replace(`/rooms/${roomId}`)}>
              Not now
            </Button>
          </span>
        </div>
      ) : null}
      {redeemError ? (
        <p role="alert" className="border-b bg-red-50 px-4 py-2 text-sm text-red-700">
          {redeemError}
        </p>
      ) : null}
      <Board
        roomId={room.id}
        roomName={room.name}
        role={room.role}
        isPublic={room.isPublic}
        inviteCode={room.inviteCode}
        user={{ id: me.id, name: me.name ?? me.email }}
      />
    </div>
  );
}

export default function RoomPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-slate-500">Loading room…</div>}>
      <RoomView />
    </Suspense>
  );
}

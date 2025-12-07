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

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [roomInfo, meInfo] = await Promise.all([
        api<RoomInfo>(`/rooms/${roomId}`),
        api<Me>("/auth/me"),
      ]);
      setRoom(roomInfo);
      setMe(meInfo.user);
      setState("ready");
    } catch (err) {
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

  if (state === "loading") {
    return <div className="p-10 text-sm text-slate-500">Loading room…</div>;
  }

  if (state === "unauth") {
    router.push(`/login?next=/rooms/${roomId}`);
    return null;
  }

  if (state === "forbidden") {
    return (
      <main className="mx-auto mt-20 max-w-sm rounded-xl border bg-white p-6 shadow-sm">
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

  return (
    <Board
      roomId={room.id}
      roomName={room.name}
      role={room.role}
      inviteCode={room.inviteCode}
      user={{ id: me.id, name: me.name ?? me.email }}
    />
  );
}

export default function RoomPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-slate-500">Loading room…</div>}>
      <RoomView />
    </Suspense>
  );
}

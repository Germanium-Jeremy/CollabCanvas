"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { RoomRole } from "@collabcanvas/shared";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RoomSummary {
  id: string;
  name: string;
  isPublic: boolean;
  role: RoomRole;
  updatedAt: string;
}

export default function RoomsPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRooms(await api<RoomSummary[]>("/rooms/mine"));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Please sign in again." : "Failed to load rooms.");
      setRooms([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRoom(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const room = await api<{ id: string }>("/rooms", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), isPublic }),
      });
      router.push(`/rooms/${room.id}`);
    } catch {
      setError("Could not create the room.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My rooms</h1>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus className="h-4 w-4" aria-hidden /> New room
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {creating ? (
        <form onSubmit={createRoom} className="mt-6 rounded-xl border bg-white p-4 shadow-sm" data-testid="create-room-form">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="room-name" className="mb-1 block text-sm font-medium">
                Room name
              </label>
              <Input
                id="room-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sprint planning"
                maxLength={100}
                required
                autoFocus
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="h-4 w-4"
              />
              Public (anyone with the link can edit)
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      ) : null}

      <ul className="mt-6 space-y-2" data-testid="room-list">
        {rooms === null ? (
          <li className="text-sm text-slate-500">Loading…</li>
        ) : rooms.length === 0 ? (
          <li className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">
            No rooms yet — create your first one to start drawing.
          </li>
        ) : (
          rooms.map((room) => (
            <li key={room.id}>
              <button
                type="button"
                onClick={() => router.push(`/rooms/${room.id}`)}
                className="flex w-full items-center justify-between rounded-xl border bg-white p-4 text-left shadow-sm hover:border-blue-300 hover:bg-blue-50/40"
              >
                <div>
                  <p className="font-medium">{room.name}</p>
                  <p className="text-xs text-slate-500">
                    Last activity {new Date(room.updatedAt).toLocaleString()} ·{" "}
                    {room.isPublic ? "Public" : "Private"}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                  {room.role}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}

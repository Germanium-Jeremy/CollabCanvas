"use client";

import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw, X } from "lucide-react";
import * as Y from "yjs";
import { buildRestoreUpdate, encodeDocToBase64 } from "@collabcanvas/yjs-utils";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface SnapshotMeta {
  id: string;
  version: number;
  label: string | null;
  createdAt: string;
}

interface HistoryPanelProps {
  roomId: string;
  doc: Y.Doc | null;
  canEdit: boolean;
  onClose: () => void;
}

export function HistoryPanel({ roomId, doc, canEdit, onClose }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSnapshots(await api<SnapshotMeta[]>(`/rooms/${roomId}/snapshots`));
    } catch {
      setError("Failed to load snapshots.");
    }
  }, [roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!doc) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/rooms/${roomId}/snapshots`, {
        method: "POST",
        body: JSON.stringify({ data: encodeDocToBase64(doc), label: `Manual ${new Date().toLocaleTimeString()}` }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? "Only editors can save versions." : "Failed to save snapshot.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(snapshot: SnapshotMeta) {
    if (!doc) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ data: string }>(`/rooms/${roomId}/snapshots/${snapshot.id}`);
      // Apply the replacement update locally; it propagates to all peers.
      const update = buildRestoreUpdate(doc, data.data);
      Y.applyUpdate(doc, update);
      setError(null);
    } catch {
      setError("Failed to restore snapshot.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="absolute right-4 top-4 z-20 w-80 rounded-xl border bg-white p-4 shadow-lg" data-testid="history-panel">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-blue-500" aria-hidden /> Version history
        </h2>
        <button type="button" onClick={onClose} aria-label="Close history panel" className="text-slate-400 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      {canEdit ? (
        <Button size="sm" className="mt-3 w-full" onClick={save} disabled={busy || !doc}>
          Save current version
        </Button>
      ) : null}

      <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto" data-testid="snapshot-list">
        {snapshots === null ? (
          <li className="text-xs text-slate-500">Loading…</li>
        ) : snapshots.length === 0 ? (
          <li className="text-xs text-slate-500">No saved versions yet.</li>
        ) : (
          snapshots.map((snapshot) => (
            <li key={snapshot.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2 text-xs">
              <div>
                <p className="font-medium">
                  v{snapshot.version}
                  {snapshot.label ? ` — ${snapshot.label}` : ""}
                </p>
                <p className="text-slate-500">{new Date(snapshot.createdAt).toLocaleString()}</p>
              </div>
              {canEdit ? (
                <Button size="sm" variant="ghost" onClick={() => restore(snapshot)} disabled={busy}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore
                </Button>
              ) : null}
            </li>
          ))
        )}
      </ul>

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

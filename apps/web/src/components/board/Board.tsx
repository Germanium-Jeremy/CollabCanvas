"use client";

// Type-only: Konva is only referenced in prop/ref types here. The runtime import
// lives in CanvasStage, which is client-only (see dynamic import below).
import type Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Link2, Sparkles, Wifi, WifiOff } from "lucide-react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { boardElementSchema, type BoardElement, type RoomRole } from "@collabcanvas/shared";
import { ELEMENTS_MAP_KEY, encodeDocToBase64 } from "@collabcanvas/yjs-utils";
import { api } from "@/lib/api";
import { env } from "@/lib/env";
import { colorForUser, exportFileName } from "@/lib/user-colors";
import { usePresence } from "@/hooks/use-presence";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "./ErrorBoundary";
import { HistoryPanel } from "./HistoryPanel";
import { AiPanel } from "./AiPanel";
import { PresenceAvatars, PresenceCursors } from "./PresenceLayer";
import { Toolbar } from "./Toolbar";
import dynamic from "next/dynamic";
import { DEFAULT_CAMERA, type Camera, type Tool } from "./types";

// react-konva 19.3's version guard evaluates at import time and fails against
// Next.js's vendored server React (19.2-canary), so the canvas must never load
// during SSR. A canvas has nothing to render server-side anyway.
const CanvasStage = dynamic(() => import("./CanvasStage").then((m) => m.CanvasStage), {
  ssr: false,
  loading: () => null,
});

interface BoardProps {
  roomId: string;
  roomName: string;
  role: RoomRole;
  inviteCode: string | null;
  user: { id: string; name: string };
}

function readElements(ymap: Y.Map<unknown>): BoardElement[] {
  const elements: BoardElement[] = [];
  ymap.forEach((value) => {
    const parsed = boardElementSchema.safeParse(value);
    if (parsed.success) elements.push(parsed.data);
  });
  return elements.sort((a, b) => a.z - b.z || a.createdAt - b.createdAt);
}

export function Board({ roomId, roomName, role, inviteCode, user }: BoardProps) {
  const canEdit = role === "OWNER" || role === "EDITOR";

  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [stacks, setStacks] = useState({ undo: 0, redo: 0 });

  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#fde047");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [aiOpen, setAiOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const stageRef = useRef<Konva.Stage | null>(null);
  const lastSavedRef = useRef<string | null>(null);

  const selfColor = useMemo(() => colorForUser(user.id), [user.id]);

  // ---- Realtime connection lifecycle ----
  useEffect(() => {
    let destroyed = false;
    let localDoc: Y.Doc | null = null;
    let localProvider: WebsocketProvider | null = null;

    (async () => {
      try {
        const { token } = await api<{ token: string }>("/auth/token");
        if (destroyed) return;
        localDoc = new Y.Doc();
        localProvider = new WebsocketProvider(env.wsUrl, `${roomId}/${token}`, localDoc);

        const ymap = localDoc.getMap<unknown>(ELEMENTS_MAP_KEY);
        const pushElements = () => setElements(readElements(ymap));
        ymap.observe(pushElements);
        pushElements();

        localProvider.on("status", (event: { status: string }) => {
          setConnected(event.status === "connected");
        });

        setDoc(localDoc);
        setProvider(localProvider);
      } catch {
        if (!destroyed) setConnectionError("Could not join the live session. Try reloading.");
      }
    })();

    return () => {
      destroyed = true;
      localProvider?.destroy();
      localDoc?.destroy();
    };
  }, [roomId]);

  // ---- Local presence identity ----
  useEffect(() => {
    if (!provider) return;
    provider.awareness.setLocalStateField("user", {
      userId: user.id,
      name: user.name,
      color: selfColor,
      cursor: undefined,
      isEditing: false,
    });
  }, [provider, user, selfColor]);

  // "User is editing" indicator.
  useEffect(() => {
    if (!provider) return;
    const isEditing = tool !== "select" || editingId !== null;
    provider.awareness.setLocalStateField("user", {
      userId: user.id,
      name: user.name,
      color: selfColor,
      cursor: (provider.awareness.getLocalState()?.user as { cursor?: { x: number; y: number } } | undefined)?.cursor,
      isEditing,
    });
  }, [provider, tool, editingId, user, selfColor]);

  const presence = usePresence(provider);

  // ---- Mutations ----
  const addElements = useCallback(
    (newElements: BoardElement[]) => {
      if (!doc || !canEdit) return;
      const ymap = doc.getMap<unknown>(ELEMENTS_MAP_KEY);
      doc.transact(() => {
        for (const element of newElements) ymap.set(element.id, element);
      });
    },
    [canEdit, doc],
  );

  const updateElement = useCallback(
    (id: string, patch: Partial<BoardElement>) => {
      if (!doc || !canEdit) return;
      const ymap = doc.getMap<unknown>(ELEMENTS_MAP_KEY);
      const current = ymap.get(id);
      if (current) ymap.set(id, { ...(current as object), ...patch });
    },
    [canEdit, doc],
  );

  const deleteElement = useCallback(
    (id: string) => {
      if (!doc || !canEdit) return;
      doc.getMap<unknown>(ELEMENTS_MAP_KEY).delete(id);
      setSelectedId((current) => (current === id ? null : current));
    },
    [canEdit, doc],
  );

  const onCursorMove = useCallback(
    (point: { x: number; y: number } | null) => {
      if (!provider) return;
      provider.awareness.setLocalStateField("cursor", point ?? undefined);
    },
    [provider],
  );

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) undoRef.current?.redo();
        else undoRef.current?.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        undoRef.current?.redo();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId && canEdit) {
        event.preventDefault();
        deleteElement(selectedId);
        return;
      }
      if (mod || !canEdit) return;
      const shortcuts: Record<string, Tool> = {
        v: "select", p: "pen", r: "rect", o: "ellipse", t: "text", s: "sticky", a: "arrow", e: "eraser",
      };
      const next = shortcuts[event.key.toLowerCase()];
      if (next) setTool(next);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit, deleteElement, selectedId]);

  // Undo/redo manager, kept out of render state via a ref so shortcuts stay stable.
  const undoRef = useRef<Y.UndoManager | null>(null);
  useEffect(() => {
    if (!doc) return;
    const ymap = doc.getMap<unknown>(ELEMENTS_MAP_KEY);
    const undoManager = new Y.UndoManager(ymap);
    const refreshStacks = () => setStacks({ undo: undoManager.undoStack.length, redo: undoManager.redoStack.length });
    undoManager.on("stack-item-added", refreshStacks);
    undoManager.on("stack-item-popped", refreshStacks);
    undoManager.on("stack-item-updated", refreshStacks);
    undoRef.current = undoManager;
    refreshStacks();
    return () => {
      if (undoRef.current === undoManager) undoRef.current = null;
      undoManager.destroy();
    };
  }, [doc]);

  // ---- Auto-snapshot (every 60s when the board changed) ----
  useEffect(() => {
    if (!canEdit || !doc) return;
    lastSavedRef.current = encodeDocToBase64(doc);
    const timer = setInterval(() => {
      const data = encodeDocToBase64(doc);
      if (data === lastSavedRef.current) return;
      lastSavedRef.current = data;
      void api(`/rooms/${roomId}/snapshots`, {
        method: "POST",
        body: JSON.stringify({ data, label: "Auto-saved" }),
      }).catch(() => undefined); // best-effort; manual save surfaces errors
    }, 60_000);
    return () => clearInterval(timer);
  }, [canEdit, doc, roomId]);

  // ---- Export ----
  const exportAs = useCallback(
    async (format: "png" | "pdf") => {
      const stage = stageRef.current;
      if (!stage) return;
      setSelectedId(null);
      setExporting(true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      try {
        const dataUrl = stage.toDataURL({ pixelRatio: 2 });
        if (format === "png") {
          const link = document.createElement("a");
          link.href = dataUrl;
          link.download = exportFileName(roomName, "png");
          link.click();
        } else {
          const { jsPDF } = await import("jspdf");
          const image = new Image();
          image.src = dataUrl;
          await image.decode();
          const width = image.width / 2;
          const height = image.height / 2;
          const pdf = new jsPDF({ orientation: width >= height ? "landscape" : "portrait", unit: "px", format: [width, height] });
          pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
          pdf.save(exportFileName(roomName, "pdf"));
        }
      } finally {
        setExporting(false);
      }
    },
    [roomName],
  );

  // ---- E2E hook ----
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__boardElements = elements.length;
    return () => {
      delete (window as unknown as Record<string, unknown>).__boardElements;
    };
  }, [elements]);

  const copyInvite = useCallback(async () => {
    const link = inviteCode
      ? `${env.appUrl}/rooms/${roomId}?code=${inviteCode}`
      : `${env.appUrl}/rooms/${roomId}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [inviteCode, roomId]);

  const editingUsers = [...presence.values()].filter((u) => u.isEditing);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between border-b bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="max-w-[16rem] truncate font-semibold">{roomName}</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{role}</span>
          <span
            className={`flex items-center gap-1 text-xs ${connected ? "text-emerald-600" : "text-amber-600"}`}
            data-testid="connection-status"
          >
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {connected ? "Live" : "Connecting…"}
          </span>
          {editingUsers.length > 0 ? (
            <span className="text-xs text-slate-500">
              {editingUsers.map((u) => u.name).join(", ")} {editingUsers.length === 1 ? "is" : "are"} editing…
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <PresenceAvatars users={[...presence.values()]} selfName={user.name} selfColor={selfColor} />
          <Button size="sm" variant="ghost" onClick={copyInvite} title="Copy invite link">
            <Link2 className="h-4 w-4" aria-hidden />
            {copied ? "Copied!" : "Invite"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setAiOpen((v) => !v)} data-testid="toggle-ai">
            <Sparkles className="h-4 w-4 text-blue-500" aria-hidden /> AI
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setHistoryOpen((v) => !v)}>
            <History className="h-4 w-4" aria-hidden /> History
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <ErrorBoundary>
          {connectionError ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80">
              <p className="rounded-lg border bg-white px-4 py-3 text-sm text-red-700 shadow">{connectionError}</p>
            </div>
          ) : (
            <CanvasStage
              elements={elements}
              canEdit={canEdit}
              tool={tool}
              color={color}
              camera={camera}
              onCameraChange={setCamera}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCreate={(element) => addElements([element])}
              onUpdate={updateElement}
              onDelete={deleteElement}
              onCursorMove={onCursorMove}
              onEditingChange={setEditingId}
              editingId={editingId}
              stageRef={stageRef}
              userId={user.id}
            />
          )}
        </ErrorBoundary>

        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
          <Toolbar
            tool={tool}
            onToolChange={setTool}
            color={color}
            onColorChange={setColor}
            canEdit={canEdit}
            onUndo={() => undoRef.current?.undo()}
            onRedo={() => undoRef.current?.redo()}
            canUndo={stacks.undo > 0}
            canRedo={stacks.redo > 0}
            onExportPng={() => void exportAs("png")}
            onExportPdf={() => void exportAs("pdf")}
            exporting={exporting}
          />
        </div>

        {aiOpen ? (
          <AiPanel
            roomId={roomId}
            doc={doc}
            canEdit={canEdit}
            userId={user.id}
            onElementsCreated={(created) => {
              addElements(created);
              setAiOpen(false);
            }}
            onToolChange={setTool}
            onClose={() => setAiOpen(false)}
          />
        ) : null}

        {historyOpen ? (
          <HistoryPanel roomId={roomId} doc={doc} canEdit={canEdit} onClose={() => setHistoryOpen(false)} />
        ) : null}

        <PresenceCursors users={[...presence.values()]} camera={camera} />
      </div>
    </div>
  );
}

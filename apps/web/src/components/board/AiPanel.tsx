"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import * as Y from "yjs";
import type { AiResult } from "@collabcanvas/shared";
import { encodeDocToBase64 } from "@collabcanvas/yjs-utils";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { BoardElement } from "@collabcanvas/shared";
import type { Tool } from "./types";
import { STICKY_COLORS } from "./types";

const DIAGRAM_SHAPES_PALETTE = ["#e0e7ff", "#dcfce7", "#fef9c3", "#ffe4e6"];

/** Convert AI-generated shape specs into board elements (client-side, sanitized by API contract). */
export function shapesToElements(
  shapes: { type: string; x: number; y: number; width?: number; height?: number; label?: string }[],
  userId: string,
  startZ: number,
): BoardElement[] {
  return shapes.map((shape, index) => {
    const base = {
      id: crypto.randomUUID(),
      createdBy: userId,
      createdAt: Date.now(),
      z: startZ + index,
    };
    const label = (shape.label ?? "").slice(0, 500);
    switch (shape.type) {
      case "rect":
        return { ...base, type: "rect" as const, x: shape.x, y: shape.y, width: shape.width ?? 180, height: shape.height ?? 90, fill: DIAGRAM_SHAPES_PALETTE[index % 4] ?? "#e0e7ff" };
      case "ellipse":
        return { ...base, type: "ellipse" as const, x: shape.x, y: shape.y, radiusX: (shape.width ?? 180) / 2, radiusY: (shape.height ?? 90) / 2, fill: DIAGRAM_SHAPES_PALETTE[(index + 1) % 4] ?? "#dcfce7" };
      case "text":
        return { ...base, type: "text" as const, x: shape.x, y: shape.y, text: label, fontSize: 16, color: "#0f172a" };
      case "arrow":
        return { ...base, type: "arrow" as const, from: { x: shape.x, y: shape.y }, to: { x: shape.x + (shape.width ?? 60), y: shape.y + (shape.height ?? 0) }, color: "#64748b" };
      default:
        return { ...base, type: "sticky" as const, x: shape.x, y: shape.y, width: shape.width ?? 180, height: shape.height ?? 140, text: label, color: STICKY_COLORS[index % STICKY_COLORS.length] ?? "#fde047" };
    }
  });
}

interface AiPanelProps {
  roomId: string;
  doc: Y.Doc | null;
  canEdit: boolean;
  userId: string;
  onElementsCreated: (elements: BoardElement[]) => void;
  onToolChange: (tool: Tool) => void;
  onClose: () => void;
}

type AiView =
  | { kind: "summary"; summary: string; keyPoints: string[] }
  | { kind: "ideas"; ideas: string[] }
  | null;

export function AiPanel({ roomId, doc, canEdit, userId, onElementsCreated, onToolChange, onClose }: AiPanelProps) {
  const [view, setView] = useState<AiView>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "summarize" | "suggest" | "diagram") {
    if (!doc) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<AiResult>(`/rooms/${roomId}/ai`, {
        method: "POST",
        body: JSON.stringify({
          action,
          prompt: action === "diagram" ? prompt : undefined,
          boardBase64: encodeDocToBase64(doc),
        }),
      });
      if (action === "diagram" && "shapes" in result) {
        const elements = shapesToElements(result.shapes, userId, 1_000_000);
        onElementsCreated(elements);
        setView(null);
        onToolChange("select");
      } else if ("summary" in result) {
        setView({ kind: "summary", summary: result.summary, keyPoints: result.keyPoints });
      } else if ("ideas" in result) {
        setView({ kind: "ideas", ideas: result.ideas });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) setError("AI limit reached (5 actions/hour). Try again later.");
        else if (err.status === 503) setError("AI is unavailable right now. The board keeps working without it.");
        else if (err.status === 403) setError("Only editors can use AI actions.");
        else setError("AI request failed.");
      } else {
        setError("AI request failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="absolute right-4 top-4 z-20 w-80 rounded-xl border bg-white p-4 shadow-lg" data-testid="ai-panel">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-blue-500" aria-hidden /> AI assistant
        </h2>
        <button type="button" onClick={onClose} aria-label="Close AI panel" className="text-slate-400 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      {canEdit ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="sm" variant="secondary" onClick={() => run("summarize")} disabled={busy || !doc}>
              Summarize board
            </Button>
            <Button size="sm" variant="secondary" onClick={() => run("suggest")} disabled={busy || !doc}>
              Suggest next steps
            </Button>
          </div>

          <label htmlFor="ai-prompt" className="mt-4 block text-xs font-medium text-slate-600">
            Generate a diagram from text
          </label>
          <textarea
            id="ai-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. signup, login, dashboard, settings"
            rows={2}
            maxLength={2000}
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-blue-500"
          />
          <Button size="sm" className="mt-2 w-full" onClick={() => run("diagram")} disabled={busy || !prompt.trim() || !doc}>
            {busy ? "Thinking…" : "Generate diagram"}
          </Button>
        </>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Viewers cannot use AI actions.</p>
      )}

      {view?.kind === "summary" ? (
        <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm" data-testid="ai-result">
          <p className="whitespace-pre-wrap">{view.summary}</p>
          {view.keyPoints.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {view.keyPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {view?.kind === "ideas" ? (
        <ul className="mt-4 list-decimal space-y-1 rounded-lg bg-blue-50 p-3 pl-7 text-sm" data-testid="ai-result">
          {view.ideas.map((idea, i) => (
            <li key={i}>{idea}</li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

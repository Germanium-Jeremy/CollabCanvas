"use client";

import { Download, FileText, MousePointer2, Pen, Redo2, Square, Circle, StickyNote, Trash2, Type, Undo2, MoveUpRight } from "lucide-react";
import type { Tool } from "./types";
import { STICKY_COLORS, TOOL_ORDER } from "./types";

const TOOL_META: Record<Tool, { label: string; icon: React.ReactNode }> = {
  select: { label: "Select (V)", icon: <MousePointer2 className="h-4 w-4" /> },
  pen: { label: "Pen (P)", icon: <Pen className="h-4 w-4" /> },
  rect: { label: "Rectangle (R)", icon: <Square className="h-4 w-4" /> },
  ellipse: { label: "Ellipse (O)", icon: <Circle className="h-4 w-4" /> },
  text: { label: "Text (T)", icon: <Type className="h-4 w-4" /> },
  sticky: { label: "Sticky note (S)", icon: <StickyNote className="h-4 w-4" /> },
  arrow: { label: "Arrow (A)", icon: <MoveUpRight className="h-4 w-4" /> },
  eraser: { label: "Eraser (E)", icon: <Trash2 className="h-4 w-4" /> },
};

interface ToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  color: string;
  onColorChange: (color: string) => void;
  canEdit: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onExportPng: () => void;
  onExportPdf: () => void;
  exporting: boolean;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-lg border bg-white p-1 shadow-md"
      role="toolbar"
      aria-label="Canvas tools"
      data-testid="toolbar"
    >
      {TOOL_ORDER.map((tool) => (
        <button
          key={tool}
          type="button"
          title={TOOL_META[tool].label}
          aria-label={TOOL_META[tool].label}
          aria-pressed={props.tool === tool}
          disabled={!props.canEdit}
          onClick={() => props.onToolChange(tool)}
          className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
            props.tool === tool ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          {TOOL_META[tool].icon}
        </button>
      ))}

      <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden />

      <div className="flex items-center gap-1 px-1">
        {STICKY_COLORS.slice(0, 5).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            aria-pressed={props.color === c}
            disabled={!props.canEdit}
            onClick={() => props.onColorChange(c)}
            className={`h-5 w-5 rounded-full border ${props.color === c ? "ring-2 ring-blue-500" : ""}`}
            style={{ backgroundColor: c }}
          />
        ))}
        <input
          type="color"
          aria-label="Custom color"
          value={props.color}
          disabled={!props.canEdit}
          onChange={(e) => props.onColorChange(e.target.value)}
          className="ml-1 h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
        />
      </div>

      <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden />

      <button
        type="button"
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        disabled={!props.canUndo}
        onClick={props.onUndo}
        className="flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-40"
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
        disabled={!props.canRedo}
        onClick={props.onRedo}
        className="flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-40"
      >
        <Redo2 className="h-4 w-4" />
      </button>

      <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden />

      <button
        type="button"
        title="Export as PNG"
        onClick={props.onExportPng}
        className="flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
      >
        <Download className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Export as PDF"
        onClick={props.onExportPdf}
        className="flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
      >
        <FileText className="h-4 w-4" />
      </button>
      <span className="sr-only" aria-live="polite">
        {props.exporting ? "Exporting" : ""}
      </span>
    </div>
  );
}

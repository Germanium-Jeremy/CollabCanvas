import type { BoardElement } from "@collabcanvas/shared";

export type Tool = "select" | "pen" | "rect" | "ellipse" | "text" | "sticky" | "arrow" | "eraser";

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

/** Omit that distributes over the BoardElement union (plain Omit collapses unions). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A board element without identity/metadata fields — used when creating new elements. */
export type ElementDraft = DistributiveOmit<BoardElement, "id" | "createdBy" | "createdAt" | "z">;

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, scale: 1 };

export const TOOL_ORDER: Tool[] = ["select", "pen", "rect", "ellipse", "text", "sticky", "arrow", "eraser"];

export const STICKY_COLORS = ["#fde047", "#fca5a5", "#86efac", "#93c5fd", "#d8b4fe", "#fdba74"] as const;

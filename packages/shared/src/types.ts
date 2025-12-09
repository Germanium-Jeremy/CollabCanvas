export type RoomRole = "OWNER" | "EDITOR" | "VIEWER";

export interface JwtPayload {
  sub: string;
  email: string;
  name?: string;
}

// ---- Board elements (shared contract between canvas, realtime and AI) ----

export type ElementType = "path" | "rect" | "ellipse" | "text" | "sticky" | "arrow";

export interface BoardElementBase {
  id: string;
  type: ElementType;
  createdBy: string;
  createdAt: number;
  /** Render order; higher renders on top. */
  z: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PathElement extends BoardElementBase {
  type: "path";
  /** Absolute points of the freehand stroke. */
  points: Point[];
  color: string;
  strokeWidth: number;
}

export interface RectElement extends BoardElementBase {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

export interface EllipseElement extends BoardElementBase {
  type: "ellipse";
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  fill: string;
}

export interface TextElement extends BoardElementBase {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
}

export interface StickyNoteElement extends BoardElementBase {
  type: "sticky";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
}

export interface ArrowElement extends BoardElementBase {
  type: "arrow";
  from: Point;
  to: Point;
  color: string;
}

export type BoardElement =
  | PathElement
  | RectElement
  | EllipseElement
  | TextElement
  | StickyNoteElement
  | ArrowElement;

// ---- Presence (awareness) ----

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
  cursor?: Point;
  isEditing: boolean;
}

// ---- AI contracts ----

export type AiAction = "summarize" | "suggest" | "diagram";

export interface AiSummarizeResult {
  summary: string;
  keyPoints: string[];
}

export interface AiSuggestResult {
  ideas: string[];
}

/** A single shape the AI wants to place on the board (diagram generation). */
export interface AiDiagramShape {
  type: "rect" | "ellipse" | "sticky" | "text" | "arrow";
  x: number;
  y: number;
  width?: number;
  height?: number;
  label?: string;
}

export interface AiDiagramResult {
  shapes: AiDiagramShape[];
}

export type AiResult = AiSummarizeResult | AiSuggestResult | AiDiagramResult;

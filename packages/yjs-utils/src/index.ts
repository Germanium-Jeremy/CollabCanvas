import * as Y from "yjs";
import { boardElementSchema } from "@collabcanvas/shared";
import type { BoardElement } from "@collabcanvas/shared";

/** The single Yjs top-level map holding all board elements, keyed by element id. */
export const ELEMENTS_MAP_KEY = "elements";

// ---- Isomorphic base64 (works in Node and the browser) ----

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(base64, "base64"));
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- Serialization ----

export function encodeDocToBase64(doc: Y.Doc): string {
  return bytesToBase64(Y.encodeStateAsUpdate(doc));
}

/** Parse a stored Yjs update into validated board elements, sorted by render order. */
export function elementsFromBase64(base64: string): BoardElement[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, base64ToBytes(base64));
    const map = doc.getMap<unknown>(ELEMENTS_MAP_KEY);
    const elements: BoardElement[] = [];
    for (const value of map.values()) {
      const parsed = boardElementSchema.safeParse(value);
      if (parsed.success) elements.push(parsed.data);
    }
    return elements.sort((a, b) => a.z - b.z);
  } finally {
    doc.destroy();
  }
}

// ---- Snapshot restore ----

/**
 * Build a single update that, applied to `liveDoc`, replaces the current board
 * content with the snapshot content. Computed on a throwaway clone so the live
 * document is untouched; the client applies the returned update (origin "restore")
 * and it propagates to all peers through the normal sync path.
 */
export function buildRestoreUpdate(liveDoc: Y.Doc, snapshotBase64: string): Uint8Array {
  const clone = new Y.Doc();
  try {
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(liveDoc));

    const snapshotDoc = new Y.Doc();
    try {
      Y.applyUpdate(snapshotDoc, base64ToBytes(snapshotBase64));

      const target = clone.getMap<unknown>(ELEMENTS_MAP_KEY);
      const source = snapshotDoc.getMap<unknown>(ELEMENTS_MAP_KEY);
      clone.transact(() => {
        for (const key of Array.from(target.keys())) target.delete(key);
        for (const [key, value] of Array.from(source.entries())) target.set(key, value);
      });
    } finally {
      snapshotDoc.destroy();
    }

    return Y.encodeStateAsUpdate(clone, Y.encodeStateVector(liveDoc));
  } finally {
    clone.destroy();
  }
}

// ---- AI context ----

export interface BoardContext {
  elementCount: number;
  countsByType: Record<string, number>;
  /** Sanitized text snippets from stickies and text elements (truncated). */
  texts: string[];
}

/** Compact textual description of a board, used as context for AI prompts. */
export function boardContextFromBase64(base64: string): BoardContext {
  const elements = elementsFromBase64(base64);
  const countsByType: Record<string, number> = {};
  const texts: string[] = [];
  for (const el of elements) {
    countsByType[el.type] = (countsByType[el.type] ?? 0) + 1;
    if ((el.type === "sticky" || el.type === "text") && "text" in el && el.text.trim()) {
      texts.push(el.text.trim().slice(0, 200));
    }
  }
  return { elementCount: elements.length, countsByType, texts: texts.slice(0, 100) };
}

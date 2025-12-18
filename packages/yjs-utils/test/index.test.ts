import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { RectElement, StickyNoteElement } from "@collabcanvas/shared";
import {
  base64ToBytes,
  boardContextFromBase64,
  buildRestoreUpdate,
  bytesToBase64,
  encodeDocToBase64,
  elementsFromBase64,
} from "../src";

const rect: RectElement = {
  id: "r1",
  type: "rect",
  createdBy: "u1",
  createdAt: 1,
  z: 0,
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  fill: "#3b82f6",
};

const sticky: StickyNoteElement = {
  id: "s1",
  type: "sticky",
  createdBy: "u1",
  createdAt: 2,
  z: 1,
  x: 0,
  y: 0,
  width: 120,
  height: 120,
  text: "login flow idea",
  color: "#facc15",
};

function docWith(...elements: unknown[]): Y.Doc {
  const doc = new Y.Doc();
  const map = doc.getMap("elements");
  doc.transact(() => {
    for (const el of elements) map.set((el as { id: string }).id, el);
  });
  return doc;
}

describe("serialization round-trip", () => {
  it("round-trips elements through base64 Yjs updates", () => {
    const doc = docWith(rect, sticky);
    const base64 = encodeDocToBase64(doc);
    const parsed = elementsFromBase64(base64);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((e) => e.id)).toEqual(["r1", "s1"]);
    expect(parsed[1]).toMatchObject({ type: "sticky", text: "login flow idea" });
    doc.destroy();
  });

  it("sorts by z order", () => {
    const doc = docWith({ ...rect, z: 5 }, { ...sticky, z: 2 });
    const parsed = elementsFromBase64(encodeDocToBase64(doc));
    expect(parsed.map((e) => e.id)).toEqual(["s1", "r1"]);
    doc.destroy();
  });

  it("drops elements that fail schema validation", () => {
    const doc = docWith(rect, { id: "bad", type: "bomb", createdBy: "u1", createdAt: 1, z: 3 });
    const parsed = elementsFromBase64(encodeDocToBase64(doc));
    expect(parsed).toHaveLength(1);
    doc.destroy();
  });
});

describe("buildRestoreUpdate", () => {
  it("replaces current content with snapshot content in one update", () => {
    const live = docWith(rect);
    const snapshot = docWith(sticky);
    const snapshotBase64 = encodeDocToBase64(snapshot);

    const update = buildRestoreUpdate(live, snapshotBase64);

    const target = new Y.Doc();
    Y.applyUpdate(target, Y.encodeStateAsUpdate(live));
    Y.applyUpdate(target, update);

    const map = target.getMap("elements");
    expect(map.has("r1")).toBe(false); // current content removed
    expect(map.has("s1")).toBe(true); // snapshot content restored
    live.destroy();
    snapshot.destroy();
    target.destroy();
  });

  it("is idempotent when snapshot equals current state", () => {
    const live = docWith(rect);
    const update = buildRestoreUpdate(live, encodeDocToBase64(live));
    const target = new Y.Doc();
    Y.applyUpdate(target, Y.encodeStateAsUpdate(live));
    Y.applyUpdate(target, update);
    expect(target.getMap("elements").size).toBe(1);
    live.destroy();
    target.destroy();
  });
});

describe("boardContextFromBase64", () => {
  it("summarizes counts and text snippets for AI prompts", () => {
    const doc = docWith(rect, sticky);
    const ctx = boardContextFromBase64(encodeDocToBase64(doc));
    expect(ctx.elementCount).toBe(2);
    expect(ctx.countsByType).toEqual({ rect: 1, sticky: 1 });
    expect(ctx.texts).toEqual(["login flow idea"]);
    doc.destroy();
  });
});

describe("base64 helpers", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

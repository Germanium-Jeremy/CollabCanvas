import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  decodeClientMessage,
  encodeAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeSyncUpdate,
} from "../src/protocol";

describe("protocol helpers", () => {
  it("round-trips a sync update message", () => {
    const update = new Uint8Array([1, 2, 3, 4, 250]);
    const decoded = decodeClientMessage(encodeSyncUpdate(update));
    expect(decoded.kind).toBe("sync-update");
    if (decoded.kind === "sync-update") expect(decoded.update).toEqual(update);
  });

  it("round-trips awareness messages", () => {
    const update = new Uint8Array([9, 9, 9]);
    const decoded = decodeClientMessage(encodeAwareness(update));
    expect(decoded.kind).toBe("awareness");
    if (decoded.kind === "awareness") expect(decoded.update).toEqual(update);
  });

  it("decodes sync-step1 from a client and replies with a valid diff", () => {
    const doc = new Y.Doc();
    doc.getMap("elements").set("a", { id: "a", type: "rect" });

    // A freshly-connecting client has an empty state vector.
    const clientDoc = new Y.Doc();
    const step1 = decodeClientMessage(encodeSyncStep1(clientDoc));
    expect(step1.kind).toBe("sync-step1");

    if (step1.kind === "sync-step1") {
      const reply = decodeClientMessage(encodeSyncStep2(doc, step1.stateVector));
      expect(reply.kind).toBe("sync-update");
      if (reply.kind === "sync-update") {
        const target = new Y.Doc();
        Y.applyUpdate(target, reply.update);
        expect(target.getMap("elements").has("a")).toBe(true);
      }
    }
    doc.destroy();
    clientDoc.destroy();
  });

  it("returns unknown for garbage input instead of throwing", () => {
    expect(decodeClientMessage(new Uint8Array([255, 255, 255])).kind).toBe("unknown");
    expect(decodeClientMessage(new Uint8Array([])).kind).toBe("unknown");
  });
});

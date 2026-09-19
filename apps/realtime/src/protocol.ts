import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as Y from "yjs";

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

export type ClientMessage =
  | { kind: "sync-step1"; stateVector: Uint8Array }
  | { kind: "sync-update"; update: Uint8Array }
  | { kind: "awareness"; update: Uint8Array }
  | { kind: "unknown" };

/** Build a sync update message (syncStep2-shaped payload) to broadcast a document diff. */
export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, SYNC_STEP2);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** Build the initial SyncStep1 (our state vector) so clients can reply with their diff. */
export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, SYNC_STEP1);
  encoding.writeVarUint8Array(encoder, Y.encodeStateVector(doc));
  return encoding.toUint8Array(encoder);
}

/** Build the reply to a client's SyncStep1: the document diff for their state vector. */
export function encodeSyncStep2(doc: Y.Doc, stateVector: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, SYNC_STEP2);
  encoding.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(doc, stateVector));
  return encoding.toUint8Array(encoder);
}

export function encodeAwareness(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS); // sub-type mirrors y-websocket convention
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function decodeClientMessage(data: Uint8Array): ClientMessage {
  try {
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);
    if (messageType === MESSAGE_AWARENESS) {
      decoding.readVarUint(decoder); // sub-type (unused)
      return { kind: "awareness", update: decoding.readVarUint8Array(decoder) };
    }
    if (messageType === MESSAGE_SYNC) {
      const syncType = decoding.readVarUint(decoder);
      if (syncType === SYNC_STEP1) {
        return { kind: "sync-step1", stateVector: decoding.readVarUint8Array(decoder) };
      }
      if (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE) {
        return { kind: "sync-update", update: decoding.readVarUint8Array(decoder) };
      }
    }
    return { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

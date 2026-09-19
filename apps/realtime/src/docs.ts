import type { PrismaClient } from "@prisma/client";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import type { WebSocket } from "ws";
import { encodeDocToBase64 } from "@collabcanvas/yjs-utils";
import { encodeAwareness, encodeSyncUpdate } from "./protocol";

const FLUSH_INTERVAL_MS = 10_000;

interface RoomState {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Set<WebSocket>;
  dirty: boolean;
  destroyTimer: NodeJS.Timeout | null;
}

/**
 * Owns the in-memory Yjs documents and their connections, and persists
 * changed boards to Postgres every FLUSH_INTERVAL_MS (and on shutdown).
 */
export class DocManager {
  private rooms = new Map<string, RoomState>();

  constructor(private readonly prisma: Pick<PrismaClient, "room">) {}

  async getOrCreate(roomId: string): Promise<RoomState> {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);

    const state: RoomState = { doc, awareness, conns: new Set(), dirty: false, destroyTimer: null };
    this.rooms.set(roomId, state);

    // Load the last persisted board state, if any.
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, select: { boardData: true } });
    if (room?.boardData) {
      Y.applyUpdate(doc, Buffer.from(room.boardData, "base64"));
    }

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      state.dirty = true;
      if (origin !== "persistence") {
        this.broadcast(roomId, encodeSyncUpdate(update));
      }
    });

    awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changedClients = added.concat(updated, removed);
        if (changedClients.length === 0) return;
        const update = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
        // The origin is the connection that sent the change; skip echoing to it.
        const except = origin instanceof Object && "readyState" in origin ? (origin as WebSocket) : undefined;
        this.broadcast(roomId, encodeAwareness(update), except);
      },
    );

    return state;
  }

  join(roomId: string, conn: WebSocket): void {
    const state = this.rooms.get(roomId);
    if (!state) return;
    state.conns.add(conn);
    if (state.destroyTimer) {
      clearTimeout(state.destroyTimer);
      state.destroyTimer = null;
    }
  }

  leave(roomId: string, conn: WebSocket): void {
    const state = this.rooms.get(roomId);
    if (!state) return;
    state.conns.delete(conn);
    if (state.conns.size === 0) {
      // Give reconnections a grace period before tearing down the doc.
      state.destroyTimer = setTimeout(() => {
        void this.destroyRoom(roomId);
      }, 30_000);
    }
  }

  broadcast(roomId: string, message: Uint8Array, except?: WebSocket): void {
    const state = this.rooms.get(roomId);
    if (!state) return;
    for (const conn of state.conns) {
      if (conn !== except && conn.readyState === conn.OPEN) {
        conn.send(message, { binary: true });
      }
    }
  }

  /** Apply a local (server-trusted) update, e.g. loaded persistence. */
  applyLocalUpdate(roomId: string, update: Uint8Array): void {
    const state = this.rooms.get(roomId);
    if (state) Y.applyUpdate(state.doc, update, "persistence");
  }

  /** Apply a client awareness update (cursors/presence). Allowed for all roles. */
  applyAwareness(roomId: string, update: Uint8Array, origin: unknown): void {
    const state = this.rooms.get(roomId);
    if (!state) return;
    awarenessProtocol.applyAwarenessUpdate(state.awareness, update, origin);
  }

  getDoc(roomId: string): Y.Doc | undefined {
    return this.rooms.get(roomId)?.doc;
  }

  async flushDirty(): Promise<void> {
    for (const [roomId, state] of this.rooms) {
      if (!state.dirty) continue;
      state.dirty = false;
      const data = encodeDocToBase64(state.doc);
      try {
        await this.prisma.room.update({ where: { id: roomId }, data: { boardData: data } });
      } catch (error) {
        state.dirty = true; // retry next tick
        console.error(`[realtime] failed to persist room ${roomId}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  async destroyRoom(roomId: string): Promise<void> {
    const state = this.rooms.get(roomId);
    if (!state) return;
    this.rooms.delete(roomId);
    clearTimeout(state.destroyTimer ?? undefined);
    if (state.dirty) {
      try {
        await this.prisma.room.update({
          where: { id: roomId },
          data: { boardData: encodeDocToBase64(state.doc) },
        });
      } catch (error) {
        console.error(`[realtime] failed to persist room ${roomId} on destroy:`, error instanceof Error ? error.message : error);
      }
    }
    state.awareness.destroy();
    state.doc.destroy();
  }

  startFlushLoop(): NodeJS.Timeout {
    const timer = setInterval(() => {
      void this.flushDirty();
    }, FLUSH_INTERVAL_MS);
    timer.unref?.();
    return timer;
  }

  async flushAndStop(): Promise<void> {
    for (const roomId of this.rooms.keys()) {
      const state = this.rooms.get(roomId);
      if (state) state.dirty = true;
    }
    await this.flushDirty();
  }
}

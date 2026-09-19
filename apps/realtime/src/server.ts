import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { PrismaClient } from "@prisma/client";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { AccessService } from "./access";
import { DocManager } from "./docs";
import { loadEnv } from "./env";
import { decodeClientMessage, encodeAwareness, encodeSyncStep1, encodeSyncStep2 } from "./protocol";

const AUTH_CLOSE_CODE = 4401;
const NO_ACCESS_CLOSE_CODE = 4403;

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = new PrismaClient();
  await prisma.$connect();

  const access = new AccessService(env.jwtSecret, prisma);
  const docs = new DocManager(prisma);
  const flushTimer = docs.startFlushLoop();

  const server = http.createServer((_req, res) => {
    // Health endpoint for orchestrators.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket, request: { url?: string }) => {
    handleConnection(ws, request).catch((error) => {
      console.error("[realtime] connection error:", error);
      ws.close();
    });
  });

  async function handleConnection(ws: WebSocket, request: { url?: string }): Promise<void> {
    // URL format: /<roomId>/<token> — works with the standard y-websocket client.
    const parts = (request.url ?? "").split("?")[0]?.split("/").filter(Boolean) ?? [];
    const roomId = parts[0];
    const token = parts[1];
    if (!roomId || !token) {
      ws.close(AUTH_CLOSE_CODE, "invalid url");
      return;
    }

    const payload = access.verifyToken(token);
    if (!payload) {
      ws.close(AUTH_CLOSE_CODE, "unauthorized");
      return;
    }

    const role = await access.resolveRole(roomId, payload.sub);
    if (!role) {
      ws.close(NO_ACCESS_CLOSE_CODE, "no access");
      return;
    }

    const state = await docs.getOrCreate(roomId);
    docs.join(roomId, ws);

    ws.on("message", (data: unknown) => {
      if (!(data instanceof Uint8Array)) return;
      handleMessage(roomId, role, data, ws);
    });
    ws.on("close", () => docs.leave(roomId, ws));
    ws.on("error", () => docs.leave(roomId, ws));

    // Initial sync: send our state vector (client replies with its diff)
    // plus the current awareness state so late joiners see existing cursors.
    ws.send(encodeSyncStep1(state.doc), { binary: true });
    const awarenessClientIds = Array.from(state.awareness.getStates().keys());
    if (awarenessClientIds.length > 0) {
      const update = awarenessProtocol.encodeAwarenessUpdate(state.awareness, awarenessClientIds);
      ws.send(encodeAwareness(update), { binary: true });
    }

    // Keepalive: dead sockets are reaped by the ping/pong cycle.
    const ping = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
      else clearInterval(ping);
    }, 30_000);
    ws.on("close", () => clearInterval(ping));
  }

  function handleMessage(roomId: string, role: string, data: Uint8Array, ws: WebSocket): void {
    const doc = docs.getDoc(roomId);
    if (!doc) return;
    const message = decodeClientMessage(data);

    switch (message.kind) {
      case "sync-step1": {
        ws.send(encodeSyncStep2(doc, message.stateVector), { binary: true });
        break;
      }
      case "sync-update": {
        // Role enforcement: VIEWER connections may not write document state.
        if (role === "VIEWER") return;
        Y.applyUpdate(doc, message.update, `room:${roomId}`);
        break;
      }
      case "awareness": {
        docs.applyAwareness(roomId, message.update, ws);
        break;
      }
      default:
        // Unknown/malformed messages are dropped.
        break;
    }
  }

  const shutdown = async (): Promise<void> => {
    clearInterval(flushTimer);
    await docs.flushAndStop();
    await prisma.$disconnect();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  server.listen(env.port, () => {
    console.log(`Realtime server listening on ws://localhost:${env.port}`);
  });
}

void main();

// Temp E2E verification: acts as a y-websocket client against the realtime server.
// Asserts (1) awareness updates are echoed back (the client liveness contract)
// and (2) the socket stays open past the 30s client watchdog. Cleans up after.
const { WebSocket } = require("ws");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const Y = require("yjs");
const awarenessProtocol = require("y-protocols/awareness");
const encoding = require("lib0/encoding");
const decoding = require("lib0/decoding");
const syncProtocol = require("y-protocols/sync");

const prisma = new PrismaClient();
const EMAIL = "realtime-verify-temp@example.com";

// Force-exit so a stuck socket/DB can never hang the harness.
setTimeout(() => {
  console.error("HARD TIMEOUT after 90s — aborting");
  process.exit(3);
}, 90_000);

function encodeClientAwareness(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1); // messageAwareness
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

async function main() {
  // Fail fast instead of hanging if the DB is locked.
  await prisma.$queryRaw`SET statement_timeout = 8000`;
  await prisma.$queryRaw`SET lock_timeout = 8000`;

  // -- Seed a temp user + public room, sign a token -------------------------
  // Idempotent: remove leftovers from any previous run (room cascades from user).
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({ data: { email: EMAIL, name: "Verify Bot" } });
  const room = await prisma.room.create({
    data: { name: "verify-room", isPublic: true, ownerId: user.id },
  });
  const token = jwt.sign({ sub: user.id, email: EMAIL, name: "Verify Bot" }, process.env.JWT_SECRET, {
    expiresIn: "10m",
  });

  // -- Local awareness, exactly like WebsocketProvider ----------------------
  const localDoc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(localDoc);
  awareness.setLocalState({ user: { userId: user.id, name: "Verify Bot", color: "#f00" } });

  const ws = new WebSocket(`ws://localhost:3002/${room.id}/${token}`);
  ws.binaryType = "arraybuffer";

  let gotSyncStep1 = false;
  let echoedAwareness = 0;
  let closed = null;

  ws.on("error", () => {}); // handled via close/error checks below

  ws.on("close", (code, reason) => {
    closed = { code, reason: reason.toString() };
  });

  ws.on("message", (data) => {
    const bytes = new Uint8Array(data);
    console.log(`<- frame: len=${bytes.length} head=[${Array.from(bytes.slice(0, 6)).join(",")}]`);
    try {
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type === 0) {
        // y-websocket client calls readSyncMessage, which replies to step1 automatically.
        syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), localDoc, null);
        gotSyncStep1 = true;
      } else if (type === 1) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), null);
        echoedAwareness++;
      } else {
        console.log(`<- unexpected frame type ${type}`);
      }
    } catch (e) {
      console.log(`<- frame parse error: ${e.message}`);
    }
  });

  const sendAwareness = () => {
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [localDoc.clientID]);
    const frame = encodeClientAwareness(update);
    console.log(`-> awareness: updateLen=${update.length} frame=[${Array.from(frame.slice(0, 6)).join(",")}]`);
    ws.send(frame, { binary: true });
  };

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for open")), 5000);
    ws.on("open", () => {
      clearTimeout(t);
      // Client handshake: sync step 1 + initial awareness (like the real client).
      const enc = encoding.createEncoder();
      syncProtocol.writeSyncStep1(enc, localDoc);
      ws.send(encoding.toUint8Array(enc), { binary: true });
      sendAwareness();
      resolve();
    });
  });

  // Refresh our own awareness every 15s, exactly like the y-websocket client.
  const refresher = setInterval(sendAwareness, 15_000);

  // -- Assertions -----------------------------------------------------------
  await new Promise((r) => setTimeout(r, 3000));
  if (!gotSyncStep1) throw new Error("FAIL: no sync step1 received from server");
  if (echoedAwareness < 1) throw new Error("FAIL: awareness was not echoed back");
  console.log(`after 3s: syncStep1=${gotSyncStep1} echoes=${echoedAwareness}`);

  await new Promise((r) => setTimeout(r, 33000)); // past the 30s watchdog
  clearInterval(refresher);

  if (closed) throw new Error(`FAIL: socket closed during test: ${JSON.stringify(closed)}`);
  if (echoedAwareness < 3) throw new Error(`FAIL: expected >=3 echoes by 36s, got ${echoedAwareness}`);
  console.log(`after 36s: socket alive=true echoes=${echoedAwareness}`);
  console.log("PASS: awareness echoed and connection survives the 30s watchdog");

  ws.close();
  localDoc.destroy();
  await prisma.room.delete({ where: { id: room.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log("cleanup done");
  process.exit(0);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

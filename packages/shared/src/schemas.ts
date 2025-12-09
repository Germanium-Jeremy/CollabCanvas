import { z } from "zod";
import { MAX_ROOM_NAME_LENGTH, MAX_TEXT_LENGTH } from "./constants";
import type { BoardElement } from "./types";

// ---- Auth ----

export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80),
});

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

// ---- Rooms ----

export const createRoomSchema = z.object({
  name: z.string().min(1).max(MAX_ROOM_NAME_LENGTH),
  isPublic: z.boolean().default(false),
});

export const updateRoomSchema = z.object({
  name: z.string().min(1).max(MAX_ROOM_NAME_LENGTH).optional(),
  isPublic: z.boolean().optional(),
});

export const setMemberRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["OWNER", "EDITOR", "VIEWER"]),
});

export const joinRoomSchema = z.object({
  /** Invite code, required for private rooms. */
  code: z.string().min(1).max(120).optional(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;
export type SetMemberRoleInput = z.infer<typeof setMemberRoleSchema>;
export type ReportInput = z.infer<typeof reportSchema>;

// ---- Board elements (sanitization boundary for realtime + AI writes) ----

const pointSchema = z.object({ x: z.number(), y: z.number() });
const textSchema = z.string().max(MAX_TEXT_LENGTH);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{3,8}$/).max(9);

export const boardElementSchema: z.ZodType<BoardElement> = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal("path"),
    createdBy: z.string().min(1).max(64),
    createdAt: z.number(),
    z: z.number(),
    points: z.array(pointSchema).max(5000),
    color: colorSchema,
    strokeWidth: z.number().min(1).max(64),
  }),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal("rect"),
    createdBy: z.string().min(1).max(64),
    createdAt: z.number(),
    z: z.number(),
    x: z.number(),
    y: z.number(),
    width: z.number().min(1).max(100000),
    height: z.number().min(1).max(100000),
    fill: colorSchema,
  }),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal("ellipse"),
    createdBy: z.string().min(1).max(64),
    createdAt: z.number(),
    z: z.number(),
    x: z.number(),
    y: z.number(),
    radiusX: z.number().min(1).max(100000),
    radiusY: z.number().min(1).max(100000),
    fill: colorSchema,
  }),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal("text"),
    createdBy: z.string().min(1).max(64),
    createdAt: z.number(),
    z: z.number(),
    x: z.number(),
    y: z.number(),
    text: textSchema,
    fontSize: z.number().min(4).max(200),
    color: colorSchema,
  }),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal("sticky"),
    createdBy: z.string().min(1).max(64),
    createdAt: z.number(),
    z: z.number(),
    x: z.number(),
    y: z.number(),
    width: z.number().min(20).max(2000),
    height: z.number().min(20).max(2000),
    text: textSchema,
    color: colorSchema,
  }),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal("arrow"),
    createdBy: z.string().min(1).max(64),
    createdAt: z.number(),
    z: z.number(),
    from: pointSchema,
    to: pointSchema,
    color: colorSchema,
  }),
]);

// ---- AI ----

export const aiRequestSchema = z.object({
  action: z.enum(["summarize", "suggest", "diagram"]),
  prompt: z.string().max(MAX_TEXT_LENGTH).optional(),
  /** Optional fresh board state (base64 Yjs update) sent by the client. */
  boardBase64: z
    .string()
    .max(4_000_000)
    .refine((v) => /^[A-Za-z0-9+/=]*$/.test(v), "must be base64")
    .optional(),
});

export type AiRequestInput = z.infer<typeof aiRequestSchema>;

// ---- Reports / abuse ----

export const reportSchema = z.object({
  reason: z.enum(["spam", "harassment", "other"]),
  details: z.string().max(1000).optional(),
});

// ---- Snapshots ----

export const createSnapshotSchema = z.object({
  label: z.string().max(120).optional(),
  /** Serialized Yjs document state (base64-encoded update). */
  data: z.string().min(1).max(8_000_000),
});

export type CreateSnapshotInput = z.infer<typeof createSnapshotSchema>;

import { describe, expect, it } from "vitest";
import {
  createInvitationSchema,
  joinRoomSchema,
  setInvitationRoleSchema,
  setMemberRoleSchema,
} from "../src/schemas";

describe("joinRoomSchema", () => {
  it("accepts an empty body (public join)", () => {
    expect(joinRoomSchema.parse({})).toEqual({});
  });

  it("accepts an invite code", () => {
    expect(joinRoomSchema.parse({ code: "abc123" })).toEqual({ code: "abc123" });
  });

  it("rejects non-string codes", () => {
    expect(joinRoomSchema.safeParse({ code: 42 }).success).toBe(false);
  });
});

describe("createInvitationSchema", () => {
  it("accepts a valid email with EDITOR", () => {
    expect(createInvitationSchema.parse({ email: "a@b.co", role: "EDITOR" })).toEqual({
      email: "a@b.co",
      role: "EDITOR",
    });
  });

  it("accepts a valid email with VIEWER", () => {
    expect(createInvitationSchema.parse({ email: "a@b.co", role: "VIEWER" }).role).toBe("VIEWER");
  });

  it("rejects an invalid email", () => {
    expect(createInvitationSchema.safeParse({ email: "not-an-email", role: "EDITOR" }).success).toBe(false);
  });

  it("rejects OWNER as an invitation role", () => {
    expect(createInvitationSchema.safeParse({ email: "a@b.co", role: "OWNER" }).success).toBe(false);
  });

  it("rejects a missing role", () => {
    expect(createInvitationSchema.safeParse({ email: "a@b.co" }).success).toBe(false);
  });
});

describe("setInvitationRoleSchema", () => {
  it("accepts EDITOR and VIEWER", () => {
    expect(setInvitationRoleSchema.parse({ role: "EDITOR" })).toEqual({ role: "EDITOR" });
    expect(setInvitationRoleSchema.parse({ role: "VIEWER" })).toEqual({ role: "VIEWER" });
  });

  it("rejects OWNER", () => {
    expect(setInvitationRoleSchema.safeParse({ role: "OWNER" }).success).toBe(false);
  });
});

describe("setMemberRoleSchema", () => {
  it("accepts EDITOR and VIEWER", () => {
    expect(setMemberRoleSchema.parse({ userId: "u1", role: "EDITOR" }).role).toBe("EDITOR");
    expect(setMemberRoleSchema.parse({ userId: "u1", role: "VIEWER" }).role).toBe("VIEWER");
  });

  it("rejects OWNER — ownership is not transferable via role updates", () => {
    expect(setMemberRoleSchema.safeParse({ userId: "u1", role: "OWNER" }).success).toBe(false);
  });
});

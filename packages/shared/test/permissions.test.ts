import { describe, expect, it } from "vitest";
import { canEdit, canManage, canView, effectiveRole } from "../src/permissions";
import type { RoomAccessInfo } from "../src/permissions";

function room(overrides: Partial<RoomAccessInfo> = {}): RoomAccessInfo {
  return {
    isPublic: false,
    deletedAt: null,
    ownerId: "owner-1",
    members: [
      { userId: "editor-1", role: "EDITOR" },
      { userId: "viewer-1", role: "VIEWER" },
      { userId: "owner-1", role: "OWNER" },
    ],
    ...overrides,
  };
}

describe("effectiveRole", () => {
  it("returns explicit membership roles", () => {
    expect(effectiveRole(room(), "editor-1")).toBe("EDITOR");
    expect(effectiveRole(room(), "viewer-1")).toBe("VIEWER");
    expect(effectiveRole(room(), "owner-1")).toBe("OWNER");
  });

  it("owner is implicit even without a membership row", () => {
    const r = room({ members: [] });
    expect(effectiveRole(r, "owner-1")).toBe("OWNER");
  });

  it("public rooms grant VIEWER to authenticated non-members", () => {
    const r = room({ isPublic: true, members: [] });
    expect(effectiveRole(r, "stranger")).toBe("VIEWER");
    expect(effectiveRole(r, null)).toBeNull();
  });

  it("private rooms deny non-members", () => {
    expect(effectiveRole(room(), "stranger")).toBeNull();
    expect(effectiveRole(room(), null)).toBeNull();
  });

  it("deleted rooms deny everyone including the owner", () => {
    const r = room({ deletedAt: new Date() });
    expect(effectiveRole(r, "owner-1")).toBeNull();
    expect(effectiveRole(r, "editor-1")).toBeNull();
  });
});

describe("canView / canEdit / canManage", () => {
  const r = room({ isPublic: true });

  it("everyone with a role can view", () => {
    expect(canView(r, "editor-1")).toBe(true);
    expect(canView(r, "stranger")).toBe(true);
    expect(canView(room(), "stranger")).toBe(false);
    expect(canView(r, null)).toBe(false);
  });

  it("only OWNER and EDITOR can edit", () => {
    expect(canEdit(r, "owner-1")).toBe(true);
    expect(canEdit(r, "editor-1")).toBe(true);
    expect(canEdit(r, "viewer-1")).toBe(false);
    expect(canEdit(r, "stranger")).toBe(false);
  });

  it("only OWNER can manage", () => {
    expect(canManage(r, "owner-1")).toBe(true);
    expect(canManage(r, "editor-1")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { aiRequestSchema, boardElementSchema, loginSchema, registerSchema } from "../src/schemas";

describe("registerSchema", () => {
  it("accepts a valid registration", () => {
    const parsed = registerSchema.safeParse({
      email: "a@b.com",
      password: "longenough",
      name: "Ada",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects short passwords and bad emails", () => {
    expect(registerSchema.safeParse({ email: "a@b.com", password: "short", name: "A" }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "nope", password: "longenough", name: "A" }).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("requires email and password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
  });
});

describe("boardElementSchema", () => {
  const base = { id: "e1", createdBy: "u1", createdAt: 1, z: 0 };

  it("accepts each element kind", () => {
    expect(boardElementSchema.safeParse({ ...base, type: "rect", x: 0, y: 0, width: 10, height: 10, fill: "#fff" }).success).toBe(true);
    expect(boardElementSchema.safeParse({ ...base, type: "sticky", x: 0, y: 0, width: 100, height: 100, text: "hi", color: "#facc15" }).success).toBe(true);
    expect(boardElementSchema.safeParse({ ...base, type: "arrow", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: "#000" }).success).toBe(true);
  });

  it("rejects invalid colors and unknown types", () => {
    expect(boardElementSchema.safeParse({ ...base, type: "rect", x: 0, y: 0, width: 10, height: 10, fill: "javascript:alert(1)" }).success).toBe(false);
    expect(boardElementSchema.safeParse({ ...base, type: "bomb" }).success).toBe(false);
  });

  it("rejects oversized text (XSS/abuse guard)", () => {
    const el = { ...base, type: "sticky", x: 0, y: 0, width: 100, height: 100, text: "x".repeat(3000), color: "#fff" };
    expect(boardElementSchema.safeParse(el).success).toBe(false);
  });
});

describe("aiRequestSchema", () => {
  it("only allows the three supported actions", () => {
    expect(aiRequestSchema.safeParse({ action: "summarize" }).success).toBe(true);
    expect(aiRequestSchema.safeParse({ action: "diagram", prompt: "login flow" }).success).toBe(true);
    expect(aiRequestSchema.safeParse({ action: "deleteEverything" }).success).toBe(false);
  });

  it("caps prompt length", () => {
    expect(aiRequestSchema.safeParse({ action: "diagram", prompt: "p".repeat(3000) }).success).toBe(false);
  });
});

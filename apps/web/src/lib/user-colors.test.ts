import { describe, expect, it } from "vitest";
import { clamp, colorForUser, exportFileName, USER_COLORS } from "./user-colors";

describe("colorForUser", () => {
  it("is deterministic and within the palette", () => {
    for (let i = 0; i < 50; i++) {
      const color = colorForUser(`user-${i}`);
      expect(USER_COLORS).toContain(color);
      expect(colorForUser(`user-${i}`)).toBe(color);
    }
  });
});

describe("clamp", () => {
  it("clamps into range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("exportFileName", () => {
  it("sanitizes room names", () => {
    expect(exportFileName("Sprint Planning!", "png")).toBe("sprint-planning.png");
    expect(exportFileName("///", "pdf")).toBe("board.pdf");
  });
});

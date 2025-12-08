export const USER_COLORS = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#65a30d",
] as const;

/** Deterministically map a user id to one of the presence colors. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return USER_COLORS[hash % USER_COLORS.length] as string;
}

/** Clamp a number into a range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Export filename for a room. */
export function exportFileName(roomName: string, ext: "png" | "pdf"): string {
  const safe = roomName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "board"}.${ext}`;
}

"use client";

import { UserPlus } from "lucide-react";
import type { PresenceUser } from "@collabcanvas/shared";
import type { Camera } from "./types";

interface PresenceLayerProps {
  users: PresenceUser[];
  camera: Camera;
}

/** Renders remote user cursors over the canvas (screen space). */
export function PresenceCursors({ users, camera }: PresenceLayerProps) {
  return (
    <>
      {users.map((user) => {
        if (!user.cursor) return null;
        const left = user.cursor.x * camera.scale + camera.x;
        const top = user.cursor.y * camera.scale + camera.y;
        return (
          <div
            key={user.userId}
            className="pointer-events-none absolute z-10"
            style={{ left, top, transform: "translate(-2px, -2px)" }}
            data-testid={`remote-cursor-${user.userId}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path d="M5 3l14 8-6 1-3 6z" fill={user.color} stroke="#fff" strokeWidth="1.5" />
            </svg>
            <span
              className="ml-3 rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: user.color }}
            >
              {user.name}
            </span>
          </div>
        );
      })}
    </>
  );
}

interface AvatarBarProps {
  users: PresenceUser[];
  selfName: string;
  selfColor: string;
  /** Opens the member roster. */
  onOpenRoster: () => void;
}

/** Maximum avatars shown before the +N overflow chip. */
export const MAX_VISIBLE_AVATARS = 3;

/**
 * Avatar stack: at most MAX_VISIBLE_AVATARS avatars plus a +N overflow chip.
 * The whole stack is a keyboard-operable button that opens the member roster.
 */
export function PresenceAvatars({ users, selfName, selfColor, onOpenRoster }: AvatarBarProps) {
  const all = [{ userId: "self", name: selfName, color: selfColor }, ...users];
  const visible = all.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = all.length - visible.length;

  return (
    <button
      type="button"
      onClick={onOpenRoster}
      title="Show members"
      aria-label={`Show all members (${all.length} in this board)`}
      data-testid="presence-avatars"
      className="flex items-center -space-x-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {visible.map((user, index) => (
        <span
          key={`${user.userId}-${index}`}
          title={user.name}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white"
          style={{ backgroundColor: user.color }}
        >
          {user.name.slice(0, 2).toUpperCase()}
        </span>
      ))}
      {overflow > 0 ? (
        <span
          data-testid="avatar-overflow"
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-400 text-[10px] font-bold text-white"
        >
          +{overflow}
        </span>
      ) : null}
      <UserPlus className="ml-2 h-3.5 w-3.5 text-slate-500" aria-hidden />
    </button>
  );
}

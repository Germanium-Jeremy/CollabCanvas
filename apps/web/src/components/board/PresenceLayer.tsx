"use client";

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
}

/** Avatar stack showing everyone currently in the room. */
export function PresenceAvatars({ users, selfName, selfColor }: AvatarBarProps) {
  const all = [{ userId: "self", name: selfName, color: selfColor }, ...users];
  return (
    <div className="flex items-center -space-x-2" data-testid="presence-avatars">
      {all.slice(0, 6).map((user, index) => (
        <span
          key={`${user.userId}-${index}`}
          title={user.name}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white"
          style={{ backgroundColor: user.color }}
        >
          {user.name.slice(0, 2).toUpperCase()}
        </span>
      ))}
      {all.length > 6 ? (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-400 text-[10px] font-bold text-white">
          +{all.length - 6}
        </span>
      ) : null}
    </div>
  );
}

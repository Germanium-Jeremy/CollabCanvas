"use client";

import { useEffect, useState } from "react";
import type { WebsocketProvider } from "y-websocket";
import type { PresenceUser } from "@collabcanvas/shared";

/**
 * Subscribes to remote awareness states (other users' cursors/presence).
 * Returns a stable map keyed by awareness clientID.
 */
export function usePresence(provider: WebsocketProvider | null): Map<number, PresenceUser> {
  const [states, setStates] = useState<Map<number, PresenceUser>>(new Map());

  useEffect(() => {
    if (!provider) return;
    const awareness = provider.awareness;

    const update = () => {
      const next = new Map<number, PresenceUser>();
      awareness.getStates().forEach((state, clientID) => {
        const user = (state as { user?: PresenceUser }).user;
        if (user && clientID !== awareness.clientID) next.set(clientID, user);
      });
      setStates(next);
    };

    awareness.on("change", update);
    update();
    return () => {
      awareness.off("change", update);
    };
  }, [provider]);

  return states;
}

"use client";

import { useCallback, useEffect, useState } from "react";
import type { RoomRole } from "@collabcanvas/shared";
import { createInvitationSchema } from "@collabcanvas/shared";
import { api, ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MemberRow {
  userId: string;
  role: RoomRole;
  name: string | null;
  email: string | null;
}

interface InvitationRow {
  id: string;
  email: string;
  role: "EDITOR" | "VIEWER";
  status: string;
  code?: string;
}

interface MembersPanelProps {
  roomId: string;
  roomName: string;
  isPublic: boolean;
  role: RoomRole;
  inviteCode: string | null;
  selfId: string;
  onClose: () => void;
}

/**
 * Member roster + share controls. Role changes and invitations are owner-only
 * (enforced here for UX and by the API for security); editors and viewers can
 * inspect the roster read-only.
 */
export function MembersPanel({ roomId, roomName, isPublic, role, inviteCode, selfId, onClose }: MembersPanelProps) {
  const isOwner = role === "OWNER";

  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"EDITOR" | "VIEWER">("VIEWER");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteCodeOut, setInviteCodeOut] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  const refresh = useCallback(async () => {
    setRosterError(null);
    try {
      const memberRows = await api<MemberRow[]>(`/rooms/${roomId}/members`);
      setMembers(memberRows);
      if (isOwner) {
        setInvitations(await api<InvitationRow[]>(`/rooms/${roomId}/invitations`));
      }
    } catch {
      setRosterError("Could not load members.");
    }
  }, [isOwner, roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Escape closes the dialog (keyboard accessibility).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const shareUrl = inviteCode ? `${env.appUrl}/rooms/${roomId}?code=${inviteCode}` : `${env.appUrl}/rooms/${roomId}`;

  async function copy(text: string, kind: "link" | "code") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard can be denied (permissions/insecure context); surface it
      // instead of silently claiming success.
      setInviteError("Clipboard unavailable — select and copy the value manually.");
    }
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    const parsed = createInvitationSchema.safeParse({ email, role: inviteRole });
    if (!parsed.success) {
      setInviteError("Enter a valid email address.");
      return;
    }
    setInviteBusy(true);
    setInviteError(null);
    setInviteCodeOut(null);
    try {
      const created = await api<InvitationRow & { code: string }>(`/rooms/${roomId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email: parsed.data.email, role: parsed.data.role }),
      });
      setInviteCodeOut(`${env.appUrl}/rooms/${roomId}?invite=${encodeURIComponent(created.code)}&email=${encodeURIComponent(parsed.data.email)}`);
      setEmail("");
      await refresh();
    } catch (err) {
      setInviteError(
        err instanceof ApiError && err.body.error === "already_a_member"
          ? "That user is already a member."
          : "Could not create the invitation.",
      );
    } finally {
      setInviteBusy(false);
    }
  }

  async function changeMemberRole(userId: string, next: "EDITOR" | "VIEWER") {
    setRosterError(null);
    try {
      await api(`/rooms/${roomId}/members`, { method: "PATCH", body: JSON.stringify({ userId, role: next }) });
      await refresh();
    } catch {
      setRosterError("Could not update the role.");
    }
  }

  async function removeMember(userId: string) {
    setRosterError(null);
    try {
      await api(`/rooms/${roomId}/members/${userId}`, { method: "DELETE" });
      await refresh();
    } catch {
      setRosterError("Could not remove the member.");
    }
  }

  async function revokeInvitation(invitationId: string) {
    setRosterError(null);
    try {
      await api(`/rooms/${roomId}/invitations/${invitationId}`, { method: "DELETE" });
      await refresh();
    } catch {
      setRosterError("Could not revoke the invitation.");
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center bg-slate-900/30 p-4" role="dialog" aria-modal="true" aria-label={`Members and sharing for ${roomName}`}>
      <div className="mt-12 w-full max-w-lg overflow-hidden rounded-xl border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Members &amp; sharing</h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close members panel">
            ✕
          </Button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-4">
          {rosterError ? (
            <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {rosterError}
            </p>
          ) : null}

          {/* ---- Sharing ---- */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700">
              {isPublic ? "Public board — anyone with the link can view" : "Private board"}
            </h3>
            <div className="mt-2 flex items-center gap-2">
              <Input readOnly value={shareUrl} aria-label="Board link" className="flex-1 text-xs" onFocus={(e) => e.target.select()} />
              <Button size="sm" variant="secondary" onClick={() => void copy(shareUrl, "link")} data-testid="copy-link">
                {copied === "link" ? "Copied!" : "Copy link"}
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {isPublic
                ? "People who open this link join as viewers. You can promote them below."
                : "Recipients join as viewers. Editors must be invited by email or promoted below."}
            </p>
          </section>

          {/* ---- Email invitation (owner-only) ---- */}
          {isOwner ? (
            <section className="rounded-lg border p-3">
              <h3 className="text-sm font-semibold text-slate-700">Invite by email</h3>
              <form onSubmit={sendInvite} className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="teammate@example.com"
                    type="email"
                    aria-label="Recipient email"
                    data-testid="invite-email"
                    className="flex-1"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value === "EDITOR" ? "EDITOR" : "VIEWER")}
                    aria-label="Invite role"
                    data-testid="invite-role"
                    className="rounded-md border border-slate-300 bg-white px-2 text-sm"
                  >
                    <option value="VIEWER">Viewer</option>
                    <option value="EDITOR">Editor</option>
                  </select>
                  <Button type="submit" size="sm" disabled={inviteBusy} data-testid="invite-send">
                    {inviteBusy ? "Inviting…" : "Invite"}
                  </Button>
                </div>
                {inviteError ? (
                  <p role="alert" className="text-xs text-red-700">
                    {inviteError}
                  </p>
                ) : null}
                {inviteCodeOut ? (
                  <div className="rounded border bg-blue-50 p-2 text-xs">
                    <p className="font-medium text-blue-900">Invitation created — send this acceptance link to the recipient:</p>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="flex-1 break-all rounded bg-white px-2 py-1" data-testid="invite-code-out">
                        {inviteCodeOut}
                      </code>
                      <Button size="sm" variant="secondary" type="button" onClick={() => void copy(inviteCodeOut, "code")}>
                        {copied === "code" ? "Copied!" : "Copy link"}
                      </Button>
                    </div>
                    <p className="mt-1 text-blue-800">Opening it lets them “Accept invitation” with the role you chose.</p>
                  </div>
                ) : null}
              </form>

              {invitations.length > 0 ? (
                <ul className="mt-3 space-y-1" data-testid="pending-invitations">
                  {invitations.map((invitation) => (
                    <li key={invitation.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                      <span className="truncate">
                        {invitation.email} · <span className="text-slate-500">{invitation.role.toLowerCase()}</span>
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => void revokeInvitation(invitation.id)}>
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {/* ---- Roster ---- */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700">
              Members {members ? `(${members.length})` : ""}
            </h3>
            {members === null ? (
              <p className="mt-2 text-sm text-slate-500">Loading…</p>
            ) : (
              <ul className="mt-2 space-y-1" data-testid="member-roster">
                {members.map((member) => (
                  <li key={member.userId} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{member.name ?? member.email ?? member.userId}</span>
                      {member.email && member.name ? <span className="block truncate text-xs text-slate-500">{member.email}</span> : null}
                    </span>
                    {isOwner && member.userId !== selfId && member.role !== "OWNER" ? (
                      <span className="flex items-center gap-1">
                        <select
                          value={member.role}
                          onChange={(e) => void changeMemberRole(member.userId, e.target.value === "EDITOR" ? "EDITOR" : "VIEWER")}
                          aria-label={`Role for ${member.name ?? member.email ?? member.userId}`}
                          data-testid={`role-select-${member.userId}`}
                          className="rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs"
                        >
                          <option value="EDITOR">Editor</option>
                          <option value="VIEWER">Viewer</option>
                        </select>
                        <Button size="sm" variant="ghost" onClick={() => void removeMember(member.userId)} aria-label={`Remove ${member.name ?? member.email ?? member.userId}`}>
                          ✕
                        </Button>
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{member.role}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!isOwner ? <p className="mt-2 text-xs text-slate-500">Only the owner can change roles.</p> : null}
          </section>
        </div>
      </div>
    </div>
  );
}

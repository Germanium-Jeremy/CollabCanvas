import { expect, test } from "@playwright/test";
import { registerViaUi } from "./helpers";

const API = "http://localhost:3001/api";

test("invite panel: link joins are viewer-only, owner promotes, editor cannot change roles", async ({ browser }) => {
  const unique = Date.now();
  const ownerEmail = `share-owner-${unique}@example.com`;
  const editorEmail = `share-editor-${unique}@example.com`;
  const viewerEmail = `share-viewer-${unique}@example.com`;

  // --- Owner registers and creates a PRIVATE room ---
  const contextOwner = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const pageOwner = await contextOwner.newPage();
  await registerViaUi(pageOwner, ownerEmail, "Share Owner");

  await pageOwner.getByRole("button", { name: /new room/i }).click();
  await pageOwner.getByLabel("Room name").fill("Share contract room");
  await pageOwner.getByRole("button", { name: "Create", exact: true }).click();
  await pageOwner.waitForURL("**/rooms/*");
  const roomId = pageOwner.url().split("/").pop() as string;
  await expect(pageOwner.getByTestId("connection-status")).toContainText("Live", { timeout: 30_000 });

  // --- Owner opens the Invite panel (owner-only sections visible) ---
  await pageOwner.getByTestId("invite-button").click();
  await expect(pageOwner.getByTestId("member-roster")).toBeVisible();

  // Copy-link must report success only after clipboard write succeeds.
  await pageOwner.getByTestId("copy-link").click();
  await expect(pageOwner.getByTestId("copy-link")).toContainText("Copied!");
  const clipboardLink = await pageOwner.evaluate(() => navigator.clipboard.readText());
  expect(clipboardLink).toContain(`/rooms/${roomId}?code=`);

  // --- Owner invites the editor by email with role EDITOR ---
  await pageOwner.getByTestId("invite-email").fill(editorEmail);
  await pageOwner.getByTestId("invite-role").selectOption("EDITOR");
  await pageOwner.getByTestId("invite-send").click();
  const inviteLink = await pageOwner.getByTestId("invite-code-out").textContent();
  expect(inviteLink).toContain("invite=");

  // Owner also invites the viewer (role VIEWER is the default).
  await pageOwner.getByTestId("invite-email").fill(viewerEmail);
  await pageOwner.getByTestId("invite-role").selectOption("VIEWER");
  await pageOwner.getByTestId("invite-send").click();
  await pageOwner.keyboard.press("Escape");

  // --- Editor accepts the invitation from the link and lands as EDITOR ---
  const contextEditor = await browser.newContext();
  const pageEditor = await contextEditor.newPage();
  await registerViaUi(pageEditor, editorEmail, "Share Editor");
  await pageEditor.goto(inviteLink!.trim());
  await pageEditor.getByTestId("accept-invite").click();
  await expect(pageEditor.getByText("EDITOR", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Editor can open the roster but sees no role selectors.
  await pageEditor.getByTestId("invite-button").click();
  await expect(pageEditor.getByTestId("member-roster")).toBeVisible();
  expect(await pageEditor.locator("[data-testid^='role-select-']").count()).toBe(0);
  await pageEditor.keyboard.press("Escape");

  // --- Viewer joins via the private share LINK: lands as VIEWER ---
  const contextViewer = await browser.newContext();
  const pageViewer = await contextViewer.newPage();
  await registerViaUi(pageViewer, viewerEmail, "Share Viewer");
  await pageViewer.goto(clipboardLink);
  await expect(pageViewer.getByTestId("connection-status")).toContainText("Live", { timeout: 30_000 });
  await expect(pageViewer.getByText("VIEWER", { exact: true })).toBeVisible();
  await expect(pageViewer.getByLabel("Rectangle (R)")).toBeDisabled();

  // --- Owner promotes the link-viewer to EDITOR via the roster ---
  await pageOwner.getByTestId("invite-button").click();
  const viewerRow = pageOwner.getByTestId("member-roster").locator("li", { hasText: viewerEmail });
  await viewerRow.waitFor({ state: "visible", timeout: 15_000 });
  await viewerRow.locator("select").selectOption("EDITOR");
  // Roster refreshes; then the viewer reloads into the new role.
  await expect
    .poll(async () => {
      const rosterRes = await contextOwner.request.get(`${API}/rooms/${roomId}/members`);
      const members = (await rosterRes.json()) as { email: string | null; role: string }[];
      return members.find((m) => m.email === viewerEmail)?.role;
    })
    .toBe("EDITOR");

  // --- Direct API check: the editor cannot change roles (403) ---
  await contextEditor.request.post(`${API}/auth/login`, { data: { email: editorEmail, password: "password123" } });
  const viewerIdRes = await contextEditor.request.get(`${API}/auth/me`);
  void viewerIdRes;
  const escalation = await contextEditor.request.patch(`${API}/rooms/${roomId}/members`, {
    data: { userId: "anything", role: "VIEWER" },
  });
  expect(escalation.status()).toBe(403);

  // --- Link must NOT have made the private room public ---
  const ownerRoom = await contextOwner.request.get(`${API}/rooms/${roomId}`);
  expect(((await ownerRoom.json()) as { isPublic: boolean }).isPublic).toBe(false);

  await contextOwner.close();
  await contextEditor.close();
  await contextViewer.close();
});

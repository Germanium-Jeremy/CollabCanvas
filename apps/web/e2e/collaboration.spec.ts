import { expect, test } from "@playwright/test";
import { boardElementCount, boardElements, clickCanvas, dragOnCanvas, registerViaUi } from "./helpers";

const API = "http://localhost:3001/api";

test("two users edit the same board and see each other's presence", async ({ browser }) => {
  const unique = Date.now();
  const nameA = `Alice ${unique}`;

  // --- User A: register and create a private room ---
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await registerViaUi(pageA, `alice-${unique}@example.com`, nameA);

  // Private room: B gets in through an email invitation, not a public link,
  // so the "Public" checkbox stays unchecked.
  await pageA.getByRole("button", { name: /new room/i }).click();
  await pageA.getByLabel("Room name").fill("E2E collab room");
  await pageA.getByRole("button", { name: "Create", exact: true }).click();
  await pageA.waitForURL("**/rooms/*");
  const roomId = pageA.url().split("/").pop() as string;

  await expect(pageA.getByTestId("connection-status")).toContainText("Live", { timeout: 30_000 });

  // --- A invites B by email as EDITOR; B redeems before opening the board ---
  const ownerContext = await browser.newContext();
  const ownerApiRequest = ownerContext.request;
  await ownerApiRequest.post(`${API}/auth/login`, {
    data: { email: `alice-${unique}@example.com`, password: "password123" },
  });
  const invitation = await ownerApiRequest.post(`${API}/rooms/${roomId}/invitations`, {
    data: { email: `bob-${unique}@example.com`, role: "EDITOR" },
  });
  expect(invitation.ok()).toBeTruthy();
  const inviteCode = ((await invitation.json()) as { code: string }).code;

  // --- User B: register, open the acceptance link, accept, land as EDITOR ---
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await registerViaUi(pageB, `bob-${unique}@example.com`, "Bob E2E");
  await pageB.goto(`/rooms/${roomId}?invite=${encodeURIComponent(inviteCode)}&email=${encodeURIComponent(`bob-${unique}@example.com`)}`);
  const acceptBanner = pageB.getByTestId("accept-invite");
  await expect(acceptBanner).toBeVisible();
  await acceptBanner.click();
  await expect(pageB.getByText("EDITOR", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(pageB.getByTestId("connection-status")).toContainText("Live", { timeout: 30_000 });

  // --- Presence: B sees A in the avatar stack ---
  await expect(pageB.getByTestId("presence-avatars")).toContainText(nameA.slice(0, 2).toUpperCase());

  // --- A draws a rectangle; B receives it in real time ---
  await pageA.getByLabel("Rectangle (R)").click();
  await dragOnCanvas(pageA, 120, 120, 320, 260);

  await expect.poll(() => boardElementCount(pageA), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => boardElementCount(pageB), { timeout: 20_000 }).toBe(1);

  // --- B adds a sticky note; A receives it ---
  await pageB.getByLabel("Sticky note (S)").click();
  await clickCanvas(pageB, 420, 140);
  await expect.poll(() => boardElementCount(pageB), { timeout: 20_000 }).toBe(2);
  await pageB.getByTestId("sticky-editor").fill("hello from B");
  await expect
    .poll(async () => (await boardElements(pageA)).find((element) => element.type === "sticky")?.text, { timeout: 20_000 })
    .toBe("hello from B");
  await pageB.getByTestId("sticky-editor").blur();

  await expect.poll(() => boardElementCount(pageB), { timeout: 20_000 }).toBe(2);
  await expect.poll(() => boardElementCount(pageA), { timeout: 20_000 }).toBe(2);

  // Text edits use the same realtime path and should be visible before the
  // editor loses focus, just like sticky-note edits.
  await pageB.getByLabel("Text (T)").click();
  await clickCanvas(pageB, 420, 330);
  await pageB.getByTestId("text-editor").fill("a live text label");
  await expect
    .poll(async () => (await boardElements(pageA)).find((element) => element.type === "text")?.text, { timeout: 20_000 })
    .toBe("a live text label");
  await pageB.getByTestId("text-editor").blur();

  await contextA.close();
  await contextB.close();
  await ownerContext.close();
});

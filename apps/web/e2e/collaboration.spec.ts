import { expect, test } from "@playwright/test";
import { boardElementCount, dragOnCanvas, registerViaUi } from "./helpers";

test("two users edit the same board and see each other's presence", async ({ browser }) => {
  const unique = Date.now();
  const nameA = `Alice ${unique}`;

  // --- User A: register and create a public room ---
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await registerViaUi(pageA, `alice-${unique}@example.com`, nameA);

  await pageA.getByRole("button", { name: /new room/i }).click();
  await pageA.getByLabel("Room name").fill("E2E collab room");
  await pageA.getByText("Public (anyone with the link can edit)").check();
  await pageA.getByRole("button", { name: "Create", exact: true }).click();
  await pageA.waitForURL("**/rooms/*");
  const roomUrl = pageA.url();

  await expect(pageA.getByTestId("connection-status")).toContainText("Live", { timeout: 30_000 });

  // --- User B: register and join the same room ---
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await registerViaUi(pageB, `bob-${unique}@example.com`, "Bob E2E");
  await pageB.goto(roomUrl);
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
  await pageB.getByTestId("canvas-container").click({ position: { x: 420, y: 140 } });
  await pageB.getByTestId("sticky-editor").fill("hello from B");
  await pageB.getByTestId("sticky-editor").blur();

  await expect.poll(() => boardElementCount(pageB), { timeout: 20_000 }).toBe(2);
  await expect.poll(() => boardElementCount(pageA), { timeout: 20_000 }).toBe(2);

  await contextA.close();
  await contextB.close();
});

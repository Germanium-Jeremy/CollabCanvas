import { expect, test } from "@playwright/test";
import { boardElementCount, dragOnCanvas, loginViaUi, registerViaUi } from "./helpers";

const API = "http://localhost:3001/api";

test("viewers cannot edit the board", async ({ browser }) => {
  const unique = Date.now();
  const owner = { email: `owner-${unique}@example.com`, name: `Owner ${unique}` };
  const viewer = { email: `viewer-${unique}@example.com`, name: `Viewer ${unique}` };

  // Owner creates a public room via the UI.
  const contextOwner = await browser.newContext();
  const pageOwner = await contextOwner.newPage();
  await registerViaUi(pageOwner, owner.email, owner.name);
  await pageOwner.getByRole("button", { name: /new room/i }).click();
  await pageOwner.getByLabel("Room name").fill("Permission room");
  await pageOwner.getByRole("button", { name: "Create", exact: true }).click();
  await pageOwner.waitForURL("**/rooms/*");
  const roomId = pageOwner.url().split("/").pop() as string;

  // Viewer signs in (browser) and opens the room.
  const contextViewer = await browser.newContext();
  const pageViewer = await contextViewer.newPage();
  await loginViaUi(pageViewer, viewer.email);
  await pageViewer.goto(pageOwner.url());
  await expect(pageViewer.getByTestId("connection-status")).toContainText("Live", { timeout: 30_000 });

  // Owner demotes the viewer via the API (members UI is owner-only; the API is the contract).
  const ownerApi = await browser.newContext(); // cookie jar for the API
  const ownerRequest = await ownerApi.request;
  const loginRes = await ownerRequest.post(`${API}/auth/login`, { data: { email: owner.email, password: "password123" } });
  const ownerId = (await loginRes.json()).user.id as string;

  const viewerApi = await browser.newContext();
  const viewerRequest = await viewerApi.request;
  const viewerLogin = await viewerRequest.post(`${API}/auth/login`, { data: { email: viewer.email, password: "password123" } });
  const viewerId = (await viewerLogin.json()).user.id as string;

  // Join as EDITOR first (public room), then demote to VIEWER.
  await viewerRequest.post(`${API}/rooms/${roomId}/join`, { data: {} });
  const demote = await ownerRequest.patch(`${API}/rooms/${roomId}/members`, {
    data: { userId: viewerId, role: "VIEWER" },
  });
  expect(demote.ok()).toBeTruthy();
  void ownerId;

  // Viewer reloads → sees VIEWER badge and cannot draw.
  await pageViewer.reload();
  await expect(pageViewer.getByTestId("connection-status")).toContainText("Live", { timeout: 30_000 });
  await expect(pageViewer.getByText("VIEWER", { exact: true })).toBeVisible();

  const rectButton = pageViewer.getByLabel("Rectangle (R)");
  await expect(rectButton).toBeDisabled();

  await dragOnCanvas(pageViewer, 100, 100, 300, 300);
  await expect.poll(() => boardElementCount(pageViewer), { timeout: 10_000 }).toBe(0);
  await expect.poll(() => boardElementCount(pageOwner), { timeout: 10_000 }).toBe(0);

  await contextOwner.close();
  await contextViewer.close();
  await ownerApi.close();
  await viewerApi.close();
});

import type { Page } from "@playwright/test";

/** Register a new user through the UI and land on /rooms. */
export async function registerViaUi(page: Page, email: string, name: string): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "No account? Register" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/rooms");
}

/** Sign in through the UI. */
export async function loginViaUi(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/rooms");
}

/** Drag on the canvas container to create a shape with the active tool. */
export async function dragOnCanvas(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  const box = await page.getByTestId("canvas-container").boundingBox();
  if (!box) throw new Error("canvas container not found");
  const startX = box.x + fromX;
  const startY = box.y + fromY;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(box.x + toX, box.y + toY, { steps: 8 });
  await page.mouse.up();
}

export function boardElementCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as Record<string, number | undefined>).__boardElements ?? 0);
}

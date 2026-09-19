import { expect, test } from "@playwright/test";
import { dragOnCanvas, registerViaUi } from "./helpers";

test("exports the board as a PNG download", async ({ page }) => {
  const unique = Date.now();
  await registerViaUi(page, `export-${unique}@example.com`, "Export Tester");

  await page.getByRole("button", { name: /new room/i }).click();
  await page.getByLabel("Room name").fill(`Export room ${unique}`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL("**/rooms/*");

  // Add something to the canvas first.
  await page.getByLabel("Rectangle (R)").click();
  await dragOnCanvas(page, 100, 100, 260, 220);

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByLabel("Export as PNG").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(`export-room-${unique}.png`);
});

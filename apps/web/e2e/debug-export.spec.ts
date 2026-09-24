import { expect, test } from "@playwright/test";
import { dragOnCanvas, registerViaUi } from "./helpers";

test("diagnose export download", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (msg) => logs.push(`[c:${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

  const unique = Date.now();
  await registerViaUi(page, `exd-${unique}@example.com`, "Export Diag");
  await page.getByRole("button", { name: /new room/i }).click();
  await page.getByLabel("Room name").fill(`Diag room ${unique}`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL("**/rooms/*");

  await page.getByLabel("Rectangle (R)").click();
  await dragOnCanvas(page, 100, 100, 260, 220);
  await page.waitForTimeout(1000);

  // Click export and capture everything for 8 seconds.
  await page.getByLabel("Export as PNG").click({ timeout: 5000 }).catch((e) => logs.push(`[clickerr] ${String(e)}`));
  await page.waitForTimeout(8000);
  console.log(logs.slice(-30).join("\n"));
  expect(true).toBe(true);
});

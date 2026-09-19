import { expect, test } from "@playwright/test";
import { registerViaUi } from "./helpers";

test("summarize board returns an AI result (mock provider)", async ({ page }) => {
  const unique = Date.now();
  await registerViaUi(page, `ai-${unique}@example.com`, "AI Tester");

  await page.getByRole("button", { name: /new room/i }).click();
  await page.getByLabel("Room name").fill("AI test room");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL("**/rooms/*");

  await page.getByTestId("toggle-ai").click();
  await page.getByRole("button", { name: "Summarize board" }).click();

  await expect(page.getByTestId("ai-result")).toContainText(/board|empty/i, { timeout: 20_000 });
});

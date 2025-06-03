import { expect, test } from "@playwright/test";
import { clickCanvas, registerViaUi } from "./helpers";

/**
 * Regression test: text and sticky notes used to vanish instantly because the
 * element was created on pointerdown, the browser's focus default blurred the
 * just-mounted editor, and the blur handler deleted the still-empty element.
 */
test("text and sticky notes stay visible after editing", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // The auth client intentionally lets an access token 401 once and then
    // silently refreshes; the browser logs that probe. It is part of login,
    // not the canvas interaction under test.
    if (msg.text().includes("status of 401")) return;
    consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const unique = Date.now();
  await registerViaUi(page, `sticky-${unique}@example.com`, "Sticky Tester");

  await page.getByRole("button", { name: /new room/i }).click();
  await page.getByLabel("Room name").fill("Visibility room");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL("**/rooms/*");
  await expect(page.getByTestId("connection-status")).toContainText("Live");

  // --- Text: click, type, commit with Enter ---
  await page.getByLabel("Text (T)").click();
  await clickCanvas(page, 300, 120);
  const textEditor = page.getByTestId("text-editor");
  await expect(textEditor).toBeVisible();
  await textEditor.fill("visible label");
  await textEditor.press("Enter");

  // Editor closes and the element persists in the board model.
  await expect(textEditor).toHaveCount(0);
  await expect.poll(() => boardTexts(page)).toContain("visible label");

  // --- Sticky: click, type multiline, commit with Escape ---
  await page.getByLabel("Sticky note (S)").click();
  await clickCanvas(page, 420, 200);
  const stickyEditor = page.getByTestId("sticky-editor");
  await expect(stickyEditor).toBeVisible();
  await stickyEditor.fill("sticky body");
  await stickyEditor.press("Escape");

  await expect(stickyEditor).toHaveCount(0);
  await expect.poll(() => boardTexts(page)).toContain("sticky body");

  // --- A click-away without typing creates nothing (drag guard + empty delete) ---
  await clickCanvas(page, 650, 400);
  await expect(page.getByTestId("text-editor")).toHaveCount(0);

  // No console or page errors during the whole interaction.
  expect(consoleErrors).toEqual([]);
});

/** Text contents of all text/sticky elements from the board test hook. */
async function boardTexts(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    const snapshot = (window as unknown as Record<string, unknown>).__boardElementSnapshot as
      | { type: string; text?: string }[]
      | undefined;
    return (snapshot ?? []).filter((el) => el.type === "text" || el.type === "sticky").map((el) => el.text ?? "");
  });
}

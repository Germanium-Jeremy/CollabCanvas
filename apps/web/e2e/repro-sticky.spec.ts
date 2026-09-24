import { expect, test } from "@playwright/test";
import { boardElementCount, registerViaUi } from "./helpers";

test("diagnose tool behaviors: rect drag vs text click vs sticky click", async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning" || msg.text().startsWith("[dbg]")) console.log("[browser]", msg.text());
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  const unique = Date.now();
  await registerViaUi(page, `diag-${unique}@example.com`, "Diag Tester");

  await page.getByRole("button", { name: /new room/i }).click();
  await page.getByLabel("Room name").fill("Diag room");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL("**/rooms/*");

  await expect(page.getByTestId("connection-status")).toContainText("Live");

  // Global focus tracking.
  await page.evaluate(() => {
    document.addEventListener("focusout", (e) => {
      const t = e.target as HTMLElement;
      const r = e.relatedTarget as HTMLElement | null;
      console.log("[dbg] focusout from", t.tagName, "to", r?.tagName ?? "null", "active:", document.activeElement?.tagName ?? "null");
    });
    document.addEventListener("focusin", (e) => {
      console.log("[dbg] focusin to", (e.target as HTMLElement).tagName);
    });
  });

  // Trace raw pointer events reaching the canvas container.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__events = [] as string[];
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) {
      document.addEventListener(type, () => {
        (w.__events as string[]).push(type);
      });
    }
  });

  const box = (await page.getByTestId("canvas-container").boundingBox())!;

  // 1) Rect via drag.
  await page.getByLabel("Rectangle (R)").click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 220, { steps: 4 });
  await page.mouse.up();
  console.log("[diag] after rect drag count:", await boardElementCount(page));

  // 2) Text via click.
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__events = []));
  await page.getByLabel("Text (T)").click();
  await page.mouse.click(box.x + 300, box.y + 120);
  console.log("[diag] text click events:", await page.evaluate(() => (window as unknown as Record<string, unknown>).__events));
  console.log("[diag] after text click count:", await boardElementCount(page));
  console.log("[diag] text-editor count:", await page.getByTestId("text-editor").count());
  // Blur to commit if editor appeared.
  await page.keyboard.press("Escape");
  await page.mouse.click(box.x + 600, box.y + 500);

  // 3) Sticky via click.
  await page.getByLabel("Sticky note (S)").click();
  await page.mouse.click(box.x + 420, box.y + 150);
  console.log("[diag] after sticky click count:", await boardElementCount(page));
  console.log("[diag] sticky-editor count:", await page.getByTestId("sticky-editor").count());
  await page.waitForTimeout(1000);
  console.log("[diag] final count:", await boardElementCount(page));
  await page.screenshot({ path: "test-results/diag.png" });
});

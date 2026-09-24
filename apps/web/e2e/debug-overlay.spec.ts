import { expect, test } from "@playwright/test";
import { dragOnCanvas, registerViaUi } from "./helpers";

test("diagnose toolbar overlay", async ({ page }) => {
  const logs: string[] = [];
  const unique = Date.now();
  await registerViaUi(page, `ovl-${unique}@example.com`, "Overlay Diag");
  await page.getByRole("button", { name: /new room/i }).click();
  await page.getByLabel("Room name").fill(`Overlay room ${unique}`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL("**/rooms/*");

  await page.getByLabel("Rectangle (R)").click();
  await dragOnCanvas(page, 100, 100, 260, 220);
  await page.waitForTimeout(500);

  const box = await page.getByLabel("Export as PNG").boundingBox();
  if (!box) throw new Error("export button not found");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const stack = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x as number, y as number);
    const chain: string[] = [];
    let cur: Element | null = el;
    while (cur && chain.length < 8) {
      chain.push(`${cur.tagName}.${String(cur.className).slice(0, 60)}`);
      cur = cur.parentElement;
    }
    return chain;
  }, [cx, cy]);
  console.log("CLICK_POINT:", cx, cy);
  console.log("TOP_ELEMENTS:", JSON.stringify(stack, null, 1));
  // Also check the button's own rect vs viewport
  console.log("VIEWPORT:", await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`));
  expect(true).toBe(true);
});

import { expect, test } from "@playwright/test";
import { dragOnCanvas, registerViaUi } from "./helpers";

test("diagnose render loop on board", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (msg) => logs.push(`[c:${msg.type()}] ${msg.text()}`));
  page.on("websocket", (ws) => {
    logs.push(`[ws] open ${ws.url()}`);
    ws.on("close", () => logs.push("[ws] close"));
  });

  const unique = Date.now();
  await registerViaUi(page, `loop-${unique}@example.com`, "Loop Tester");
  await page.getByRole("button", { name: /new room/i }).click();
  await page.getByLabel("Room name").fill(`Loop room ${unique}`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL("**/rooms/*");

  // Sample element counts over 5s to detect re-render churn.
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    samples.push(
      await page.evaluate(
        () => document.querySelectorAll("*").length,
      ),
    );
    await page.waitForTimeout(1000);
  }
  console.log("dom-node-counts:", samples.join(","));

  await page.getByRole("button", { name: "Select (V)" }).click();
  await dragOnCanvas(page, 100, 100, 200, 200);
  await page.waitForTimeout(2000);
  console.log(logs.slice(-40).join("\n"));
  expect(true).toBe(true);
});

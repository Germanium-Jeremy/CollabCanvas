import { expect, test } from "@playwright/test";
import { loginViaUi, registerViaUi } from "./helpers";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.com`;
}

test.describe("header session states", () => {
  test("shows identity when signed in and Sign in after logout", async ({ page }) => {
    const email = uniqueEmail("session");
    await registerViaUi(page, email, "Session Sam");

    // Signed in: identity + Sign out are visible, no Sign in link.
    const header = page.locator("header");
    await expect(header.getByTestId("header-user")).toContainText("Session Sam");
    await expect(header.getByTestId("sign-out")).toBeVisible();
    await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);

    // Sign out clears the session.
    await header.getByTestId("sign-out").click();
    await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(header.getByTestId("header-user")).toHaveCount(0);

    // Still signed out after a reload (session was revoked server-side).
    await page.reload();
    await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();

    // Signing back in restores the identity.
    await loginViaUi(page, email);
    await expect(header.getByTestId("header-user")).toContainText("Session Sam");
    await expect(header.getByTestId("sign-out")).toBeVisible();
  });

  test("unauthenticated visitors see Sign in, never identity", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header");
    await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(header.getByTestId("header-user")).toHaveCount(0);
  });
});

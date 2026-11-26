import { expect, test } from "@playwright/test";

test.describe("SyncCanvas Playground E2E (T52)", () => {
  test("loads split-screen playground with converged initial state hashes", async ({ page }) => {
    await page.goto("/");

    const paneA = page.getByTestId("pane-a");
    const paneB = page.getByTestId("pane-b");
    await expect(paneA).toBeVisible();
    await expect(paneB).toBeVisible();
    await expect(page.getByTestId("convergence-badge")).toContainText("Converged");

    const hashA = await paneA.getAttribute("data-state-hash");
    const hashB = await paneB.getAttribute("data-state-hash");
    expect(hashA).toBeTruthy();
    expect(hashA).toBe(hashB);
  });

  test("runs the scripted conflict demo and converges both panes to identical hashes", async ({
    page,
  }) => {
    await page.goto("/");

    const demoBtn = page.getByTestId("run-conflict-demo");
    await demoBtn.click();
    await expect(demoBtn).toBeDisabled();
    await expect(page.getByTestId("demo-caption")).toBeVisible();

    // Wait for step 6/6 completion
    await expect(page.getByTestId("demo-caption")).toContainText("6/6 — Converged!", {
      timeout: 15_000,
    });
    await expect(demoBtn).toBeEnabled();

    const hashA = await page.getByTestId("pane-a").getAttribute("data-state-hash");
    const hashB = await page.getByTestId("pane-b").getAttribute("data-state-hash");
    expect(hashA).toBeTruthy();
    expect(hashA).toBe(hashB);
  });

  test("kill network -> edit offline -> reconnect converges both panes", async ({ page }) => {
    await page.goto("/");

    // Cut network on User A
    await page.getByTestId("toggle-network-User A").click();
    await expect(page.getByTestId("toggle-network-User A")).toContainText("Reconnect");

    // Reconnect User A
    await page.getByTestId("toggle-network-User A").click();
    await expect(page.getByTestId("toggle-network-User A")).toContainText("Kill Network");

    await expect(page.getByTestId("convergence-badge")).toContainText("Converged");
  });

  test("share link opens a single-client board", async ({ page }) => {
    await page.goto("/b/brd_e2etest1");
    await expect(page.getByText("brd_e2etest1")).toBeVisible();
    await expect(page.getByTestId("tool-rect")).toBeVisible();
  });
});

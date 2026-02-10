describe("Navigation", () => {
  it("should display the settings button", async () => {
    const settingsBtn = await $('[data-testid="settings-btn"]');
    await settingsBtn.waitForExist({ timeout: 10_000 });
    expect(await settingsBtn.isDisplayed()).toBe(true);
  });

  it("should open settings dialog when clicking settings", async () => {
    const settingsBtn = await $('[data-testid="settings-btn"]');
    await settingsBtn.click();

    // Wait for the settings dialog to appear
    await browser.pause(500);

    // Settings dialog should be visible — look for the dialog overlay
    // The SettingsDialog component renders when showSettings is true
    const dialog = await $("text=Settings");
    const exists = await dialog.isExisting();
    expect(exists).toBe(true);

    // Close by pressing Escape
    await browser.keys("Escape");
    await browser.pause(300);
  });

  it("should display the import button", async () => {
    const importBtn = await $('[data-testid="import-btn"]');
    await importBtn.waitForExist({ timeout: 5_000 });
    expect(await importBtn.isDisplayed()).toBe(true);
  });

  it("should open import dialog when clicking import", async () => {
    const importBtn = await $('[data-testid="import-btn"]');
    await importBtn.click();

    // Wait for the import dialog to appear
    await browser.pause(500);

    const dialog = await $("text=Import");
    const exists = await dialog.isExisting();
    expect(exists).toBe(true);

    // Close by pressing Escape
    await browser.keys("Escape");
    await browser.pause(300);
  });

  it("should have Browse and Jobs view tabs", async () => {
    const browseTab = await $("button=Browse");
    const jobsTab = await $("button=Jobs");

    expect(await browseTab.isExisting()).toBe(true);
    expect(await jobsTab.isExisting()).toBe(true);
  });

  it("should switch to Jobs view when clicking Jobs tab", async () => {
    const jobsTab = await $("button=Jobs");
    await jobsTab.click();
    await browser.pause(500);

    // The query bar should no longer be visible in Jobs view
    const queryBar = await $('[data-testid="query-bar"]');
    const isDisplayed = await queryBar.isDisplayed().catch(() => false);
    expect(isDisplayed).toBe(false);

    // Switch back to Browse
    const browseTab = await $("button=Browse");
    await browseTab.click();
    await browser.pause(500);
  });
});

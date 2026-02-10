describe("App Launch", () => {
  it("should have the correct window title", async () => {
    const title = await browser.getTitle();
    expect(title).toBe("Sample Curator");
  });

  it("should render the app root container", async () => {
    const appRoot = await $('[data-testid="app-root"]');
    await appRoot.waitForExist({ timeout: 10_000 });
    expect(await appRoot.isDisplayed()).toBe(true);
  });

  it("should render the header bar", async () => {
    const header = await $('[data-testid="header-bar"]');
    await header.waitForExist({ timeout: 5_000 });
    expect(await header.isDisplayed()).toBe(true);
  });

  it("should render the query bar", async () => {
    const queryBar = await $('[data-testid="query-bar"]');
    await queryBar.waitForExist({ timeout: 5_000 });
    expect(await queryBar.isDisplayed()).toBe(true);
  });

  it("should render the sample browser", async () => {
    const browser_ = await $('[data-testid="sample-browser"]');
    await browser_.waitForExist({ timeout: 5_000 });
    expect(await browser_.isDisplayed()).toBe(true);
  });

  it("should not show any crash errors", async () => {
    const errorElements = await $$(".text-red-400");
    // The only red text element would be from the ErrorBoundary or initError
    // In a successful launch, there should be none with "Error" content
    for (const el of errorElements) {
      const text = await el.getText();
      expect(text).not.toContain("Initialization Error");
    }
  });
});

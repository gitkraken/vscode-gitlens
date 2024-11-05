import { expect, MaxTimeout, test } from './baseTest';

test.describe('Test GitLens Command Palette commands', () => {
	test('should open commit graph with the command', async ({ page }) => {
		// Open the command palette by clicking on the View menu and selecting Command Palette
		const commandPalette = page.locator('div[id="workbench.parts.titlebar"] .command-center-quick-pick');
		await commandPalette.click();

		// Wait for the command palette input to be visible and fill it
		const commandPaletteInput = page.locator('.quick-input-box input');
		await commandPaletteInput.waitFor({ state: 'visible', timeout: MaxTimeout });
		await commandPaletteInput.fill('> GitLens: Show Commit graph');
		await page.waitForTimeout(1000);
		void page.keyboard.press('Enter');

		// Click on the first element (GitLens: Show Commit graph)
		/*
		const commandPaletteFirstLine = page.locator('.quick-input-widget .monaco-list .monaco-list-row.focused');
		await commandPaletteFirstLine.waitFor({ state: 'visible', timeout: MaxTimeout });
		await commandPaletteFirstLine.click();
		*/
		// Graph should be opened
		await page.locator('.panel.basepanel').waitFor({ state: 'visible' });
		await expect(page.locator('div[id="workbench.view.extension.gitlensPanel"]')).toBeVisible();
	});
});

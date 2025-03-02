import { expect, MaxTimeout, test } from './baseTest';

test.describe('Test GitLens Command Palette commands', () => {
	test('should open commit graph with the command', async ({ page }) => {
		const home = page.locator('div[id="workbench.view.extension.gitlens"]');
		await home.waitFor({ state: 'visible', timeout: MaxTimeout });
		await page.waitForTimeout(500);

		// Open the command palette
		await page.keyboard.press('Control+Shift+P');

		// Wait for the command palette input to be visible and fill it
		const commandPaletteInput = page.locator('.quick-input-box input');
		await expect(commandPaletteInput).toBeVisible({ timeout: MaxTimeout });

		await commandPaletteInput.fill('> GitLens: Show Commit Graph');
		await page.waitForTimeout(500);
		await commandPaletteInput.press('Enter');

		// Assert the graph is opened and visible
		const commitGraph = page.locator('div[id="workbench.view.extension.gitlensPanel"]');
		await expect(commitGraph).toBeVisible({ timeout: MaxTimeout });
	});
});

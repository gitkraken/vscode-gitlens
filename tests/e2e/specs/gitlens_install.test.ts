import { test, expect } from './baseTest';

test.describe('Test GitLens installation', () => {
	test('should display GitLens Welcome page after installation', async ({ page }) => {
		const title = await page.textContent('.tab a');
		expect(title).toBe('Welcome to GitLens');
	});

	test('should contain GitLens & GitLens Inspect icons in activity bar', async ({ page }) => {
		await page.getByRole('tab', { name: 'GitLens Inspect' }).waitFor();
		const gitlensIcons = await page.getByRole('tab', { name: 'GitLens' });
		expect(gitlensIcons).toHaveCount(2);

		expect(await page.title()).toContain('[Extension Development Host]');
	});
});

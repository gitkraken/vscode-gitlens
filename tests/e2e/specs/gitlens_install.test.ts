import { expect, test } from './baseTest';

test.describe('Test GitLens installation', () => {
	test('should contain GitLens & GitLens Inspect icons in activity bar', async ({ page }) => {
		await page.getByRole('tab', { name: 'GitLens Inspect' }).waitFor();
		const gitlensIcons = page.getByRole('tab', { name: 'GitLens' });
		void expect(gitlensIcons).toHaveCount(2);

		expect(await page.title()).toContain('[Extension Development Host]');
	});
});

/**
 * Welcome-in-editor A/B experiment — live verification (gitkraken/vscode-gitlens-private#104)
 *
 * The cohort itself is latched only on a production-mode new install, so these specs flip the arm
 * with the `gitlens.welcome.simulate.inEditor` debug command — the same GitLens-side context path
 * the latch uses: control keeps Welcome as a sidebar view and never opens an editor tab; the editor
 * arm hides the sidebar view, reroutes `gitlens.showWelcomeView` (every existing entry point) to
 * the `gitlens.showWelcomePage` panel, and renders the app at editor width without horizontal
 * overflow. Ending the simulation restores the control layout.
 */
import * as process from 'node:process';
import type { Locator, Page } from '@playwright/test';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				await git.commit('Add test file', 'test-file.txt', 'Initial content');
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

// All specs share one VS Code instance and mutate the same context key — keep them ordered
test.describe.configure({ mode: 'serial' });

test.describe('Welcome-in-editor A/B experiment', () => {
	test.beforeEach(async ({ vscode }) => {
		test.skip(!(await vscode.gitlens.hasActivityBar()), 'Editor has no standard activity bar (e.g. Cursor)');
	});

	function welcomePane(page: Page): Locator {
		return page.locator('[id="workbench.parts.sidebar"] .pane-header .title').filter({ hasText: /^Welcome$/ });
	}

	function welcomeTab(page: Page): Locator {
		return page.locator('.tabs-and-actions-container .tab[aria-label*="Welcome"]');
	}

	test('control: Welcome is a sidebar view and showWelcomeView never opens an editor tab', async ({ vscode }) => {
		const { gitlens } = vscode;

		await gitlens.executeCommand('workbench.view.extension.gitlens');
		await expect(welcomePane(vscode.page)).toBeVisible({ timeout: MaxTimeout });

		await gitlens.executeCommand('gitlens.showWelcomeView');
		const view = await gitlens.getGitLensWebview('Welcome', 'webviewView');
		expect(view, 'Welcome webview VIEW should resolve in the sidebar').not.toBeNull();
		await expect(view!.locator('gl-welcome-app')).toBeVisible({ timeout: MaxTimeout });

		await expect(welcomeTab(vscode.page)).toHaveCount(0);
	});

	test('editor arm: sidebar view hides and showWelcomeView reroutes to an editor tab', async ({ vscode }) => {
		const { gitlens, page } = vscode;

		if (!(await gitlens.waitForCommand('gitlens.welcome.simulate.inEditor'))) {
			throw new Error('gitlens.welcome.simulate.inEditor command not found');
		}

		// Any uncaught exception in the webview at editor width surfaces here as a page error
		const pageErrors: string[] = [];
		page.on('pageerror', e => pageErrors.push(e.message));

		await gitlens.executeCommand('gitlens.welcome.simulate.inEditor', { enabled: true });
		await expect(welcomePane(vscode.page)).toHaveCount(0);

		// The reroute: the public view command must now land in the editor area
		await gitlens.executeCommand('gitlens.showWelcomeView');
		await expect(welcomeTab(vscode.page)).toBeVisible({ timeout: MaxTimeout });

		const panel = await gitlens.getGitLensWebview('Welcome', 'webviewPanel');
		expect(panel, 'Welcome webview PANEL should resolve in the editor area').not.toBeNull();
		await expect(panel!.locator('gl-welcome-page')).toBeVisible({ timeout: MaxTimeout });

		// Layout at editor width: the app must fill the editor surface without overflowing it, and the
		// content column (the page's 620px max-width `.section`) must stay constrained + horizontally
		// centered rather than stretching edge-to-edge on a wide editor.
		const metrics = await panel!.locator('gl-welcome-page').evaluate(el => {
			const doc = el.ownerDocument.documentElement;
			const section = el.shadowRoot?.querySelector('.section.header') ?? el.shadowRoot?.querySelector('.section');
			const rect = (section ?? el).getBoundingClientRect();
			return {
				viewportWidth: doc.clientWidth,
				scrollWidth: doc.scrollWidth,
				sectionFound: section != null,
				sectionWidth: rect.width,
				marginLeft: rect.left,
				marginRight: doc.clientWidth - rect.right,
			};
		});
		expect(metrics.viewportWidth, 'panel should be editor-sized, not sidebar-sized').toBeGreaterThan(600);
		expect(metrics.scrollWidth, 'no horizontal overflow at editor width').toBeLessThanOrEqual(
			metrics.viewportWidth + 1,
		);
		expect(metrics.sectionFound, 'welcome content section rendered').toBe(true);
		// ~620px max-width + padding on a ~1900px editor viewport — constrained, not full-bleed
		expect(metrics.sectionWidth, 'content column stays constrained, not full-bleed').toBeLessThanOrEqual(700);
		// Centered: left and right gutters are within a few px of each other on a wide editor
		expect(
			Math.abs(metrics.marginLeft - metrics.marginRight),
			'content column is horizontally centered',
		).toBeLessThan(4);

		// The direct panel command works as well
		await gitlens.closeAllEditors();
		await expect(welcomeTab(vscode.page)).toHaveCount(0);
		await gitlens.executeCommand('gitlens.showWelcomePage');
		await expect(welcomeTab(vscode.page)).toBeVisible({ timeout: MaxTimeout });

		await gitlens.closeAllEditors();

		expect(pageErrors, 'no uncaught exceptions while exercising the editor arm').toEqual([]);
	});

	test('ending the simulation restores the control layout', async ({ vscode }) => {
		const { gitlens } = vscode;

		await gitlens.executeCommand('gitlens.welcome.simulate.inEditor', {});
		await gitlens.executeCommand('workbench.view.extension.gitlens');
		await expect(welcomePane(vscode.page)).toBeVisible({ timeout: MaxTimeout });
		await expect(welcomeTab(vscode.page)).toHaveCount(0);
	});
});

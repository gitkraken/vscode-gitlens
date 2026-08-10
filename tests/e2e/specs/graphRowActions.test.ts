/**
 * GitLens Graph — inline row-action surface E2E tests
 *
 * Verifies that the action strip hides row content without changing the visible
 * hover or selection color beneath it.
 */
import * as process from 'node:process';
import type { Locator } from '@playwright/test';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { ensureGraphRowsRendered } from '../graphHelpers.js';

type RowSurfaceStyles = {
	rowBackgroundColor: string;
	placementBackgroundColor: string;
	actionsBackgroundImage: string;
	backdropTintColor: string;
	backdropBaseColor: string;
	backdropBackgroundImage: string;
	backdropMaskImage: string;
};

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				await git.commit('Add first module', 'first.ts', 'export const first = 1;');
				await git.commit('Add middle module', 'middle.ts', 'export const middle = 2;');
				await git.commit('Add latest module', 'latest.ts', 'export const latest = 3;');
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

function commitRow(messageText: string, graph: Parameters<typeof ensureGraphRowsRendered>[1]): Locator {
	return graph
		.getByRole('tree', { name: 'Commit graph' })
		.getByRole('treeitem', { name: messageText })
		.filter({ visible: true })
		.first();
}

async function getRowSurfaceStyles(row: Locator): Promise<RowSurfaceStyles> {
	return row.evaluate(element => {
		const actions = element.querySelector('.gl-graph__row-actions');
		if (!(actions instanceof HTMLElement)) {
			throw new Error('Expected the commit row to contain an inline action strip');
		}

		const rowStyle = window.getComputedStyle(element);
		const actionsStyle = window.getComputedStyle(actions);
		const backdropStyle = window.getComputedStyle(actions, '::before');
		const backgroundProbe = document.createElement('span');
		backgroundProbe.style.backgroundColor = 'var(--color-background)';
		document.body.append(backgroundProbe);
		const placementBackgroundColor = window.getComputedStyle(backgroundProbe).backgroundColor;
		backgroundProbe.remove();
		return {
			rowBackgroundColor: rowStyle.backgroundColor,
			placementBackgroundColor: placementBackgroundColor,
			actionsBackgroundImage: actionsStyle.backgroundImage,
			backdropTintColor: backdropStyle.color,
			backdropBaseColor: backdropStyle.backgroundColor,
			backdropBackgroundImage: backdropStyle.backgroundImage,
			backdropMaskImage: backdropStyle.maskImage || backdropStyle.getPropertyValue('-webkit-mask-image'),
		};
	});
}

async function expectActionBackdropToMatchRow(row: Locator): Promise<void> {
	await expect
		.poll(async () => {
			const styles = await getRowSurfaceStyles(row);
			return styles.backdropTintColor === styles.rowBackgroundColor;
		})
		.toBe(true);

	const styles = await getRowSurfaceStyles(row);
	expect(styles.backdropBaseColor).toBe(styles.placementBackgroundColor);
	expect(styles.backdropBackgroundImage).not.toBe('none');
	expect(styles.backdropMaskImage).not.toBe('none');
	expect(styles.actionsBackgroundImage).toBe('none');
}

test.describe('Graph — inline row actions', () => {
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('preserves hover and selection colors beneath the faded action strip', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();
		const graph = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
		expect(graph).not.toBeNull();
		await ensureGraphRowsRendered(vscode, graph!);

		// Use an ordinary, non-HEAD commit so this is neither the WIP row nor the graph's initial selection.
		const row = commitRow('Add middle module', graph!);
		await expect(row).toBeVisible({ timeout: MaxTimeout });
		const actions = row.locator('.gl-graph__row-actions');
		const openAllChanges = actions.getByRole('button', { name: 'Open All Changes' });

		await row.hover();
		await expect(actions).toBeVisible();
		await expect(openAllChanges).toBeVisible();
		await expect(openAllChanges).toBeEnabled();
		await expect(openAllChanges).toHaveAttribute('data-row-action', 'open-changes');
		await expectActionBackdropToMatchRow(row);

		// Clicking the row exercises its real selection handler. Move outside the webview afterward so the
		// strip is visible because of selection alone, rather than because :hover is still active.
		await row.click();
		await expect(row).toHaveAttribute('aria-selected', 'true');
		await vscode.page.mouse.move(1, 1);
		await expect(actions).toBeVisible();
		await expectActionBackdropToMatchRow(row);

		// Exercise the real delegated action and its host-side handler. This commit changes one file, so
		// Open All Changes is benign and deterministically opens a single multi-diff editor tab.
		await openAllChanges.click();
		await expect(vscode.page.getByRole('tab', { name: /Changes in [0-9a-f]+/i }).first()).toBeVisible({
			timeout: 30000,
		});
	});
});

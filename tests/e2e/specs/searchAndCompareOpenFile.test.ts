/**
 * Search & Compare — what a click on a file opens (#1651, #5968)
 *
 * `gitlens.views.searchAndCompare.files.openDiffOnClick` decides whether a click on a file in a comparison
 * or in a commit's file list opens the diff (default) or the working file at its first changed line. The
 * fixture puts each change on a known line, so the cursor position is an exact assertion rather than "some
 * file opened".
 *
 * Not covered here, deliberately: renamed files and files missing from the working tree — both are wrong
 * today (#5967) and their rows belong with that fix.
 */
import * as process from 'node:process';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, DefaultTimeout, expect, GitFixture, MaxTimeout } from '../baseTest.js';

/** `count` lines, `line N`, with ` changed` appended to `changedLine` (1-based) */
function lines(count: number, changedLine?: number): string {
	const all = Array.from({ length: count }, (_, i) => `line ${i + 1}${i + 1 === changedLine ? ' changed' : ''}`);
	return `${all.join('\n')}\n`;
}

let repoPath: string;

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			// A reopened file would otherwise get back the cursor an earlier test left, so a click that sets no line
			// could still land on the expected one
			userSettings: { 'workbench.editor.restoreViewState': false },
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				await git.commit('Add file1', 'file1.txt', lines(10));
				await git.commit('Add file2', 'file2.txt', lines(40));

				// The working tree stays on `feature`, so the working files carry the changes being opened
				await git.checkout('feature', true);
				await git.commit('Change file1 line 8', 'file1.txt', lines(10, 8));
				await git.commit('Change file2 line 30', 'file2.txt', lines(40, 30));

				repoPath = repoDir;
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

const openDiffOnClick = 'gitlens.views.searchAndCompare.files.openDiffOnClick';

/** Opens a comparison of `ref1` with `ref2` in Search & Compare, with only that section expanded */
async function showComparison(vscode: VSCodeInstance, ref1: string, ref2: string): Promise<void> {
	await vscode.gitlens.executeCommand('gitlens.compareWith', { ref1: ref1, ref2: ref2, repoPath: repoPath });

	// Under a loaded run the workbench can restore the Explorer after the view was shown, leaving Search & Compare
	// hidden — re-show it until the comparison's row is actually on screen
	const comparison = treeItem(vscode, new RegExp(`^Comparing ${ref1} with ${ref2}`));
	await expect(async () => {
		await vscode.gitlens.showSearchAndCompareView();
		await expect(comparison).toBeVisible({ timeout: MaxTimeout / 5 });
	}).toPass({ timeout: MaxTimeout * 3 });

	// The other Inspect sections share the side bar height; collapsed, the comparison's rows all render
	for (const name of [/^Inspect Section/, /^Line History/, /^File History/, /^Visual File History/]) {
		const section = vscode.page.getByRole('button', { name: name }).first();
		if ((await section.count()) && (await section.getAttribute('aria-expanded')) === 'true') {
			await section.click();
		}
	}
}

function treeItem(vscode: VSCodeInstance, name: RegExp) {
	return vscode.gitlens.searchCompareViewTreeView.getByRole('treeitem', { name: name }).first();
}

async function expandItem(vscode: VSCodeInstance, name: RegExp): Promise<void> {
	const item = treeItem(vscode, name);
	await expect(item).toBeVisible({ timeout: MaxTimeout });
	if ((await item.getAttribute('aria-expanded')) !== 'true') {
		await item.click();
		await vscode.page.keyboard.press('ArrowRight');
		await expect(item).toHaveAttribute('aria-expanded', 'true', { timeout: MaxTimeout });
	}
}

async function clickFile(vscode: VSCodeInstance, name: RegExp): Promise<void> {
	await vscode.gitlens.closeAllEditors();
	const item = treeItem(vscode, name);
	await expect(item).toBeVisible({ timeout: MaxTimeout });
	await item.click();
}

test.describe('Search & Compare — open file on click', () => {
	test.describe.configure({ mode: 'serial' });

	test.afterAll(async ({ vscode }) => {
		await vscode.gitlens.updateSetting(openDiffOnClick, undefined);
	});

	test('by default a click on a compared file opens its diff', async ({ vscode }) => {
		await showComparison(vscode, 'main', 'feature');
		await expandItem(vscode, /files changed/);
		await clickFile(vscode, /^file1\.txt/);

		await expect
			.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
			.toEqual({ kind: 'diff', file: 'file1.txt' });
	});

	test('with the setting off, the same row opens the working file at its first change without a refresh', async ({
		vscode,
	}) => {
		// The comparison from the previous test stays as is: nothing refreshes the view but the setting change itself.
		// The view rebuilds its items asynchronously on that change and nothing on screen marks the rebuild (the rows
		// keep their DOM), so the click waits out the rebuild — measured under 100ms — and then has exactly one try
		await vscode.gitlens.updateSetting(openDiffOnClick, false);
		await vscode.page.waitForTimeout(DefaultTimeout);
		await clickFile(vscode, /^file1\.txt/);

		await expect
			.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
			.toEqual({ kind: 'text', file: 'file1.txt', line: 7 });
	});

	test('with the setting off, the comparison in the other direction lands on the same line', async ({ vscode }) => {
		await vscode.gitlens.executeCommand('gitlens.views.searchAndCompare.clear');
		await showComparison(vscode, 'feature', 'main');
		await expandItem(vscode, /files changed/);
		await clickFile(vscode, /^file1\.txt/);

		await expect
			.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
			.toEqual({ kind: 'text', file: 'file1.txt', line: 7 });
	});

	test("with the setting off, a file in a commit's file list opens at its first change", async ({ vscode }) => {
		await expandItem(vscode, /^(Ahead|Behind) 2 commits/);
		await expandItem(vscode, /Change file2 line 30/);
		await clickFile(vscode, /^file2\.txt/);

		await expect
			.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
			.toEqual({ kind: 'text', file: 'file2.txt', line: 29 });
	});
});

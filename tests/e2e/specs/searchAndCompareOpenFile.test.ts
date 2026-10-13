/**
 * Search & Compare — what a click on a file opens (#1651, #5968)
 *
 * `gitlens.views.searchAndCompare.files.openDiffOnClick` decides whether a click on a file in a comparison
 * or in a commit's file list opens the diff (default) or the working file at its first changed line. The
 * fixture puts each change on a known line, so the cursor position is an exact assertion rather than "some
 * file opened".
 *
 * Also covers the two cases that used to go wrong (#5967): a file renamed and modified on the checked-out branch
 * opens the working file at its first change, and a file that isn't in the working tree at all opens at the
 * compared revision instead of only warning. A renamed file that isn't in the working tree under either name
 * opens at the compared revision by its name there (#5975), rather than a picker for the other side's name —
 * and so does a comparison row's inline "Open File at Revision", which shares the row's uri.
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
				await git.commit('Add file3', 'file3.txt', lines(20));

				// `only-other.txt` exists only on `other`, so it is never in the working tree
				await git.checkout('other', true);
				await git.commit('Add only-other', 'only-other.txt', lines(5));
				// `renamed` carries it on under a new name, so comparing the two shows a rename whose names are both
				// absent from the working tree
				await git.checkout('renamed', true);
				await git.move('only-other.txt', 'only-other-renamed.txt');
				await git.commit('Rename only-other and change line 3', 'only-other-renamed.txt', lines(5, 3));
				await git.checkout('main');

				// The working tree stays on `feature`, so the working files carry the changes being opened
				await git.checkout('feature', true);
				await git.commit('Change file1 line 8', 'file1.txt', lines(10, 8));
				await git.commit('Change file2 line 30', 'file2.txt', lines(40, 30));
				await git.move('file3.txt', 'file3-renamed.txt');
				await git.commit('Rename file3 and change line 12', 'file3-renamed.txt', lines(20, 12));

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

/** A row by accessible name, or — with `level` — by depth and visible text, to tell the files node under Ahead/Behind from the comparison's own */
function treeItem(vscode: VSCodeInstance, name: RegExp, level?: number) {
	const tree = vscode.gitlens.searchCompareViewTreeView;
	return (
		level == null
			? tree.getByRole('treeitem', { name: name })
			: tree.locator(`[role="treeitem"][aria-level="${level}"]`).filter({ hasText: name })
	).first();
}

async function expandItem(vscode: VSCodeInstance, name: RegExp, level?: number): Promise<void> {
	const item = treeItem(vscode, name, level);
	await expect(item).toBeVisible({ timeout: MaxTimeout });
	if ((await item.getAttribute('aria-expanded')) !== 'true') {
		await item.click();
		await vscode.page.keyboard.press('ArrowRight');
		await expect(item).toHaveAttribute('aria-expanded', 'true', { timeout: MaxTimeout });
	}
}

async function clickFile(vscode: VSCodeInstance, name: RegExp, level?: number): Promise<void> {
	await vscode.gitlens.closeAllEditors();
	const item = treeItem(vscode, name, level);
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
			.toEqual({ kind: 'diff', file: 'file1.txt', original: 'file1.txt' });
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
		await expandItem(vscode, /^(Ahead|Behind) 3 commits/);
		await expandItem(vscode, /Change file2 line 30/);
		await clickFile(vscode, /^file2\.txt/);

		await expect
			.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
			.toEqual({ kind: 'text', file: 'file2.txt', line: 29 });
	});

	test("with the setting off, a renamed and modified file in a commit's file list opens at its first change", async ({
		vscode,
	}) => {
		await expandItem(vscode, /Rename file3 and change line 12/);
		await clickFile(vscode, /^file3-renamed\.txt/);

		await expect
			.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
			.toEqual({ kind: 'text', file: 'file3-renamed.txt', line: 11 });
	});

	// A comparison labels a renamed file by the path on the side the diff runs to, so the row's name depends on the
	// direction — the working file it opens is the same either way
	for (const [ref1, ref2] of [
		['main', 'feature'],
		['feature', 'main'],
	]) {
		test(`with the setting off, a renamed and modified file compared ${ref1} with ${ref2} opens the working file at its first change`, async ({
			vscode,
		}) => {
			await vscode.gitlens.executeCommand('gitlens.views.searchAndCompare.clear');
			await showComparison(vscode, ref1, ref2);
			await expandItem(vscode, /files changed/);
			await clickFile(vscode, /^file3(-renamed)?\.txt/);

			await expect
				.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
				.toEqual({ kind: 'text', file: 'file3-renamed.txt', line: 11 });
		});
	}

	test('with the setting off, a file missing from the working tree opens at the compared revision', async ({
		vscode,
	}) => {
		await vscode.gitlens.executeCommand('gitlens.views.searchAndCompare.clear');
		await showComparison(vscode, 'feature', 'other');
		await expandItem(vscode, /files changed/);
		await clickFile(vscode, /^only-other\.txt/);

		// The revision document's path ends in the bare file name, so `file` is comparable to a working file's
		await expect
			.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
			.toEqual({ kind: 'text', file: 'only-other.txt', line: 0 });
	});

	// Neither name is in the working tree, so the click opens the compared revision — under the name the file has
	// there, which is the side the diff runs to
	for (const [ref1, ref2, file] of [
		['other', 'renamed', 'only-other.txt'],
		['renamed', 'other', 'only-other-renamed.txt'],
	]) {
		test(`with the setting off, a renamed file missing from the working tree compared ${ref1} with ${ref2} opens at the compared revision`, async ({
			vscode,
		}) => {
			await vscode.gitlens.executeCommand('gitlens.views.searchAndCompare.clear');
			await showComparison(vscode, ref1, ref2);
			await expandItem(vscode, /^1 file changed/);
			await clickFile(vscode, /^only-other(-renamed)?\.txt/);

			await expect
				.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
				.toEqual({ kind: 'text', file: file, line: 2 });
		});
	}

	test("with the setting off, a renamed file missing from the working tree in a commit's file list opens at that commit", async ({
		vscode,
	}) => {
		// The comparison of `renamed` with `other` from the previous test stays up; the rename commit is its one behind
		await expandItem(vscode, /^(Ahead|Behind) 1 commit/);
		await expandItem(vscode, /Rename only-other and change line 3/);
		await clickFile(vscode, /^only-other-renamed\.txt/);

		await expect
			.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
			.toEqual({ kind: 'text', file: 'only-other-renamed.txt', line: 2 });
	});

	// The row names the file by the side the diff runs to, and its inline action must open that side — the other side
	// has the file under its old name. Hover rather than click: a click is the open-on-click flow under test above
	for (const [ref1, ref2, file] of [
		['other', 'renamed', 'only-other.txt'],
		['renamed', 'other', 'only-other-renamed.txt'],
	]) {
		test(`Open File at Revision on a renamed file compared ${ref1} with ${ref2} opens the revision that has it`, async ({
			vscode,
		}) => {
			await vscode.gitlens.executeCommand('gitlens.views.searchAndCompare.clear');
			await showComparison(vscode, ref1, ref2);
			await expandItem(vscode, /^1 file changed/);
			await vscode.gitlens.closeAllEditors();

			const row = treeItem(vscode, /^only-other(-renamed)?\.txt/);
			await expect(row).toBeVisible({ timeout: MaxTimeout });
			await row.hover();
			await row.getByRole('button', { name: /^Open File at Revision/ }).click();

			await expect
				.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
				.toEqual({ kind: 'text', file: file, line: 0 });
		});
	}

	// Back on the default: a rename row under the Ahead or Behind files node opens the rename diff, old name on the
	// left, whichever way that node's diff runs
	for (const [ref1, ref2, direction] of [
		['feature', 'main', 'Ahead'],
		['main', 'feature', 'Behind'],
	]) {
		test(`by default a renamed file under the ${direction} files node opens its rename diff`, async ({
			vscode,
		}) => {
			// Explicitly `true`: an `undefined` doesn't survive the evaluator's serialized boundary, so it wouldn't reset.
			// The view picks the change up asynchronously; rows built before that still open the working file
			await vscode.gitlens.updateSetting(openDiffOnClick, true);
			await vscode.page.waitForTimeout(DefaultTimeout);
			await vscode.gitlens.executeCommand('gitlens.views.searchAndCompare.clear');
			await showComparison(vscode, ref1, ref2);
			await expandItem(vscode, new RegExp(`^${direction} 3 commits`));
			await expandItem(vscode, /files changed/, 3);
			await clickFile(vscode, /^file3-renamed\.txt/, 4);

			await expect
				.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
				.toEqual({ kind: 'diff', file: 'file3-renamed.txt', original: 'file3.txt' });
		});
	}
});

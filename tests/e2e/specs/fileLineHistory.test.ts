import { execFileSync } from 'node:child_process';
import * as process from 'node:process';
import type { Locator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { withoutSignInSecrets } from '../fixtures/gkSignIn.js';

const alice = { name: 'Alice History', email: 'alice@example.com' };
const bob = { name: 'Bob History', email: 'bob@example.com' };

const historyFile = 'history.txt';
const unrelatedFile = 'unrelated.txt';
const beforeRenameFile = 'before.txt';
const afterRenameFile = 'after.txt';
const separatorFile = 'separator.txt';

const separatorMessage = 'Change separator file\n\nbefore \x1e after';

const followRenames = 'gitlens.advanced.fileHistoryFollowsRenames';

const viewTimeout = MaxTimeout * 3;

let repoPath: string;

function lines(file: string, changed: Record<number, string> = {}): string {
	return `${Array.from({ length: 10 }, (_, i) => `${file} line ${i + 1}${changed[i + 1] ? ` ${changed[i + 1]}` : ''}`).join('\n')}\n`;
}

async function setAuthor(git: GitFixture, author: { name: string; email: string }): Promise<void> {
	await git.config('user.name', author.name);
	await git.config('user.email', author.email);
}

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			userSettings: {
				'workbench.editor.restoreViewState': false,
				// oxlint-disable-next-line no-template-curly-in-string -- `${message}` is a GitLens format token, not an interpolation
				'gitlens.views.formats.commits.label': '${message}',
			},
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				await setAuthor(git, alice);
				await git.commit('Add history fixture', historyFile, lines(historyFile), {
					date: '2024-01-10T12:00:00',
				});
				await setAuthor(git, bob);
				await git.commit('Change line 3', historyFile, lines(historyFile, { 3: 'by bob' }), {
					date: '2024-02-20T12:00:00',
				});
				await setAuthor(git, alice);
				await git.commit('Change line 7', historyFile, lines(historyFile, { 3: 'by bob', 7: 'by alice' }), {
					date: '2024-03-15T12:00:00',
				});
				await git.commit('Add unrelated file', unrelatedFile, lines(unrelatedFile), {
					date: '2024-03-20T12:00:00',
				});

				await git.commit('Add file before rename', beforeRenameFile, lines(beforeRenameFile), {
					date: '2024-04-01T12:00:00',
				});
				await git.move(beforeRenameFile, afterRenameFile);
				await git.commit('Rename before to after', afterRenameFile, lines(beforeRenameFile, { 2: 'renamed' }), {
					date: '2024-04-10T12:00:00',
				});
				await git.commit(
					'Edit after rename',
					afterRenameFile,
					lines(beforeRenameFile, { 2: 'renamed', 4: 'edited' }),
					{
						date: '2024-04-20T12:00:00',
					},
				);

				await git.commit('Add separator file', separatorFile, lines(separatorFile), {
					date: '2024-05-01T12:00:00',
				});
				await git.commit(separatorMessage, separatorFile, lines(separatorFile, { 2: 'separated' }), {
					date: '2024-05-10T12:00:00',
				});
				await git.commit(
					'Change separator file again',
					separatorFile,
					lines(separatorFile, { 2: 'separated', 3: 'again' }),
					{
						date: '2024-05-20T12:00:00',
					},
				);

				repoPath = repoDir;
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

function gitLines(...args: string[]): string[] {
	return execFileSync('git', args, {
		cwd: repoPath,
		encoding: 'utf8',
		env: { ...withoutSignInSecrets(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
	})
		.split('\n')
		.map(l => l.trim())
		.filter(Boolean);
}

function fileHistorySubjects(file: string, options?: { follow?: boolean }): string[] {
	return gitLines('log', ...(options?.follow === false ? [] : ['--follow']), '--format=%s', '--', file);
}

function lineHistorySubjects(file: string, line: number): string[] {
	return gitLines('log', `-L${line},${line}:${file}`, '--no-patch', '--format=%s');
}

function sha(subject: string): string {
	const found = gitLines('log', '--all', '--format=%H %s').filter(l => l.slice(41) === subject);
	if (found.length !== 1) throw new Error(`Expected one commit with subject "${subject}", found ${found.length}`);

	return found[0].slice(0, 40);
}

async function rowMessages(tree: Locator): Promise<string[]> {
	const labels = await tree.getByRole('treeitem').locator('.label-name').allInnerTexts();
	// KEEP: compare subjects only — a multi-line message's label ends with ` …`
	return labels.map(l => l.replace(/\s*…$/, '').trim());
}

async function showFileHistory(vscode: VSCodeInstance, file: string): Promise<Locator> {
	await vscode.gitlens.showFileAtLine(file, 0);
	await vscode.gitlens.showFileHistoryView();
	await expect(vscode.gitlens.fileHistoryViewTreeView).toBeVisible({ timeout: MaxTimeout });
	return vscode.gitlens.fileHistoryViewTreeView;
}

async function showLineHistory(vscode: VSCodeInstance, file: string, line: number): Promise<Locator> {
	await vscode.gitlens.showFileAtLine(file, line - 1);
	await vscode.gitlens.showLineHistoryView();
	await expect(vscode.gitlens.lineHistoryViewTreeView).toBeVisible({ timeout: MaxTimeout });
	// KEEP: re-focus the editor after showing the view, or the cursor isn't followed
	await vscode.gitlens.showFileAtLine(file, line - 1);
	return vscode.gitlens.lineHistoryViewTreeView;
}

test.describe('File History and Line History', () => {
	test.describe.configure({ mode: 'serial' });

	test.afterAll(async ({ vscode }) => {
		await vscode.gitlens.updateSetting(followRenames, undefined);
	});

	test('File History lists exactly the commits git logs for the file, newest first', async ({ vscode }) => {
		const expected = fileHistorySubjects(historyFile);
		expect(expected).toEqual(['Change line 7', 'Change line 3', 'Add history fixture']);

		const tree = await showFileHistory(vscode, historyFile);
		await expect.poll(() => rowMessages(tree), { timeout: viewTimeout }).toEqual(expected);
	});

	test('a click on a File History row opens its changes with the previous revision', async ({ vscode }) => {
		const tree = await showFileHistory(vscode, historyFile);
		await expect.poll(() => rowMessages(tree), { timeout: viewTimeout }).toEqual(fileHistorySubjects(historyFile));
		await tree.getByRole('treeitem').filter({ hasText: 'Change line 3' }).first().click();

		await expect
			.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: viewTimeout })
			.toEqual({ kind: 'diff', file: historyFile, original: historyFile });

		const modified = sha('Change line 3');
		const [parent] = gitLines('rev-parse', `${modified}^`);
		expect(parent).toBe(sha('Add history fixture'));
		expect(await vscode.gitlens.getActiveGitLensDiffRefs()).toEqual({ original: parent, modified: modified });
	});

	test('File History follows a rename by default and stops at it when following is off', async ({ vscode }) => {
		const followed = fileHistorySubjects(afterRenameFile);
		const unfollowed = fileHistorySubjects(afterRenameFile, { follow: false });
		expect(followed).toEqual(['Edit after rename', 'Rename before to after', 'Add file before rename']);
		expect(unfollowed).toEqual(['Edit after rename', 'Rename before to after']);

		const tree = await showFileHistory(vscode, afterRenameFile);
		await expect.poll(() => rowMessages(tree), { timeout: viewTimeout }).toEqual(followed);

		await vscode.gitlens.updateSetting(followRenames, false);
		await expect.poll(() => rowMessages(tree), { timeout: viewTimeout }).toEqual(unfollowed);

		await vscode.gitlens.updateSetting(followRenames, undefined);
		await expect.poll(() => rowMessages(tree), { timeout: viewTimeout }).toEqual(followed);
	});

	test('Line History lists exactly the commits git logs for the line, and follows the cursor', async ({ vscode }) => {
		const line3 = lineHistorySubjects(historyFile, 3);
		const line7 = lineHistorySubjects(historyFile, 7);
		const line5 = lineHistorySubjects(historyFile, 5);
		expect(line3).toEqual(['Change line 3', 'Add history fixture']);
		expect(line7).toEqual(['Change line 7', 'Add history fixture']);
		expect(line5).toEqual(['Add history fixture']);

		const tree = await showLineHistory(vscode, historyFile, 3);
		await expect.poll(() => rowMessages(tree), { timeout: viewTimeout }).toEqual(line3);

		await vscode.gitlens.showFileAtLine(historyFile, 6);
		await expect.poll(() => rowMessages(tree), { timeout: viewTimeout }).toEqual(line7);

		await vscode.gitlens.showFileAtLine(historyFile, 4);
		await expect.poll(() => rowMessages(tree), { timeout: viewTimeout }).toEqual(line5);
	});

	test('a record separator in a commit message keeps every commit in File History and Line History (#5659)', async ({
		vscode,
	}) => {
		expect(gitLines('log', '-1', '--format=%B', sha('Change separator file')).join('\n')).toContain('\x1e');

		const fileExpected = fileHistorySubjects(separatorFile);
		expect(fileExpected).toEqual(['Change separator file again', 'Change separator file', 'Add separator file']);
		const fileTree = await showFileHistory(vscode, separatorFile);
		await expect.poll(() => rowMessages(fileTree), { timeout: viewTimeout }).toEqual(fileExpected);

		const lineExpected = lineHistorySubjects(separatorFile, 2);
		expect(lineExpected).toEqual(['Change separator file', 'Add separator file']);
		const lineTree = await showLineHistory(vscode, separatorFile, 2);
		await expect.poll(() => rowMessages(lineTree), { timeout: viewTimeout }).toEqual(lineExpected);
	});
});

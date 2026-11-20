import { execFileSync } from 'node:child_process';
import * as process from 'node:process';
import type { Locator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { withoutSignInSecrets } from '../fixtures/gkSignIn.js';
import type { EditorCodeLens, FakeDocumentSymbol } from '../pageObjects/vscodePage.js';

const alice = { name: 'Alice Lens', email: 'alice@example.com' };
const bob = { name: 'Bob Lens', email: 'bob@example.com' };

const lensFile = 'lens.txt';
const scopesFile = 'scopes.txt';
const markdownFile = 'README.md';
const untrackedFile = 'untracked.txt';

// KEEP: Bob owns most lines — the authors lens names the top author first
const lensCommits = [
	{
		message: 'Add lens fixture',
		author: alice,
		date: '2024-01-10T12:00:00',
		lines: ['line one: alpha', 'line two: bravo', 'line three: charlie', 'line four: delta', 'line five: echo'],
	},
	{
		message: 'Update bravo, charlie and delta',
		author: bob,
		date: '2024-02-20T12:00:00',
		lines: [
			'line one: alpha',
			'line two: bravo by bob',
			'line three: charlie by bob',
			'line four: delta by bob',
			'line five: echo',
		],
	},
] as const;

const recentChangeCommand = 'gitlens.showQuickCommitFileDetails';
const authorsCommand = 'gitlens.toggleFileBlame:codelens';
const bobRecentChange = `${bob.name}, 2024-02-20`;
const lensAuthors = `authors (${bob.name} and one other)`;

const markdown = ['# Title', '', 'intro', '', '## Section A', '', 'alpha', '', '## Section B', '', 'bravo', ''];

const scopesLines = Array.from({ length: 12 }, (_, i) => `scopes line ${i + 1}`);
const symbols: FakeDocumentSymbol[] = [
	{
		name: 'Widget',
		kind: 'Class',
		startLine: 2,
		endLine: 7,
		children: [
			{ name: 'render', kind: 'Function', startLine: 3, endLine: 5 },
			{ name: 'id', kind: 'Function', startLine: 6, endLine: 6 },
		],
	},
	{ name: 'note', kind: 'String', startLine: 9, endLine: 10 },
];

function renderedLenses(vscode: VSCodeInstance): Locator {
	return vscode.page.locator('.monaco-editor .codelens-decoration').first();
}

function statusBarBlame(vscode: VSCodeInstance): Locator {
	return vscode.page.locator('[id="eamodio.gitlens.gitlens.blame"]');
}

function lines(lenses: EditorCodeLens[]): number[] {
	return [...new Set(lenses.map(l => l.line))];
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
				'gitlens.codeLens.enabled': true,
				'gitlens.codeLens.dateFormat': 'YYYY-MM-DD',
				'gitlens.defaultDateStyle': 'absolute',
				'gitlens.defaultDateFormat': 'YYYY-MM-DD',
			},
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				execFileSync('git', ['init', '-b', 'main'], {
					cwd: repoDir,
					env: { ...withoutSignInSecrets(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
				});
				for (const commit of lensCommits) {
					await setAuthor(git, commit.author);
					await git.commit(commit.message, lensFile, `${commit.lines.join('\n')}\n`, { date: commit.date });
				}
				await setAuthor(git, alice);
				await git.commit('Add scopes fixture', scopesFile, `${scopesLines.join('\n')}\n`, {
					date: '2024-01-10T12:00:00',
				});
				await git.commit('Add readme', markdownFile, markdown.join('\n'), { date: '2024-01-10T12:00:00' });
				await git.createFile(untrackedFile, 'not committed\n');
				// KEEP: last user.name is neither fixture author, or their lenses read "You"
				await setAuthor(git, { name: 'Your Name', email: 'you@example.com' });
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Editor CodeLens', () => {
	test.describe.configure({ mode: 'serial' });

	let codeLensToggledOff = false;

	async function open(vscode: VSCodeInstance, file: string): Promise<void> {
		await vscode.gitlens.openFile(file);
		await expect(vscode.page.locator('.monaco-editor .view-lines').first()).toBeVisible({ timeout: MaxTimeout });
		// KEEP: wait for the document — `openFile` returns before it is open
		await expect(async () => {
			await vscode.gitlens.getCodeLenses(file);
		}).toPass({ timeout: MaxTimeout });
	}

	async function expectDocumentLenses(
		vscode: VSCodeInstance,
		file: string,
		recentChange: string | ReturnType<typeof expect.stringMatching>,
	): Promise<void> {
		await expect(async () => {
			expect(await vscode.gitlens.getCodeLenses(file)).toEqual([
				{ line: 0, title: recentChange, command: recentChangeCommand },
				{ line: 0, title: expect.stringMatching(/^authors? \(/), command: authorsCommand },
			]);
		}).toPass({ timeout: MaxTimeout });
	}

	test.afterEach(async ({ vscode }) => {
		if (codeLensToggledOff) {
			await vscode.gitlens.executeCommand('gitlens.toggleCodeLens');
			codeLensToggledOff = false;
		}
		await vscode.gitlens.unregisterDocumentSymbols();
		await vscode.gitlens.updateSetting('gitlens.codeLens.scopes', undefined);
		await vscode.gitlens.updateSetting('gitlens.codeLens.symbolScopes', undefined);
		await vscode.gitlens.updateSetting('gitlens.codeLens.includeSingleLineSymbols', undefined);
		await vscode.gitlens.executeCommand('workbench.action.files.revert').catch(() => {});
		await vscode.gitlens.executeCommand('gitlens.clearFileAnnotations');
		await vscode.gitlens.resetUI();
	});

	test('shows the recent change and authors of a committed file, and nothing on an untracked one', async ({
		vscode,
	}) => {
		await open(vscode, lensFile);
		await expect(async () => {
			expect(await vscode.gitlens.getCodeLenses(lensFile)).toEqual([
				{ line: 0, title: bobRecentChange, command: recentChangeCommand },
				{ line: 0, title: lensAuthors, command: authorsCommand },
			]);
		}).toPass({ timeout: MaxTimeout });

		// KEEP: after the positive above — an empty answer alone proves nothing
		await open(vscode, untrackedFile);
		for (let i = 0; i < 3; i++) {
			await vscode.page.waitForTimeout(1000);
			expect(await vscode.gitlens.getCodeLenses(untrackedFile)).toEqual([]);
		}
	});

	test('the toggle command removes the lenses and brings them back', async ({ vscode }) => {
		await open(vscode, lensFile);
		await expectDocumentLenses(vscode, lensFile, bobRecentChange);

		await vscode.gitlens.executeCommand('gitlens.toggleCodeLens');
		codeLensToggledOff = true;
		await expect.poll(async () => vscode.gitlens.getCodeLenses(lensFile), { timeout: MaxTimeout }).toEqual([]);

		await vscode.gitlens.executeCommand('gitlens.toggleCodeLens');
		codeLensToggledOff = false;
		await expectDocumentLenses(vscode, lensFile, bobRecentChange);
	});

	test('an unsaved document shows a placeholder lens until it goes idle, then blames the edit', async ({
		vscode,
	}) => {
		await open(vscode, lensFile);
		await expectDocumentLenses(vscode, lensFile, bobRecentChange);
		// KEEP: rendered before the edit, so the rendered check below proves a refresh
		await expect(renderedLenses(vscode)).toContainText(lensAuthors, { timeout: MaxTimeout });

		await vscode.gitlens.insertLine(lensFile, 1, 'line inserted: unsaved');
		// KEEP: poll well under `advanced.blame.delayAfterEdit` (5s), when the document goes idle
		await expect
			.poll(async () => vscode.gitlens.getCodeLenses(lensFile), { timeout: 2000 })
			.toEqual([{ line: 0, title: '$(ellipsis)', command: undefined }]);

		await expect(async () => {
			expect(await vscode.gitlens.getCodeLenses(lensFile)).toEqual([
				{ line: 0, title: expect.stringMatching(/^.+, \d{4}-\d{2}-\d{2}$/), command: recentChangeCommand },
				{ line: 0, title: expect.stringMatching(/^authors \(.+ and others\)$/), command: authorsCommand },
			]);
		}).toPass({ timeout: MaxTimeout * 2 });
		// KEEP: rendered check — the API query alone can't catch a lost refresh
		await expect(renderedLenses(vscode)).toContainText('and others', { timeout: MaxTimeout });
	});

	async function commitSavedChangeOutside(
		vscode: VSCodeInstance,
		name: string,
		cursorOnChange = false,
	): Promise<string> {
		// KEEP: a file per run (repeats share the worker); commit as the current user, never switch user.name here
		const file = `${name}-${test.info().repeatEachIndex}-${test.info().retry}.txt`;
		const changed = 'first\nsecond changed\n';
		const git = new GitFixture(vscode.electron.workspacePath);
		await git.commit('Add external fixture', file, 'first\nsecond\n', { date: '2024-01-10T12:00:00' });
		await git.createFile(file, changed);

		await open(vscode, file);
		await expect
			.poll(async () => (await vscode.gitlens.getCodeLenses(file))[0]?.title, { timeout: MaxTimeout })
			.toMatch(/^You, (?!2024-)/);
		await expect(renderedLenses(vscode)).toContainText('You, ', { timeout: MaxTimeout });
		if (cursorOnChange) {
			await vscode.page.locator('.monaco-editor .view-lines').first().click();
			await vscode.page.keyboard.press('Control+Home');
			await vscode.page.keyboard.press('ArrowDown');
			// KEEP: `\s` — the status bar renders a non-breaking space after the comma
			await expect(statusBarBlame(vscode)).toContainText(/You,\s(?!2024-)\d{4}-/, { timeout: MaxTimeout });
		}

		await git.commit('Commit the saved change', file, changed, { date: '2024-03-15T12:00:00' });
		return file;
	}

	test('follows a commit made outside the editor without reopening the file', async ({ vscode }) => {
		const file = await commitSavedChangeOutside(vscode, 'external');
		await expectDocumentLenses(vscode, file, 'You, 2024-03-15');
	});

	test('updates the status bar blame after a commit made outside the editor', async ({ vscode }) => {
		test.fail(true, 'The status bar blame keeps the uncommitted state until the cursor moves — #6256');

		// KEEP: skip unless setup and GitLens' own data are right — `test.fail` would count any failure as #6256
		const committed = await commitSavedChangeOutside(vscode, 'status', true)
			.then(async file => {
				await expect
					.poll(async () => (await vscode.gitlens.getCodeLenses(file))[0]?.title, { timeout: MaxTimeout })
					.toBe('You, 2024-03-15');
				return true;
			})
			.catch(() => false);
		test.skip(!committed, 'Setup failed or GitLens did not report the commit; the API test above shows why');

		await expect(statusBarBlame(vscode)).toContainText(/You,\s2024-03-15/, { timeout: MaxTimeout });
	});

	test('gives lenses to the symbols each scope setting selects', async ({ vscode }) => {
		await vscode.gitlens.registerDocumentSymbols(scopesFile, symbols);
		await open(vscode, scopesFile);

		const expectLines = async (expected: number[]): Promise<void> => {
			await expect
				.poll(async () => lines(await vscode.gitlens.getCodeLenses(scopesFile)), { timeout: MaxTimeout })
				.toEqual(expected);
		};

		await expectLines([0, 2]);

		await vscode.gitlens.updateSetting('gitlens.codeLens.scopes', ['document', 'containers', 'blocks']);
		await expectLines([0, 2, 3]);

		await vscode.gitlens.updateSetting('gitlens.codeLens.includeSingleLineSymbols', true);
		await expectLines([0, 2, 3, 6]);

		await vscode.gitlens.updateSetting('gitlens.codeLens.scopes', undefined);
		await vscode.gitlens.updateSetting('gitlens.codeLens.includeSingleLineSymbols', undefined);
		await vscode.gitlens.updateSetting('gitlens.codeLens.symbolScopes', ['string', '!class']);
		await expectLines([0, 9]);
	});

	test('renders the lenses and runs the authors command when clicked', async ({ vscode }) => {
		await open(vscode, lensFile);
		await expectDocumentLenses(vscode, lensFile, bobRecentChange);

		const decoration = renderedLenses(vscode);
		await expect(decoration).toContainText(bobRecentChange, { timeout: MaxTimeout });
		await expect(decoration).toContainText(lensAuthors);

		await decoration.getByText(lensAuthors).click();
		await expect
			.poll(async () => vscode.gitlens.hasBlameAnnotations('Update bravo, charlie and delta'), {
				timeout: MaxTimeout,
			})
			.toBe(true);
	});

	test('gives lenses to Markdown headers with the default scopes', async ({ vscode }) => {
		test.fail(true, 'Markdown headers get no lenses with default settings — #6253');

		await open(vscode, markdownFile);
		// KEEP: skip without header symbols — `test.fail` would count any failure as #6253
		const headersReported = await expect
			.poll(async () => vscode.gitlens.getDocumentSymbolLines(markdownFile), { timeout: MaxTimeout * 3 })
			.toEqual([0, 4, 8])
			.then(
				() => true,
				() => false,
			);
		test.skip(!headersReported, 'The editor reported no Markdown header symbols');

		await expect
			.poll(async () => lines(await vscode.gitlens.getCodeLenses(markdownFile)), { timeout: MaxTimeout })
			.toEqual([0, 4, 8]);
	});
});

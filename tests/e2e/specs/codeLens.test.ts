/**
 * Editor CodeLens E2E Tests
 *
 * Covers what only a running editor shows: GitLens' CodeLens reaching an open document (resolved
 * titles and commands), the toggle command, the unsaved-document lens and its recovery once the
 * document goes idle, the lens following a commit made outside the editor, which symbols get a lens
 * for each scope setting, and the rendered lens running its command when clicked. Symbols come from
 * a fake provider registered for one file, so scope checks don't depend on a language server.
 */
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

// Bob owns three of the five lines, so he is the first author the authors lens names
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
// The CodeLens variant of the setting's `gitlens.toggleFileBlame`
const authorsCommand = 'gitlens.toggleFileBlame:codelens';
const bobRecentChange = `${bob.name}, 2024-02-20`;
const lensAuthors = `authors (${bob.name} and one other)`;

// Lines 0, 4 and 8 carry headers
const markdown = ['# Title', '', 'intro', '', '## Section A', '', 'alpha', '', '## Section B', '', 'bravo', ''];

// A container with a multi-line and a single-line block inside, and a multi-line String after it
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

const defaultScopes = ['document', 'containers'];

/** The lens row the editor rendered above the first line */
function renderedLenses(vscode: VSCodeInstance): Locator {
	return vscode.page.locator('.monaco-editor .codelens-decoration').first();
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
				// "You" is whoever the repo's config names last — neither fixture author
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
		// `openFile` doesn't wait for the document itself; the lens query throws until it is open
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
		await vscode.gitlens.updateSetting('gitlens.codeLens.scopes', defaultScopes);
		await vscode.gitlens.updateSetting('gitlens.codeLens.symbolScopes', []);
		await vscode.gitlens.updateSetting('gitlens.codeLens.includeSingleLineSymbols', false);
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

		// Lenses are being provided (above), so an empty answer here means GitLens skipped the file
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

		await vscode.gitlens.insertLine(lensFile, 1, 'line inserted: unsaved');
		// Well inside the window: the document goes idle `gitlens.advanced.blame.delayAfterEdit` (5s) after the edit
		await expect
			.poll(async () => vscode.gitlens.getCodeLenses(lensFile), { timeout: 2000 })
			.toEqual([{ line: 0, title: '$(ellipsis)', command: undefined }]);

		// Once idle, the lenses blame the edited contents: the unsaved line counts as a third author
		await expect(async () => {
			expect(await vscode.gitlens.getCodeLenses(lensFile)).toEqual([
				{ line: 0, title: expect.stringMatching(/^.+, \d{4}-\d{2}-\d{2}$/), command: recentChangeCommand },
				{ line: 0, title: expect.stringMatching(/^authors \(.+ and others\)$/), command: authorsCommand },
			]);
		}).toPass({ timeout: MaxTimeout * 2 });
		// The query above asks the provider afresh; the editor only re-renders if GitLens signals the change
		await expect(renderedLenses(vscode)).toContainText('and others', { timeout: MaxTimeout });
	});

	test('follows a commit made outside the editor without reopening the file', async ({ vscode }) => {
		// A file of its own per run, so repeats and retries start from the same history. Committed as the
		// repo's current user, so the author reads "You" throughout and only the date tells commits apart
		const file = `external-${test.info().repeatEachIndex}-${test.info().retry}.txt`;
		const git = new GitFixture(vscode.electron.workspacePath);
		await git.commit('Add external fixture', file, 'first\nsecond\n', { date: '2024-01-10T12:00:00' });

		await open(vscode, file);
		await expectDocumentLenses(vscode, file, 'You, 2024-01-10');

		await git.commit('Change second outside the editor', file, 'first\nsecond changed\n', {
			date: '2024-03-15T12:00:00',
		});
		await expectDocumentLenses(vscode, file, 'You, 2024-03-15');
		// The query above asks the provider afresh; the editor only re-renders if GitLens signals the change
		await expect(renderedLenses(vscode)).toContainText('You, 2024-03-15', { timeout: MaxTimeout });
	});

	test('gives lenses to the symbols each scope setting selects', async ({ vscode }) => {
		await vscode.gitlens.registerDocumentSymbols(scopesFile, symbols);
		await open(vscode, scopesFile);

		const expectLines = async (expected: number[]): Promise<void> => {
			await expect
				.poll(async () => lines(await vscode.gitlens.getCodeLenses(scopesFile)), { timeout: MaxTimeout })
				.toEqual(expected);
		};

		// Defaults (document, containers): the document and the multi-line class
		await expectLines([0, 2]);

		// Blocks add the multi-line function, but not the single-line one
		await vscode.gitlens.updateSetting('gitlens.codeLens.scopes', ['document', 'containers', 'blocks']);
		await expectLines([0, 2, 3]);

		await vscode.gitlens.updateSetting('gitlens.codeLens.includeSingleLineSymbols', true);
		await expectLines([0, 2, 3, 6]);

		// Symbol scopes add a kind no scope covers, and `!kind` removes one a scope would add
		await vscode.gitlens.updateSetting('gitlens.codeLens.scopes', defaultScopes);
		await vscode.gitlens.updateSetting('gitlens.codeLens.includeSingleLineSymbols', false);
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
		// The built-in Markdown support reports headers once it has started. Without them the check below
		// can't fail for the reason #6253 describes, so skip instead of counting as the expected failure
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

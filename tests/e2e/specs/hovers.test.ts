import { execFileSync } from 'node:child_process';
import * as process from 'node:process';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { withoutSignInSecrets } from '../fixtures/gkSignIn.js';
import type { EditorHoverContent } from '../pageObjects/vscodePage.js';

const file = 'hover.txt';
const alice = { name: 'Alice Hover', email: 'alice@example.com' };
const bob = { name: 'Bob Hover', email: 'bob@example.com' };

const hostileMessage = 'Harden charlie [run](command:workbench.action.quickOpen) ![pic](https://example.invalid/x.png)';

const commits = [
	{
		message: 'Add hover fixture',
		author: alice,
		date: '2024-01-15T12:00:00',
		lines: ['line one: alpha', 'line two: bravo', 'line three: charlie', 'line four: delta', 'line five: echo'],
	},
	{
		message: 'Update bravo and delta',
		author: bob,
		date: '2024-02-20T12:00:00',
		lines: [
			'line one: alpha',
			'line two: bravo by bob',
			'line three: charlie',
			'line four: delta by bob',
			'line five: echo',
		],
	},
	{
		message: 'Rework echo line',
		author: alice,
		date: '2024-03-25T12:00:00',
		lines: [
			'line one: alpha',
			'line two: bravo by bob',
			'line three: charlie',
			'line four: delta by bob',
			'line five: echo again',
		],
	},
	{
		message: hostileMessage,
		author: bob,
		date: '2024-04-10T12:00:00',
		lines: [
			'line one: alpha',
			'line two: bravo by bob',
			'line three: charlie hardened',
			'line four: delta by bob',
			'line five: echo again',
		],
	},
] as const;

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			userSettings: {
				'gitlens.hovers.avatars': false,
				'gitlens.blame.avatars': false,
				'gitlens.defaultDateFormat': 'YYYY-MM-DD',
			},
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				execFileSync('git', ['init', '-b', 'main'], {
					cwd: repoDir,
					env: { ...withoutSignInSecrets(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
				});
				for (const commit of commits) {
					await git.config('user.name', commit.author.name);
					await git.config('user.email', commit.author.email);
					await git.commit(commit.message, file, `${commit.lines.join('\n')}\n`, { date: commit.date });
				}
				await git.config('user.name', 'Your Name');
				await git.config('user.email', 'you@example.com');
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

function isDetails(markdown: EditorHoverContent): boolean {
	return markdown.value.includes('$(history)');
}

function isChanges(markdown: EditorHoverContent): boolean {
	return markdown.value.startsWith('```diff');
}

function gitLensMarkdown(hovers: EditorHoverContent[][]): EditorHoverContent[] {
	return hovers.flat().filter(m => isDetails(m) || isChanges(m));
}

function expectOnlyTrustedCommandLinks(hovers: EditorHoverContent[][]): void {
	for (const markdown of gitLensMarkdown(hovers)) {
		expect(Array.isArray(markdown.trustedCommands)).toBe(true);
		const links = commandLinks(markdown.value);
		expect(links.length).toBeGreaterThan(0);
		for (const { command } of links) {
			expect(markdown.trustedCommands, `command link ${command}`).toContain(command);
		}
	}
}

function commandLinks(value: string): { command: string; args: string }[] {
	return Array.from(value.matchAll(/\]\(command:([^?)\s]+)\??([^)\s]*)/g), m => ({ command: m[1], args: m[2] }));
}

test.describe('Editor Hovers', () => {
	test.describe.configure({ mode: 'serial' });

	let lineBlameToggled = false;
	let shas: Record<(typeof commits)[number]['message'], string>;

	test.beforeAll(async ({ vscode }) => {
		const git = new GitFixture(vscode.electron.workspacePath);
		shas = Object.fromEntries(
			await Promise.all(
				commits.map(async (c, i) => [c.message, await git.getSha(`HEAD~${commits.length - 1 - i}`)]),
			),
		);
	});

	test.beforeEach(async ({ vscode }) => {
		await vscode.gitlens.openFile(file);
		await expect(vscode.page.locator('.monaco-editor .view-lines').first()).toBeVisible({ timeout: MaxTimeout });
	});

	test.afterEach(async ({ vscode }) => {
		if (lineBlameToggled) {
			await vscode.gitlens.executeCommand('gitlens.toggleLineBlame');
			lineBlameToggled = false;
		}
		await vscode.gitlens.executeCommand('workbench.action.files.revert');
		await vscode.gitlens.executeCommand('gitlens.clearFileAnnotations');
		await vscode.gitlens.updateSetting('gitlens.hovers.currentLine.over', undefined);
		await vscode.gitlens.resetUI();
	});

	async function expectDetails(
		vscode: VSCodeInstance,
		line: number,
		character: number | 'end',
		expected: string[],
		cursorLine: number = line,
	): Promise<EditorHoverContent[][]> {
		let hovers: EditorHoverContent[][] = [];
		await expect(async () => {
			hovers = await vscode.gitlens.moveCursorAndGetHovers(file, line, character, cursorLine);
			const details = gitLensMarkdown(hovers).filter(isDetails);
			expect(details).toHaveLength(1);
			for (const text of expected) {
				expect(details[0].value).toContain(text);
			}
		}).toPass({ timeout: MaxTimeout });
		expectOnlyTrustedCommandLinks(hovers);
		return hovers;
	}

	test('shows the line commit details with only trusted command links', async ({ vscode }) => {
		await vscode.gitlens.updateSetting('gitlens.hovers.currentLine.over', 'line');

		const bobSha = shas['Update bravo and delta'];
		const bobHovers = await expectDetails(vscode, 1, 0, [
			`__[${bob.name}](mailto:${bob.email}`,
			'Update bravo and delta',
			`$(git-commit) ${bobSha.slice(0, 7)}`,
			'_(2024-02-20)_',
		]);
		const bobDetails = gitLensMarkdown(bobHovers).find(isDetails)!;
		expect(bobDetails.value).not.toContain(alice.name);

		const copySha = commandLinks(bobDetails.value).find(l => l.command === 'gitlens.copyShaToClipboard');
		expect(copySha).toBeDefined();
		expect((JSON.parse(decodeURIComponent(copySha!.args)) as { sha: string }).sha).toBe(bobSha);

		await expectDetails(vscode, 0, 0, [
			`__[${alice.name}](mailto:${alice.email}`,
			'Add hover fixture',
			`$(git-commit) ${shas['Add hover fixture'].slice(0, 7)}`,
			'_(2024-01-15)_',
		]);
	});

	test('answers at the end of the line only while the line annotation is on', async ({ vscode }) => {
		await expectDetails(vscode, 1, 'end', ['Update bravo and delta']);
		expect(gitLensMarkdown(await vscode.gitlens.moveCursorAndGetHovers(file, 1, 3))).toHaveLength(0);

		await vscode.gitlens.executeCommand('gitlens.toggleLineBlame');
		lineBlameToggled = true;
		await expect
			.poll(async () => gitLensMarkdown(await vscode.gitlens.moveCursorAndGetHovers(file, 1, 'end')).length, {
				timeout: MaxTimeout,
			})
			.toBe(0);

		await vscode.gitlens.executeCommand('gitlens.toggleLineBlame');
		lineBlameToggled = false;
		await expectDetails(vscode, 1, 'end', ['Update bravo and delta']);

		await vscode.gitlens.updateSetting('gitlens.hovers.currentLine.over', 'line');
		await expectDetails(vscode, 1, 3, ['Update bravo and delta']);
	});

	test('shows the line diff against the previous commit', async ({ vscode }) => {
		await vscode.gitlens.updateSetting('gitlens.hovers.currentLine.over', 'line');

		const changesOf = async (line: number) => {
			let changes: EditorHoverContent | undefined;
			await expect(async () => {
				changes = gitLensMarkdown(await vscode.gitlens.moveCursorAndGetHovers(file, line, 0)).find(isChanges);
				expect(changes).toBeDefined();
			}).toPass({ timeout: MaxTimeout });
			return changes!.value;
		};

		const modified = await changesOf(1);
		expect(modified).toContain('- line two: bravo\n+ line two: bravo by bob');
		expect(modified).toContain(
			`$(git-commit) ${shas['Add hover fixture'].slice(0, 7)}](command:gitlens.showQuickCommitDetails`,
		);
		expect(modified).toContain(
			`$(git-commit) ${shas['Update bravo and delta'].slice(0, 7)}](command:gitlens.showQuickCommitDetails`,
		);
		expect(commandLinks(modified).map(l => l.command)).toContain('gitlens.diffWith');

		const added = await changesOf(0);
		expect(added).toContain('+ line one: alpha');
		expect(added).toContain(`Changes added in [$(git-commit) ${shas['Add hover fixture'].slice(0, 7)}]`);
	});

	test('keeps the original commit for a line shifted by unsaved edits', async ({ vscode }) => {
		await vscode.gitlens.updateSetting('gitlens.hovers.currentLine.over', 'line');
		await expectDetails(vscode, 1, 0, ['Update bravo and delta']);

		await vscode.gitlens.insertText(file, 0, 0, 'inserted line\n');

		await expectDetails(vscode, 2, 0, [`__[${bob.name}]`, 'Update bravo and delta']);
		await expectDetails(vscode, 0, 0, ['Uncommitted changes']);

		await vscode.gitlens.executeCommand('workbench.action.files.revert');
		await expectDetails(vscode, 1, 0, ['Update bravo and delta']);
	});

	test('shows a single details hover on the cursor line while file blame is on', async ({ vscode }) => {
		await vscode.gitlens.updateSetting('gitlens.hovers.currentLine.over', 'line');
		const before = await expectDetails(vscode, 1, 0, ['Update bravo and delta']);
		expect(before.filter(h => gitLensMarkdown([h]).length > 0)).toHaveLength(2);

		await vscode.gitlens.toggleFileBlame();
		await expect(async () => {
			expect(await vscode.gitlens.hasBlameAnnotations('Update bravo and delta')).toBe(true);
		}).toPass({ timeout: MaxTimeout });

		let blameHovers: EditorHoverContent[][] = [];
		await expect(async () => {
			blameHovers = (await vscode.gitlens.moveCursorAndGetHovers(file, 1, 0)).filter(
				h => gitLensMarkdown([h]).length > 0,
			);
			expect(blameHovers).toHaveLength(1);
			const parts = gitLensMarkdown(blameHovers);
			expect(parts.filter(isDetails)).toHaveLength(1);
			expect(parts.filter(isChanges)).toHaveLength(1);
			expect(parts.find(isDetails)!.value).toContain('Update bravo and delta');
		}).toPass({ timeout: MaxTimeout });
		expectOnlyTrustedCommandLinks(blameHovers);

		await expectDetails(vscode, 4, 0, [`__[${alice.name}]`, 'Rework echo line'], 1);
	});

	test('renders the hover and opens the line changes from its link', async ({ vscode }) => {
		await vscode.gitlens.updateSetting('gitlens.hovers.currentLine.over', 'line');
		await expectDetails(vscode, 1, 0, ['Update bravo and delta']);

		await vscode.gitlens.showEditorHover();
		const hover = vscode.gitlens.editorHover.filter({ hasText: 'Update bravo and delta' });
		await expect(hover).toBeVisible({ timeout: MaxTimeout });
		await expect(hover).toContainText(bob.name);
		await expect(hover).toContainText('2024-02-20');

		await hover
			.locator('a[data-href^="command:gitlens.diffWith"][title="Open Changes with Previous Revision"]')
			.click();
		await expect
			.poll(() => vscode.gitlens.getActiveEditorState(), { timeout: MaxTimeout })
			.toMatchObject({ kind: 'diff', file: file, original: file });
		await expect
			.poll(() => vscode.gitlens.getActiveTabLabel(), { timeout: MaxTimeout })
			.toBe(
				`${file} (${shas['Add hover fixture'].slice(0, 7)}) ⟷ ${file} (${shas['Update bravo and delta'].slice(0, 7)})`,
			);
	});

	test('renders command links and images in a commit message as plain text', async ({ vscode }) => {
		await vscode.gitlens.updateSetting('gitlens.hovers.currentLine.over', 'line');
		const hovers = await expectDetails(vscode, 2, 0, ['Harden charlie']);
		for (const markdown of gitLensMarkdown(hovers)) {
			expect(commandLinks(markdown.value).map(l => l.command)).not.toContain('workbench.action.quickOpen');
		}

		await vscode.gitlens.showEditorHover();
		const hover = vscode.gitlens.editorHover.filter({ hasText: 'Harden charlie' });
		await expect(hover).toBeVisible({ timeout: MaxTimeout });
		await expect(hover).toContainText('(command:workbench.action.quickOpen)');
		await expect(hover.locator('a[data-href*="workbench.action.quickOpen"]')).toHaveCount(0);
		await expect(hover.locator('img')).toHaveCount(0);
	});
});

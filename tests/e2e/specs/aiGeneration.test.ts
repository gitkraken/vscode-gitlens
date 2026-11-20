import * as process from 'node:process';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import {
	clearAIResponses,
	createRepoWithStagedAndUnstagedChanges,
	getLastAIPrompt,
	queueAIResponse,
	setAISimulatorModeAndClearResponses,
	stagedMarker,
	startAISimulation,
	unique,
	unstagedMarker,
} from '../helpers/aiSimulator.js';

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: () => createRepoWithStagedAndUnstagedChanges({ baseCommit: true }),
		},
		{ scope: 'worker' },
	],
});

function getExplainDocuments(vscode: VSCodeInstance): Promise<{ viewType?: string; text: string }[]> {
	return vscode.gitlens.getDocumentsInTabs('gitlens-ai-markdown');
}

test.describe('AI generation under the simulator', () => {
	test.describe.configure({ mode: 'serial' });

	let repoPath: string;
	let git: GitFixture;
	let simulation: AsyncDisposable | undefined;

	test.beforeAll(async ({ vscode }) => {
		repoPath = vscode.electron.workspacePath;
		git = new GitFixture(repoPath);
		simulation = await startAISimulation(vscode);
		await expect.poll(() => vscode.gitlens.getScmInputBoxValue(repoPath), { timeout: MaxTimeout }).toBe('');
	});

	test.afterAll(async ({ vscode }) => {
		try {
			await simulation?.[Symbol.asyncDispose]();
		} finally {
			await vscode.gitlens.resetUI();
		}
	});

	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.executeCommand('workbench.action.closeQuickOpen');
		await clearAIResponses(vscode);
		await vscode.gitlens.setScmInputBoxValue(repoPath, '');
		await vscode.gitlens.resetUI();
	});

	test('generated commit message is appended to the SCM input below the message already there', async ({
		vscode,
	}) => {
		const summary = unique('Commit summary');
		const body = unique('Commit body');
		await vscode.gitlens.setScmInputBoxValue(repoPath, 'Context line');
		await queueAIResponse(vscode, 'generate-commitMessage', `<summary>${summary}</summary><body>${body}</body>`);

		await vscode.gitlens.executeCommand('gitlens.ai.generateCommitMessage', { repoPath: repoPath });

		await expect
			.poll(async () => (await vscode.gitlens.getScmInputBoxValue(repoPath))?.replaceAll('\r\n', '\n'))
			.toBe(`Context line\n\n${summary}\n\n${body}`);
		const prompt = await getLastAIPrompt(vscode);
		expect(prompt).toContain(stagedMarker);
		expect(prompt).not.toContain(unstagedMarker);
		expect(prompt).toMatch(/<~~additional-context~~>\s*Context line\s*<\/~~additional-context~~>/);
	});

	test('a failing model leaves the SCM input as it was and reports the error', async ({ vscode }) => {
		await vscode.gitlens.setScmInputBoxValue(repoPath, 'Context line');
		await setAISimulatorModeAndClearResponses(vscode, 'provider-error');
		try {
			await vscode.gitlens.executeCommand('gitlens.ai.generateCommitMessage', { repoPath: repoPath });

			await expect(
				vscode.page.locator('.notifications-toasts .notification-list-item-message', {
					hasText: "You've reached your credit limit",
				}),
			).toBeVisible({ timeout: MaxTimeout });
			expect(await vscode.gitlens.getScmInputBoxValue(repoPath)).toBe('Context line');
		} finally {
			await setAISimulatorModeAndClearResponses(vscode, 'default');
		}
	});

	test('explaining a commit opens a Markdown preview with the explanation under the commit', async ({ vscode }) => {
		const summary = unique('Explain summary');
		const body = unique('Explain body');
		const sha = await git.getSha();
		const shortSha = await git.getShortSha();
		await queueAIResponse(vscode, 'explain-changes', `<summary>${summary}</summary><body>${body}</body>`);

		await vscode.gitlens.executeCommand('gitlens.ai.explainCommit', { repoPath: repoPath, rev: sha });

		await expect
			.poll(async () => (await getExplainDocuments(vscode)).find(d => d.text.includes(body)))
			.toMatchObject({ viewType: 'vscode.markdown.preview.editor' });
		const [document] = (await getExplainDocuments(vscode)).filter(d => d.text.includes(body));
		expect(document.text).toMatch(/^# Commit Summary\n/);
		expect(document.text).toContain(`## Add beta (${shortSha})`);
		expect(document.text).toContain(`${summary}\n\n${body}`);
		expect(document.text).not.toContain('Generating explanation');

		const prompt = await getLastAIPrompt(vscode);
		expect(prompt).toContain('Add beta');
		expect(prompt).toContain('+export const beta = 1;');
		expect(prompt).not.toContain('Add alpha');
	});

	test('explaining working changes opens a Markdown preview with the explanation', async ({ vscode }) => {
		const summary = unique('Explain WIP summary');
		const body = unique('Explain WIP body');
		await queueAIResponse(vscode, 'explain-changes', `<summary>${summary}</summary><body>${body}</body>`);

		await vscode.gitlens.executeCommand('gitlens.ai.explainWip', { repoPath: repoPath });

		await expect
			.poll(async () => (await getExplainDocuments(vscode)).find(d => d.text.includes(body)))
			.toMatchObject({ viewType: 'vscode.markdown.preview.editor' });
		const [document] = (await getExplainDocuments(vscode)).filter(d => d.text.includes(body));
		expect(document.text).toMatch(/^# Working Changes Summary\n/);
		expect(document.text).toContain(`${summary}\n\n${body}`);
		expect(document.text).not.toContain('Generating explanation');

		const prompt = await getLastAIPrompt(vscode);
		expect(prompt).toContain(stagedMarker);
		expect(prompt).toContain(unstagedMarker);
	});

	test('a changelog for a range opens with the commits counted and the generated entries', async ({ vscode }) => {
		const entries = unique('### Added\n- Changelog entry');
		const baseSha = await git.getSha('HEAD~2');
		const baseShortSha = await git.getShortSha('HEAD~2');
		await queueAIResponse(vscode, 'generate-changelog', entries);

		await vscode.gitlens.executeCommand('gitlens.ai.generateChangelog', {
			repoPath: repoPath,
			head: { refType: 'branch', name: 'main', ref: 'main', remote: false, repoPath: repoPath },
			base: { refType: 'revision', name: baseShortSha, ref: baseSha, sha: baseSha, repoPath: repoPath },
		});

		try {
			await expect.poll(() => vscode.gitlens.getActiveEditorText()).toContain(entries);
			const text = await vscode.gitlens.getActiveEditorText();
			expect(text).toMatch(/^# Changelog for `main`\n/);
			expect(text).toContain(`from 2 commits between \`main\` and \`${baseShortSha}\``);
			expect(text).toContain(`----\n\n${entries}\n`);

			const prompt = await getLastAIPrompt(vscode);
			expect(prompt).toContain('"message":"Add beta"');
			expect(prompt).toContain('"message":"Add alpha"');
			expect(prompt).not.toContain('Add base');
		} finally {
			// KEEP: discard the untitled changelog so closing editors can't stop on a save prompt
			await vscode.gitlens.executeCommand('workbench.action.focusActiveEditorGroup');
			await vscode.gitlens.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}
	});

	test('generating a stash message fills the message step with the summary only', async ({ vscode }) => {
		const summary = unique('Stash summary');
		const body = unique('Stash body');
		const statusBefore = await git.getStatusLines();
		await queueAIResponse(vscode, 'generate-stashMessage', `<summary>${summary}</summary><body>${body}</body>`);

		await vscode.gitlens.executeCommand('gitlens.gitCommands', {
			command: 'stash',
			state: { subcommand: 'push', repo: repoPath },
		});
		const quickPick = vscode.gitlens.quickPick;
		await quickPick.waitForPlaceholder(/Stash message/);

		await quickPick.locator.getByRole('button', { name: 'Generate Stash Message' }).click();

		await expect(quickPick.input).toHaveValue(summary, { timeout: MaxTimeout });
		const prompt = await getLastAIPrompt(vscode);
		expect(prompt).toContain(stagedMarker);
		expect(prompt).toContain(unstagedMarker);

		await vscode.page.keyboard.press('Escape');
		await quickPick.waitForHidden();
		expect(await git.getStatusLines()).toEqual(statusBefore);
	});
});

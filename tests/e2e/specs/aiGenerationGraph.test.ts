import * as process from 'node:process';
import type { FrameLocator, Locator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import {
	ensureGraphDetailsPanelOpenAndAdopted,
	waitForGraphRowsRendered,
	widenSideBarForGraph,
} from '../graphHelpers.js';
import {
	clearAIResponses,
	getLastAIPrompt,
	queueAIResponse,
	startAISimulation,
	unique,
} from '../helpers/aiSimulator.js';

const stagedMarker = 'alpha staged marker';
const unstagedMarker = 'beta unstaged marker';

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				await git.commit('Add alpha', 'alpha.ts', 'export const alpha = 1;\n', {
					date: '2024-01-11T12:00:00',
				});
				await git.commit('Add beta', 'beta.ts', 'export const beta = 1;\n', { date: '2024-01-12T12:00:00' });
				await git.addRemote('origin', 'https://example.com/test/ai-generation.git');

				await git.createFile('alpha.ts', `export const alpha = 1;\n// ${stagedMarker}\n`);
				await git.stage('alpha.ts');
				await git.createFile('beta.ts', `export const beta = 1;\n// ${unstagedMarker}\n`);

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

// HACK: keyboard, not a click — in a side-bar Graph the Welcome view can cover the panel's lower controls
async function pressButton(button: Locator): Promise<void> {
	await expect(button).toBeEnabled({ timeout: MaxTimeout });
	await button.press('Enter');
}

test.describe('Graph details AI results under the simulator', () => {
	test.describe.configure({ mode: 'serial' });
	test.setTimeout(120000);

	let graphWebview: FrameLocator;
	let vscodeInstance: VSCodeInstance;
	let simulation: AsyncDisposable | undefined;

	async function selectWip(): Promise<void> {
		await ensureGraphDetailsPanelOpenAndAdopted(vscodeInstance, graphWebview, MaxTimeout);

		const wipHeader = graphWebview.locator('gl-details-wip-header gl-details-header').first();
		if (await wipHeader.isVisible().catch(() => false)) return;

		const wipRow = graphWebview
			.getByRole('treeitem', { name: /Working Changes/ })
			.filter({ visible: true })
			.first();
		await expect(wipRow).toBeVisible({ timeout: MaxTimeout });
		// HACK: forced — the virtualized row can report "not stable"; the header check below catches a missed click
		await wipRow.click({ force: true });
		await ensureGraphDetailsPanelOpenAndAdopted(vscodeInstance, graphWebview, MaxTimeout);
		await expect(wipHeader).toBeVisible({ timeout: MaxTimeout });
	}

	async function discardComposePlan(): Promise<void> {
		await pressButton(
			graphWebview.locator('.compose-plan__action-row gl-button', { hasText: 'Discard' }).locator('button'),
		);
		await expect(graphWebview.locator('.compose-panel .compose-commit__message-content')).toHaveCount(0, {
			timeout: MaxTimeout,
		});
	}

	test.beforeAll(async ({ vscode }) => {
		test.skip(!(await vscode.gitlens.hasActivityBar()), 'Editor has no standard activity bar (e.g. Cursor)');
		vscodeInstance = vscode;

		simulation = await startAISimulation(vscode);

		await vscode.gitlens.showCommitGraphView();
		await widenSideBarForGraph(vscode);
		const webview = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 60000);
		expect(webview).not.toBeNull();
		graphWebview = webview!;
		await expect(graphWebview.getByRole('tree', { name: 'Commit graph' })).toBeVisible({ timeout: 30000 });
		await waitForGraphRowsRendered(graphWebview);
		// KEEP: longer first open — under a loaded host the panel's first layout outlasts the 10s toggle budget
		await ensureGraphDetailsPanelOpenAndAdopted(vscode, graphWebview, 30000);
	});

	test.afterAll(async ({ vscode }) => {
		await simulation?.[Symbol.asyncDispose]();
		await vscode.gitlens.resetUI();
	});

	test.beforeEach(async () => {
		await selectWip();
	});

	test.afterEach(async ({ vscode }) => {
		await clearAIResponses(vscode);
		const closeChip = graphWebview.locator('gl-action-chip.mode-close');
		if (await closeChip.isVisible().catch(() => false)) {
			await closeChip.click();
			await expect(
				graphWebview.locator('gl-details-wip-header gl-details-header .mode-header--active'),
			).not.toBeVisible({ timeout: MaxTimeout });
		}
		const message = graphWebview.locator('gl-commit-box textarea').first();
		if (await message.isVisible().catch(() => false)) {
			await message.fill('');
		}
	});

	test('the commit box sparkle replaces the typed message with the generated one', async () => {
		const summary = unique('Graph summary');
		const body = unique('Graph body');
		const message = graphWebview.locator('gl-commit-box textarea').first();
		await expect(message).toBeVisible({ timeout: MaxTimeout });
		await message.fill('Typed context');
		await queueAIResponse(
			vscodeInstance,
			'generate-commitMessage',
			`<summary>${summary}</summary><body>${body}</body>`,
		);

		await pressButton(
			graphWebview.locator('gl-commit-box gl-button.sparkle[aria-label="Generate Commit Message"] button'),
		);

		await expect(message).toHaveValue(`${summary}\n\n${body}`, { timeout: MaxTimeout });
		const prompt = await getLastAIPrompt(vscodeInstance);
		expect(prompt).toContain(stagedMarker);
		expect(prompt).not.toContain(unstagedMarker);
		expect(prompt).toMatch(/<~~additional-context~~>\s*Typed context\s*<\/~~additional-context~~>/);
	});

	test('a review shows the overview, focus area and finding the model returned', async () => {
		const overview = unique('Review overview');
		const label = unique('Review area');
		const rationale = unique('Review rationale');
		const title = unique('Review finding');
		await queueAIResponse(
			vscodeInstance,
			'review-changes',
			JSON.stringify({
				overview: overview,
				focusAreas: [
					{
						label: label,
						rationale: rationale,
						severity: 'warning',
						files: ['alpha.ts'],
						findings: [
							{
								severity: 'warning',
								title: title,
								description: 'Finding description',
								file: 'alpha.ts',
								lines: { start: 2, end: 2 },
							},
						],
					},
				],
			}),
		);

		await graphWebview.locator('gl-action-chip[icon="checklist"]').click();
		const runReview = graphWebview.locator('gl-ai-input.review-action-input').getByRole('button', {
			name: 'Review Diff',
		});
		await expect(runReview).toBeVisible({ timeout: MaxTimeout });
		await pressButton(runReview);

		const panel = graphWebview.locator('.review-panel');
		await expect(panel.locator('.review-overview__text')).toHaveText(overview, { timeout: MaxTimeout });
		await expect(panel.locator('.review-area__label')).toHaveText(label);
		await expect(panel).toContainText('1 finding open');

		const prompt = await getLastAIPrompt(vscodeInstance);
		expect(prompt).toContain(stagedMarker);
		expect(prompt).toContain(unstagedMarker);

		await expect(panel.locator('.review-area__header')).toHaveAttribute('aria-expanded', 'true');
		await expect(panel.locator('.review-area__rationale')).toHaveText(rationale);
		await expect(panel).toContainText(title);
	});

	test('compose under the simulator proposes one commit per changed file, newest first', async () => {
		await graphWebview.locator('gl-action-chip[icon="wand"]').click();
		const runCompose = graphWebview
			.locator('gl-ai-input[button-label="Compose"]')
			.getByRole('button', { name: 'Compose' });
		await expect(runCompose).toBeVisible({ timeout: MaxTimeout });
		await pressButton(runCompose);

		const messages = graphWebview.locator('.compose-panel .compose-commit__message-content');
		await expect(messages).toHaveCount(2, { timeout: MaxTimeout });
		await expect(messages).toHaveText(['(Simulator) Update beta.ts', '(Simulator) Update alpha.ts']);

		await discardComposePlan();
	});

	test('compose under the simulator follows a queued grouping and sweeps the remaining files into another commit', async () => {
		const message = unique('Compose alpha commit');
		await queueAIResponse(
			vscodeInstance,
			'generate-commits',
			JSON.stringify({ commits: [{ message: message, files: ['alpha.ts', 'missing.ts'] }] }),
		);

		await graphWebview.locator('gl-action-chip[icon="wand"]').click();
		const runCompose = graphWebview
			.locator('gl-ai-input[button-label="Compose"]')
			.getByRole('button', { name: 'Compose' });
		await expect(runCompose).toBeVisible({ timeout: MaxTimeout });
		await pressButton(runCompose);

		const messages = graphWebview.locator('.compose-panel .compose-commit__message-content');
		await expect(messages).toHaveCount(2, { timeout: MaxTimeout });
		await expect(messages).toHaveText(['(Simulator) Remaining changes', message]);

		await discardComposePlan();
	});
});

import { readFileSync, statSync } from 'node:fs';
import * as process from 'node:process';
import type { FrameLocator, Locator } from '@playwright/test';
import type { AccountStatus, SimulationState } from '../../../src/plus/gk/__debug__accountDebug.js';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { gitlensLogFiles } from '../fixtures/testRepository.js';
import {
	ensureGraphDetailsPanelOpen,
	graphDetailsRegion,
	waitForGraphRowsRendered,
	widenSideBarForGraph,
} from '../graphHelpers.js';

const partiallyStagedFile = 'notes.txt';
const committedFile = 'feature.ts';
const webviewTimeout = 30000;

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			logLevel: 'debug',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				await git.commit('Add notes', partiallyStagedFile, 'one\ntwo\nthree\nfour\nfive\n');
				await git.commit('Add feature', committedFile, 'export function feature() {\n\treturn 1;\n}\n');
				await git.addRemote('origin', 'https://example.com/test/cloud-patches.git');

				await git.createFile(partiallyStagedFile, 'ONE\ntwo\nthree\nfour\nfive\n');
				await git.stage(partiallyStagedFile);
				await git.createFile(partiallyStagedFile, 'ONE\ntwo\nthree\nfour\nFIVE\n');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe.configure({ mode: 'default' });

test.beforeEach(async ({ vscode }) => {
	test.skip(!(await vscode.gitlens.hasActivityBar()), 'Editor has no standard activity bar (e.g. Cursor)');
});

test.afterEach(async ({ vscode }) => {
	await vscode.gitlens.resetUI();
});

function getAccountStatus(vscode: VSCodeInstance): Promise<AccountStatus> {
	return vscode.gitlens.executeCommand<AccountStatus>('gitlens.plus.accountStatus');
}

async function expectState(vscode: VSCodeInstance, state: NonNullable<SimulationState['state']>): Promise<void> {
	expect((await getAccountStatus(vscode)).state).toBe(state);
}

async function simulate(
	vscode: VSCodeInstance,
	state: Exclude<SimulationState, { state: null }>,
): Promise<AsyncDisposable> {
	const simulation = await vscode.gitlens.startSubscriptionSimulation(state);
	try {
		await expectState(vscode, state.state);
	} catch (ex) {
		await simulation[Symbol.asyncDispose]();
		throw ex;
	}
	return simulation;
}

async function expectNoAccount(vscode: VSCodeInstance): Promise<void> {
	const status = await getAccountStatus(vscode);
	expect(status.signedIn, 'this spec must run signed out').toBe(false);
	expect(status.account).toBeUndefined();
}

async function getPatchWebview(vscode: VSCodeInstance): Promise<FrameLocator> {
	const webview = await vscode.gitlens.getGitLensWebview('Patch', 'webviewView', webviewTimeout);
	expect(webview, 'Patch webview not found').not.toBeNull();
	return webview!;
}

function fileRows(patchWebview: FrameLocator, fileName: string): Locator {
	return patchWebview
		.locator('gl-patch-create')
		.getByRole('treeitem', { name: new RegExp(fileName.replaceAll('.', String.raw`\.`)) });
}

function createButton(patchWebview: FrameLocator): Locator {
	return patchWebview.locator('gl-patch-create gl-button', { hasText: 'Create Cloud Patch' });
}

function createOutcomeToasts(vscode: VSCodeInstance): Locator {
	return vscode.page
		.locator('.notifications-toasts .notification-list-item-message')
		.filter({ hasText: /Cloud Patch|Unable to create draft/ });
}

function gitlensLogs(vscode: VSCodeInstance): string[] {
	const files = gitlensLogFiles(vscode.electron.args);
	expect(files, 'no GitLens log under the profile').toBeDefined();
	expect(files).not.toHaveLength(0);
	return files!;
}

const createDraftRpcLine = /\[RPC:host\(gitlens\.views\.patchDetails\|[^)]*\)\] call createDraft (completed|failed)/;

function logSizes(files: string[]): Map<string, number> {
	return new Map(files.map(f => [f, statSync(f).size]));
}

function logSince(marker: Map<string, number>): string[] {
	return [...marker].flatMap(([f, size]) => readFileSync(f).subarray(size).toString('utf8').split('\n'));
}

async function openCreateForm(vscode: VSCodeInstance): Promise<FrameLocator> {
	await vscode.gitlens.executeCommand('gitlens.createCloudPatch', { repoPath: vscode.electron.workspacePath });
	const patchWebview = await getPatchWebview(vscode);
	await expect(patchWebview.locator('#title')).toBeVisible({ timeout: webviewTimeout });
	await expect(fileRows(patchWebview, partiallyStagedFile)).toHaveCount(2, { timeout: MaxTimeout });
	return patchWebview;
}

async function clickCreate(vscode: VSCodeInstance, patchWebview: FrameLocator): Promise<void> {
	// SEE: Windsurf 1.1.3 raises an announcement toast over the Patch view mid-click (measured)
	await vscode.gitlens.executeCommand('notifications.clearAll');
	await createButton(patchWebview).click();
}

async function submitWithTitle(vscode: VSCodeInstance, patchWebview: FrameLocator, patchTitle: string): Promise<void> {
	const title = patchWebview.locator('#title');
	const form = patchWebview.locator('gl-patch-create');
	await form.evaluate((el: Element & { state?: unknown; stateBeforeTitle?: unknown }) => {
		el.stateBeforeTitle = el.state;
	});
	await title.fill(patchTitle);
	// KEEP: click only after the debounced title round-trips — a later state push would reset the button
	await expect
		.poll(
			() =>
				form.evaluate(
					(el: Element & { state?: unknown; stateBeforeTitle?: unknown }) => el.state !== el.stateBeforeTitle,
				),
			{ timeout: MaxTimeout },
		)
		.toBe(true);
	await expect(createButton(patchWebview)).toBeEnabled({ timeout: MaxTimeout });
	await clickCreate(vscode, patchWebview);
	await expect
		.poll(() => title.evaluate((el: HTMLInputElement) => el.validationMessage), { timeout: MaxTimeout })
		.toBe('');
	await expect(patchWebview.getByText('Check at least one change')).toHaveCount(0);
}

async function openGraphWip(vscode: VSCodeInstance): Promise<FrameLocator> {
	await vscode.gitlens.showCommitGraphView();
	await widenSideBarForGraph(vscode);

	const graphWebview = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', webviewTimeout);
	expect(graphWebview, 'Commit Graph webview not found').not.toBeNull();
	await expect(graphWebview!.getByRole('tree', { name: 'Commit graph' })).toBeVisible({ timeout: webviewTimeout });
	await waitForGraphRowsRendered(graphWebview!);

	const wipRow = graphWebview!
		.getByRole('treeitem', { name: /Working (Changes|Tree)/ })
		.filter({ visible: true })
		.first();
	await expect(wipRow).toBeVisible({ timeout: MaxTimeout });
	await wipRow.locator('.gl-graph__message-subject').first().click();

	await ensureGraphDetailsPanelOpen(graphWebview!, 15000);
	await expect(graphDetailsRegion(graphWebview!, 'wip')).toBeVisible({ timeout: 15000 });
	return graphWebview!;
}

test.describe('Cloud Patches — create from the Commit Graph', () => {
	test('A1: "Share as Cloud Patch" on working changes opens the create form with Unstaged and Staged changes', async ({
		vscode,
	}) => {
		await using _ = await simulate(vscode, { state: 6 /* Paid */, planId: 'pro', dismissOnboarding: true });

		const graphWebview = await openGraphWip(vscode);

		const shareChip = graphWebview.locator(
			'gl-details-wip-header gl-action-chip[icon="gl-cloud-patch-share"][label="Share as Cloud Patch"]',
		);
		await expect(shareChip).toBeInViewport({ timeout: MaxTimeout });
		await shareChip.click();

		const patchWebview = await getPatchWebview(vscode);
		const createForm = patchWebview.locator('gl-patch-create');
		await expect(createForm).toBeVisible({ timeout: webviewTimeout });

		await expect(createForm.getByRole('treeitem', { name: /Unstaged Changes/ })).toBeVisible({
			timeout: MaxTimeout,
		});
		await expect(createForm.getByRole('treeitem', { name: /Staged Changes/ })).toBeVisible();
		await expect(fileRows(patchWebview, partiallyStagedFile)).toHaveCount(2);
		await expect(fileRows(patchWebview, committedFile)).toHaveCount(0);

		const visibility = patchWebview.locator('#visibility');
		await expect(visibility).toHaveValue('public');
		await expect(visibility.locator('option:checked')).toHaveText('Anyone with the link');

		await expect(patchWebview.locator('#title')).toHaveValue('');
		await expect(createButton(patchWebview)).toBeEnabled();

		await expectState(vscode, 6);
	});
});

test.describe('Cloud Patches — create without an account', () => {
	test('A3: an empty title is rejected, and creating with a title stops before the server', async ({ vscode }) => {
		await expectNoAccount(vscode);

		const patchWebview = await openCreateForm(vscode);
		const title = patchWebview.locator('#title');
		await expect(title).toHaveValue('');

		const marker = logSizes(gitlensLogs(vscode));

		await clickCreate(vscode, patchWebview);
		await expect
			.poll(() => title.evaluate((el: HTMLInputElement) => el.validationMessage), { timeout: MaxTimeout })
			.toBe('Title is required');
		await expect(title).toBeFocused();
		await expect(patchWebview.getByText('Check at least one change')).toHaveCount(0);

		const patchTitle = `E2E boundary ${Date.now()}`;
		await submitWithTitle(vscode, patchWebview, patchTitle);

		await expect
			.poll(() => logSince(marker).filter(l => createDraftRpcLine.test(l)), {
				message: 'the titled submission never reached the extension host',
				timeout: MaxTimeout,
			})
			.toHaveLength(1);
		const [rpcLine] = logSince(marker).filter(l => createDraftRpcLine.test(l));
		expect(rpcLine, 'the create was not stopped by the account prompt').toContain(
			'Cloud Patches are a Preview feature and require an account.',
		);
		expect(logSince(marker).filter(l => l.includes('DraftService.createDraft'))).toEqual([]);

		await expect(createOutcomeToasts(vscode)).toHaveCount(0);
		await expect(patchWebview.locator('gl-patch-create')).toBeVisible();
		await expect(title).toHaveValue(patchTitle);

		await expectNoAccount(vscode);
	});

	// TODO(#6242): enable once the button re-enables after an abandoned create
	test.fixme(
		'A3b: "Create Cloud Patch" is enabled again after the create is abandoned (account prompt refused) — #6242',
		{ annotation: { type: 'issue', description: 'https://github.com/gitkraken/vscode-gitlens/issues/6242' } },
		async ({ vscode }) => {
			await expectNoAccount(vscode);

			const patchWebview = await openCreateForm(vscode);
			await submitWithTitle(vscode, patchWebview, `E2E boundary ${Date.now()}`);

			await expect(createButton(patchWebview)).toBeEnabled({ timeout: MaxTimeout });
			await expect(createOutcomeToasts(vscode)).toHaveCount(0);
		},
	);
});

test.describe('Cloud Patches — view welcome', () => {
	function welcome(vscode: VSCodeInstance): Locator {
		return vscode.gitlens.sidebar.locator.locator('.welcome-view-content', {
			hasText: 'privately and securely share code',
		});
	}

	const accountRequired = 'An account is required and may require GitLens Pro in the future.';

	test('A4: signed out — "Try GitLens Pro" or sign in, and the account-required note', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: 0 /* Community */ });

		await vscode.gitlens.executeCommand('gitlens.showDraftsView');

		const content = welcome(vscode);
		await expect(content).toBeVisible({ timeout: MaxTimeout });
		await expect(content.getByRole('button', { name: 'Try GitLens Pro', exact: true })).toBeVisible();
		await expect(content.locator('a[href^="command:gitlens.plus.login"]')).toHaveText('sign in');
		await expect(content.getByText(accountRequired)).toBeVisible();
		await expect(content.getByRole('button', { name: 'Create Cloud Patch', exact: true })).toHaveCount(0);

		await expectState(vscode, 0);
	});

	test('A4: paid — "Create Cloud Patch" and no account prompt', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: 6 /* Paid */, planId: 'pro' });

		await vscode.gitlens.executeCommand('gitlens.showDraftsView');

		const content = welcome(vscode);
		await expect(content).toBeVisible({ timeout: MaxTimeout });
		await expect(content.getByRole('button', { name: 'Create Cloud Patch', exact: true })).toBeVisible();
		await expect(content.getByRole('button', { name: 'Try GitLens Pro', exact: true })).toHaveCount(0);
		await expect(content.getByText(accountRequired)).toHaveCount(0);

		await expectState(vscode, 6);
	});
});

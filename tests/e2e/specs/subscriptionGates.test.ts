// KEEP: never click a gate action — they start trials, upgrade or sign in
import * as process from 'node:process';
import type { FrameLocator, Locator } from '@playwright/test';
import type { SimulationState } from '../../../src/plus/gk/__debug__accountDebug.js';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				await git.commit('Add test file', 'test-file.txt', 'Initial content\nLine 2\nLine 3');
				await git.commit('Update test file', 'test-file.txt', 'Updated content\nLine 2\nLine 3\nLine 4');

				// KEEP: a non-provider https remote stays private with no network probe
				await git.addRemote('origin', 'https://example.com/test/subscription-gates.git');

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
	await vscode.gitlens.quickPick.cancel();
	await vscode.gitlens.resetUI();
});

const verificationRequired = -1;
const community = 0;
const trialExpired = 4;
const trialReactivationEligible = 5;
const paid = 6;

const graphTimeout = 30000;

async function simulate(
	vscode: VSCodeInstance,
	state: Exclude<SimulationState, { state: null }>,
): Promise<AsyncDisposable> {
	const simulation = await vscode.gitlens.startSubscriptionSimulation(state);
	try {
		await expectAccountState(vscode, state.state);
	} catch (ex) {
		await simulation[Symbol.asyncDispose]();
		throw ex;
	}
	return simulation;
}

async function expectAccountState(vscode: VSCodeInstance, state: NonNullable<SimulationState['state']>): Promise<void> {
	expect((await vscode.gitlens.getAccountStatus()).state).toBe(state);
}

async function openGraph(vscode: VSCodeInstance): Promise<FrameLocator> {
	await vscode.gitlens.showCommitGraphView();
	const webview = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', graphTimeout);
	expect(webview, 'Commit Graph webview not found').not.toBeNull();
	return webview!;
}

function graphTree(webview: FrameLocator): Locator {
	return webview.getByRole('tree', { name: 'Commit graph' });
}

function previewBanner(webview: FrameLocator): Locator {
	return webview.locator('gl-graph-preview-banner [role="status"]');
}

function previewEndedHeading(webview: FrameLocator): Locator {
	return webview.getByRole('heading', { name: 'Commit Graph Preview Ended' });
}

function commandLink(scope: FrameLocator | Locator, commandId: string): Locator {
	return scope.locator(`[href*="command:${commandId}"]`).first();
}

function visiblePlanGate(webview: FrameLocator): Locator {
	return webview.locator('gl-feature-gate-plus-state:not([hidden])');
}

test.describe('Subscription gates — Commit Graph', () => {
	test('signed out with an eligible preview: the preview starts on open and the graph shows', async ({ vscode }) => {
		await using _ = await simulate(vscode, {
			state: community,
			featurePreviews: { status: 'eligible', durationSeconds: 600 },
		});

		const webview = await openGraph(vscode);
		await expect(graphTree(webview)).toBeVisible({ timeout: graphTimeout });
		await expect(previewBanner(webview)).toBeVisible();
		await expect(webview.locator('gl-graph-access-account')).toHaveCount(0);
		await expect(webview.locator('gl-graph-gate')).toHaveCount(0);

		await expectAccountState(vscode, community);
	});

	test('signed out with an expired preview: the "preview ended" wall shows instead of the graph', async ({
		vscode,
	}) => {
		await using _ = await simulate(vscode, {
			state: community,
			featurePreviews: { status: 'expired', durationSeconds: 600 },
		});

		const webview = await openGraph(vscode);
		await expect(previewEndedHeading(webview)).toBeVisible({ timeout: graphTimeout });
		await expect(graphTree(webview)).toHaveCount(0);

		await expectAccountState(vscode, community);
	});

	test('trial expired: the plan gate offers "Upgrade to Pro" and says the trial ended', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: trialExpired });

		const webview = await openGraph(vscode);
		const gate = visiblePlanGate(webview);
		await expect(commandLink(gate, 'gitlens.plus.upgrade')).toBeVisible({ timeout: graphTimeout });
		await expect(commandLink(gate, 'gitlens.plus.upgrade')).toHaveText(/Upgrade to Pro/);
		await expect(gate.getByText('Your trial has ended — upgrade to keep the Commit Graph unlocked.')).toBeVisible();
		await expect(graphTree(webview)).toHaveCount(0);

		await expectAccountState(vscode, trialExpired);
	});

	test('trial reactivation eligible: the plan gate offers "Continue"', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: trialReactivationEligible });

		const webview = await openGraph(vscode);
		const reactivate = commandLink(visiblePlanGate(webview), 'gitlens.plus.reactivateProTrial');
		await expect(reactivate).toBeVisible({ timeout: graphTimeout });
		await expect(reactivate).toHaveText(/Continue/);
		await expect(graphTree(webview)).toHaveCount(0);

		await expectAccountState(vscode, trialReactivationEligible);
	});

	test('verification required: the graph shows the verify-your-email screen', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: verificationRequired });

		const webview = await openGraph(vscode);
		await expect(commandLink(webview, 'gitlens.plus.resendVerification')).toBeVisible({ timeout: graphTimeout });
		await expect(graphTree(webview)).toHaveCount(0);

		await expectAccountState(vscode, verificationRequired);
	});
});

test.describe('Subscription gates — Commit Graph transitions without reopening', () => {
	test('trial expired → paid: the plan gate lifts and the graph renders in the open view', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: trialExpired });

		const webview = await openGraph(vscode);
		await expect(commandLink(visiblePlanGate(webview), 'gitlens.plus.upgrade')).toBeVisible({
			timeout: graphTimeout,
		});

		await simulate(vscode, { state: paid, planId: 'pro' });

		await expect(graphTree(webview)).toBeVisible({ timeout: graphTimeout });
		await expect(webview.locator('gl-graph-gate')).toHaveCount(0);

		await expectAccountState(vscode, paid);
	});

	test('paid → trial expired: the plan gate returns over the open graph', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: paid, planId: 'pro' });

		const webview = await openGraph(vscode);
		await expect(graphTree(webview)).toBeVisible({ timeout: graphTimeout });

		await simulate(vscode, { state: trialExpired });

		await expect(commandLink(visiblePlanGate(webview), 'gitlens.plus.upgrade')).toBeVisible({
			timeout: graphTimeout,
		});
		await expect(graphTree(webview)).toHaveCount(0);

		await expectAccountState(vscode, trialExpired);
	});

	test('signed out with an active preview: the preview expires on its own timer and the wall appears', async ({
		vscode,
	}) => {
		await using _ = await simulate(vscode, {
			state: community,
			featurePreviews: { status: 'active', durationSeconds: 600 },
		});

		const webview = await openGraph(vscode);
		await expect(graphTree(webview)).toBeVisible({ timeout: graphTimeout });
		await expect(previewBanner(webview)).toBeVisible();

		await simulate(vscode, { state: community, featurePreviews: { status: 'active', durationSeconds: 5 } });
		await expect(graphTree(webview)).toBeVisible();

		await expect(previewEndedHeading(webview)).toBeVisible({ timeout: 15000 });
		await expect(graphTree(webview)).toHaveCount(0);

		await expectAccountState(vscode, community);
	});
});

test.describe('Subscription gates — Worktrees view welcome', () => {
	function welcomeButton(vscode: VSCodeInstance, name: string): Locator {
		return vscode.gitlens.sidebar.locator.getByRole('button', { name: name, exact: true });
	}

	const gateButtons = ['Try GitLens Pro', 'Upgrade to Pro', 'Continue', 'Resend Verification Email'] as const;

	async function expectOnlyGateButton(vscode: VSCodeInstance, expected: (typeof gateButtons)[number]): Promise<void> {
		await expect(welcomeButton(vscode, expected)).toBeVisible({ timeout: MaxTimeout });
		for (const name of gateButtons) {
			if (name === expected) continue;

			await expect(welcomeButton(vscode, name)).toHaveCount(0);
		}
		await expect(welcomeButton(vscode, 'Create Worktree...')).toHaveCount(0);
	}

	test('signed out: "Try GitLens Pro"', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: community });

		await vscode.gitlens.showWorktreesView();
		await expectOnlyGateButton(vscode, 'Try GitLens Pro');

		await expectAccountState(vscode, community);
	});

	test('trial expired: "Upgrade to Pro" and the trial-ended line', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: trialExpired });

		await vscode.gitlens.showWorktreesView();
		await expectOnlyGateButton(vscode, 'Upgrade to Pro');
		await expect(
			vscode.gitlens.sidebar.locator.getByText(
				'Your Pro trial has ended. Please upgrade for full access to Worktrees and other Pro features.',
			),
		).toBeVisible();

		await expectAccountState(vscode, trialExpired);
	});

	test('trial reactivation eligible: "Continue"', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: trialReactivationEligible });

		await vscode.gitlens.showWorktreesView();
		await expectOnlyGateButton(vscode, 'Continue');

		await expectAccountState(vscode, trialReactivationEligible);
	});

	test('verification required: "Resend Verification Email"', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: verificationRequired });

		await vscode.gitlens.showWorktreesView();
		await expectOnlyGateButton(vscode, 'Resend Verification Email');

		await expectAccountState(vscode, verificationRequired);
	});

	test('paid: no gate — "Create Worktree..." is offered', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: paid, planId: 'pro' });

		await vscode.gitlens.showWorktreesView();
		await expect(welcomeButton(vscode, 'Create Worktree...')).toBeVisible({ timeout: MaxTimeout });
		for (const name of gateButtons) {
			await expect(welcomeButton(vscode, name)).toHaveCount(0);
		}

		await expectAccountState(vscode, paid);
	});
});

test.describe('Subscription gates — quick pick', () => {
	test('Launchpad while signed out offers "Try GitLens Pro" and "Sign In"', async ({ vscode }) => {
		const { quickPick } = vscode.gitlens;
		await using _ = await simulate(vscode, { state: community });

		await vscode.gitlens.showLaunchpadView();
		await quickPick.waitForVisible();
		await quickPick.waitForStep({ placeholder: /Try GitLens Pro to unlock this feature/ });
		await quickPick.getVisibleItem(/^Try GitLens Pro/);
		await quickPick.getVisibleItem(/^Sign In/);

		// KEEP: Escape, never Enter — row 1 opens the Welcome view
		await quickPick.close();
		expect(await quickPick.isVisible()).toBeFalsy();

		await expectAccountState(vscode, community);
	});

	test('worktree create while the trial is expired offers "Upgrade to Pro"', async ({ vscode }) => {
		const { quickPick } = vscode.gitlens;
		await using _ = await simulate(vscode, { state: trialExpired });

		await vscode.gitlens.startWorktreeCreateWizard();
		await quickPick.waitForVisible();
		await quickPick.waitForStep({
			title: /Create Worktree/i,
			placeholder: /Unlock this feature for privately hosted repos with GitLens Pro/,
		});
		await quickPick.getVisibleItem(/^Upgrade to Pro/);

		await quickPick.close();
		expect(await quickPick.isVisible()).toBeFalsy();

		await expectAccountState(vscode, trialExpired);
	});

	test('worktree create while verification is required offers "Resend Email"', async ({ vscode }) => {
		const { quickPick } = vscode.gitlens;
		await using _ = await simulate(vscode, { state: verificationRequired });

		await vscode.gitlens.startWorktreeCreateWizard();
		await quickPick.waitForVisible();
		await quickPick.waitForStep({
			title: /Create Worktree/i,
			placeholder: /You must verify your email before you can continue/,
		});
		await quickPick.getVisibleItem(/^Resend Email/);

		await quickPick.close();
		expect(await quickPick.isVisible()).toBeFalsy();

		await expectAccountState(vscode, verificationRequired);
	});
});

test.describe('Subscription gates — Visual File History', () => {
	test('trial expired: the plan gate offers "Upgrade to Pro" and says the trial ended', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: trialExpired });

		await vscode.gitlens.openFile('test-file.txt');
		await vscode.gitlens.showVisualFileHistoryView();
		await expect(vscode.gitlens.visualHistoryViewSection).toBeVisible({ timeout: MaxTimeout });

		const webview = await vscode.gitlens.visualHistoryViewWebview;
		expect(webview, 'Visual File History webview not found').not.toBeNull();

		const gate = visiblePlanGate(webview!);
		await expect(commandLink(gate, 'gitlens.plus.upgrade')).toBeVisible({ timeout: MaxTimeout });
		await expect(commandLink(gate, 'gitlens.plus.upgrade')).toHaveText(/Upgrade to Pro/);
		await expect(gate.getByText('Your trial has ended — upgrade to keep all Pro features unlocked.')).toBeVisible();

		await expectAccountState(vscode, trialExpired);
	});
});

test.describe('Subscription gates — Settings → Account', () => {
	test('trial expired: the plan card says the trial ended and offers "Upgrade to Pro"', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: trialExpired });

		const settings = await vscode.gitlens.showSettingsAccount();
		expect(settings, 'GitLens Settings webview not found').not.toBeNull();

		const account = settings!.locator('gl-settings-account');
		await expect(account.getByText(/Your Pro trial (has )?ended/)).toBeVisible({ timeout: MaxTimeout });
		const upgrade = account.locator('[href*="command:gitlens.plus.upgrade"][href*="plan-card"]').first();
		await expect(upgrade).toBeVisible();
		await expect(upgrade).toHaveText(/Upgrade to Pro/);

		await expectAccountState(vscode, trialExpired);
	});

	test('trial reactivation eligible: the plan card offers "Reactivate GitLens Pro Trial"', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: trialReactivationEligible });

		const settings = await vscode.gitlens.showSettingsAccount();
		expect(settings, 'GitLens Settings webview not found').not.toBeNull();

		const reactivate = commandLink(settings!.locator('gl-settings-account'), 'gitlens.plus.reactivateProTrial');
		await expect(reactivate).toBeVisible({ timeout: MaxTimeout });
		await expect(reactivate).toHaveText(/Reactivate GitLens Pro Trial/);

		await expectAccountState(vscode, trialReactivationEligible);
	});

	test('verification required: the plan card is marked "Unverified"', async ({ vscode }) => {
		await using _ = await simulate(vscode, { state: verificationRequired });

		const settings = await vscode.gitlens.showSettingsAccount();
		expect(settings, 'GitLens Settings webview not found').not.toBeNull();

		const account = settings!.locator('gl-settings-account');
		await expect(account.getByText('Unverified', { exact: true }).first()).toBeVisible({ timeout: MaxTimeout });
		await expect(account.getByText('Your Pro trial starts as soon as your email is verified.')).toBeVisible();

		await expectAccountState(vscode, verificationRequired);
	});
});

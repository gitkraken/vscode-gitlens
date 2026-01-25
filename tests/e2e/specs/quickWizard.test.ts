/**
 * GitLens Quick Wizard E2E Tests
 *
 * Comprehensive tests for all Git Commands quick wizard flows.
 * Tests verify:
 * 1. Every step in every flow is reachable
 * 2. Back navigation works correctly at each step
 * 3. Correct titles and placeholders at each step
 * 4. Cross-flow transitions (e.g., branch create → worktree create)
 * 5. Edge cases (e.g., branches linked to worktrees)
 *
 * Commands covered:
 * - Branch: create, delete, prune, rename, upstream
 * - Tag: create, delete
 * - Stash: push, pop, apply, drop, list, rename
 * - Remote: add, remove, prune
 * - Worktree: open, create, delete
 * - Fetch, Pull, Push
 * - Switch/Checkout
 * - Merge, Rebase, Cherry-pick
 * - Reset, Revert, Log, Show, Search, Status
 *
 * Testing Strategy for Back Navigation:
 * - Each test navigates forward to a specific step
 * - Then navigates backward to verify the previous step is correctly restored
 * - Verifies step identity via title/placeholder patterns
 *
 * Note: Navigation helpers (goBackAndVerify, waitForStep, etc.) are now part of
 * the QuickPick component in tests/e2e/pageObjects/components/quickPick.ts
 */
import * as path from 'node:path';
import * as process from 'node:process';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, ShortTimeout } from '../baseTest.js';
import type { Step } from '../pageObjects/components/quickPick.js';
import type { GitLensPage } from '../pageObjects/gitLensPage.js';

/** Git fixture for test repository */
let git: GitFixture;
let repoDir: string;

// Configure vscodeOptions with setup callback to create test repo with worktrees
const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				repoDir = await createTmpDir();
				git = new GitFixture(repoDir);
				await git.init();

				// Create branches for testing
				await git.branch('feature-1');
				await git.branch('feature-2');
				await git.branch('feature-with-worktree');
				await git.branch('develop');

				// Create some commits and tags on main
				await git.commit('Second commit', 'file2.txt', 'content 2');
				await git.tag('v1.0.0');
				await git.commit('Third commit', 'file3.txt', 'content 3');
				await git.tag('v1.1.0');
				await git.commit('Fourth commit', 'file4.txt', 'content 4');

				// Create commits on feature-1 for cherry-pick testing
				// (these will be unique commits not on main)
				await git.checkout('feature-1');
				await git.commit('Feature 1 commit A', 'feature1-a.txt', 'feature 1 content A');
				await git.commit('Feature 1 commit B', 'feature1-b.txt', 'feature 1 content B');
				await git.checkout('main');

				// Create a worktree for testing worktree-linked branch scenarios
				// Use a unique path inside the repo's temp directory to avoid conflicts
				const worktreeDir = path.join(repoDir, '..', `worktree-${Date.now()}`);
				await git.worktree(worktreeDir, 'feature-with-worktree');

				// Create stashes for testing stash commands
				// Stash 1: Working tree changes (must include untracked since file is new)
				await git.createFile('stash-test-1.txt', 'stash content 1');
				await git.stash('Test stash 1', { includeUntracked: true });

				// Stash 2: More changes (must include untracked since file is new)
				await git.createFile('stash-test-2.txt', 'stash content 2');
				await git.stash('Test stash 2', { includeUntracked: true });

				// Add a remote for testing remote commands
				await git.addRemote('origin', 'https://github.com/example/repo.git');

				// Create fake remote tracking branches for testing upstream flows
				await git.createRemoteBranch('origin', 'main');
				await git.createRemoteBranch('origin', 'develop');

				// Create a branch with a missing upstream for testing branch prune
				// This simulates a branch that was tracking a remote branch that has been deleted
				await git.branch('stale-feature');
				await git.setUpstream('stale-feature', 'origin/stale-feature');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

async function selectCommandAndWaitForStepWithOptionalRepo(
	{ gitlens, gitlens: { quickPick }, page }: VSCodeInstance,
	command: string,
	step: Step,
	multipleRepos?: boolean,
): Promise<void> {
	await gitlens.executeCommand('gitlens.gitCommands');
	await quickPick.waitForVisible();

	// Select the command
	await quickPick.waitForStep({ placeholder: /Choose a command/ });
	// Type the command to filter the list
	await quickPick.enterTextAndWaitForItems(command);
	await quickPick.selectItem(new RegExp(command, 'i'));

	// May get a repo picker step if multiple repos exist
	const index = await quickPick.waitForAnyStep([{ placeholder: /Choose a repository/ }, step]);
	if (index === 0) {
		// Repo picker, select repo then wait for step
		await quickPick.enterTextAndWaitForItems('gltest');
		if (multipleRepos) {
			await quickPick.selectItemMulti(/gltest/i);
		} else {
			await quickPick.selectItem(/gltest/i);
		}

		await page.waitForTimeout(ShortTimeout / 2);
		await quickPick.waitForStep(step);
	}

	await page.waitForTimeout(ShortTimeout / 2);
}

async function selectCommandSubcommandAndWaitForStepWithOptionalRepo(
	{ gitlens, gitlens: { quickPick }, page }: VSCodeInstance,
	command: string,
	subcommand: string,
	step: Step,
): Promise<void> {
	await gitlens.executeCommand('gitlens.gitCommands');
	await quickPick.waitForVisible();

	// Select the command
	await quickPick.waitForStep({ placeholder: /Choose a command/ });
	// Type the command to filter the list
	await quickPick.enterTextAndWaitForItems(command);
	await quickPick.selectItem(new RegExp(command, 'i'));

	await quickPick.waitForStep({ placeholder: new RegExp(`Choose a ${command} command`, 'i') });
	await quickPick.enterTextAndWaitForItems(subcommand);
	await quickPick.selectItem(new RegExp(subcommand, 'i'));

	// Select subcommand - but first check if a repo picker appeared
	const index = await quickPick.waitForAnyStep([{ placeholder: /Choose a repository/ }, step]);
	if (index === 0) {
		// Repo picker, select repo then wait for step
		await quickPick.enterTextAndWaitForItems('gltest');
		await quickPick.selectItem(/gltest/i);

		await page.waitForTimeout(ShortTimeout / 2);
		await quickPick.waitForStep(step);
	}

	await page.waitForTimeout(ShortTimeout / 2);
}

async function reverseCommandAndRepo({ gitlens: { quickPick }, page }: VSCodeInstance): Promise<void> {
	// Wait for quick pick to settle before going back
	await page.waitForTimeout(ShortTimeout / 2);

	// Back from current step → (repo) → command
	await quickPick.goBack();
	const index = await quickPick.waitForAnyStep([
		{ placeholder: /Choose a repository/ },
		{ placeholder: /Choose a command/ },
	]);
	if (index === 0) {
		// Back from repo → command
		await quickPick.goBackAndWaitForStep({ placeholder: /Choose a command/ });
	}
}

async function reverseCommandSubcommandAndRepo(
	{ gitlens: { quickPick }, page }: VSCodeInstance,
	command: string,
): Promise<void> {
	// Wait for quick pick to settle before going back
	await page.waitForTimeout(ShortTimeout / 2);

	// Back from current step → (repo) → subcommand
	await quickPick.goBack();
	const index = await quickPick.waitForAnyStep([
		{ placeholder: /Choose a repository/ },
		{ placeholder: new RegExp(`Choose a ${command} command`, 'i') },
	]);
	if (index === 0) {
		// Back from repo → subcommand
		await quickPick.goBackAndWaitForStep({ placeholder: new RegExp(`Choose a ${command} command`, 'i') });
	}

	// Back from subcommand → command
	await quickPick.goBackAndWaitForStep({ placeholder: /Choose a command/ });
}

/**
 * Helper to test direct commands that open at a specific step.
 * Executes the command, waits for the quick pick, verifies the expected step title, then cancels.
 */
async function testDirectGitCommand(gitlens: GitLensPage, suffix: string, step: Step): Promise<void> {
	const { quickPick } = gitlens;

	await gitlens.executeCommand(`gitlens.git.${suffix}`);
	await quickPick.waitForVisible();
	await quickPick.waitForStep(step);

	await quickPick.cancel();
	expect(await quickPick.isVisible()).toBeFalsy();
}

test.describe('Quick Wizard — Branch Commands', () => {
	// Enable Pro features for all branch tests since branches can be linked to worktrees (Pro feature)
	test.beforeEach(async ({ vscode }) => {
		await vscode.gitlens.startSubscriptionSimulation();
	});
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.stopSubscriptionSimulation();
	});

	test.describe('Branch Create Flow', () => {
		test('Complete flow: command → subcommand → reference → name → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'branch', 'create', {
				title: /Create Branch/,
				placeholder: /Choose a base/i,
			});

			// Select `main` as base reference
			await quickPick.selectItem(/main/i);

			// Enter branch name
			await quickPick.waitForStep({ title: /Create Branch/, placeholder: /Branch name/i });
			await quickPick.enterTextAndSubmit('test-branch-create');

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Create Branch/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → name
			await quickPick.goBackAndWaitForStep({ title: /Create Branch/, placeholder: /Branch name/i });

			// Back from name → reference
			await quickPick.goBackAndWaitForStep({ title: /Create Branch/, placeholder: /Choose a base/i });

			await reverseCommandSubcommandAndRepo(vscode, 'branch');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Branch Delete Flow', () => {
		test('Complete flow: command → subcommand → branches → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'branch', 'delete', {
				title: /Delete Branch/,
				placeholder: /Choose branch/i,
			});

			// Select a branch to delete (use feature-2 which has no worktree)
			await quickPick.enterTextAndWaitForItems('feature-2');
			await quickPick.selectItemMulti(/feature-2/);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Delete Branch/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → branch
			await quickPick.goBackAndWaitForStep({ title: /Delete Branch/, placeholder: /Choose branch/i });

			await reverseCommandSubcommandAndRepo(vscode, 'branch');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('COMMUNITY: Worktree delete flow: command → subcommand → branches → worktree confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				gitlens,
			},
		}) => {
			// Stop subscription simulation to test as community user
			await gitlens.stopSubscriptionSimulation();

			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'branch', 'delete', {
				title: /Delete Branch/,
				placeholder: /Choose branch/i,
			});

			// Select the branch that has a worktree
			await quickPick.enterTextAndWaitForItems('feature-with-worktree');
			await quickPick.selectItemMulti(/feature-with-worktree/i);

			// Confirm worktree deletion
			await quickPick.waitForStep({ title: /Confirm Delete Worktree for Branch/i });

			// Note: The full flow would continue to delete the worktree then delete the branch,
			// but we stop here to test navigation without actually performing destructive operations

			// === REVERSE NAVIGATION ===

			// Back from worktree confirm → branch
			await quickPick.goBackAndWaitForStep({ title: /Delete Branch/, placeholder: /Choose branch/i });

			await reverseCommandSubcommandAndRepo(vscode, 'branch');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('PRO: Worktree delete flow: command → subcommand → branches → worktree confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'branch', 'delete', {
				title: /Delete Branch/,
				placeholder: /Choose branch/i,
			});

			// Select the branch that has a worktree
			await quickPick.enterTextAndWaitForItems('feature-with-worktree');
			await quickPick.selectItemMulti(/feature-with-worktree/i);

			// Confirm worktree deletion
			await quickPick.waitForStep({ title: /Confirm Delete Worktree for Branch/i });

			// Note: The full flow would continue to delete the worktree then delete the branch,
			// but we stop here to test navigation without actually performing destructive operations

			// === REVERSE NAVIGATION ===

			// Back from worktree confirm → branch
			await quickPick.goBackAndWaitForStep({ title: /Delete Branch/, placeholder: /Choose branch/i });

			await reverseCommandSubcommandAndRepo(vscode, 'branch');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Branch Rename Flow', () => {
		test('Complete flow: command → subcommand → branch → name → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'branch', 'rename', {
				title: /Rename Branch/,
				placeholder: /Choose a branch/i,
			});

			// Select a branch to rename (feature-2)
			await quickPick.selectItem('feature-2');

			// Enter new name
			await quickPick.waitForStep({ title: /Rename Branch/, placeholder: /Branch name/i });
			await quickPick.enterTextAndSubmit('feature-2-renamed');

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Rename Branch/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → name
			await quickPick.goBackAndWaitForStep({ title: /Rename Branch/, placeholder: /Branch name/i });

			// Back from name → branch
			await quickPick.goBackAndWaitForStep({ title: /Rename Branch/, placeholder: /Choose a branch/i });

			await reverseCommandSubcommandAndRepo(vscode, 'branch');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Branch Upstream Flow', () => {
		test('Complete flow: command → subcommand → branch → upstream → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'branch', 'upstream', {
				title: /Change Upstream/i,
				placeholder: /Choose a branch/i,
			});

			// Select a branch to change upstream
			await quickPick.selectItem(/feature-1/i);

			// Select an upstream remote branch
			await quickPick.waitForStep({ title: /Change Upstream/i, placeholder: /Choose an upstream/i });
			await quickPick.selectItem(/origin\/main/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm (Change|Set|Unset) Upstream/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → upstream
			await quickPick.goBackAndWaitForStep({
				title: /Change Upstream/i,
				placeholder: /Choose an upstream/i,
			});

			// Back from upstream → branch
			await quickPick.goBackAndWaitForStep({ title: /Change Upstream/i, placeholder: /Choose a branch/i });

			await reverseCommandSubcommandAndRepo(vscode, 'branch');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Branch Prune Flow', () => {
		test('Complete flow: command → subcommand → branches → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'branch', 'prune', {
				title: /Prune Branch/,
				placeholder: /Choose branches/i,
			});

			// Select a branch with missing upstreams
			await quickPick.selectItemMulti(/stale-feature/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Prune Branch/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → branch
			await quickPick.goBackAndWaitForStep({ title: /Prune Branch/, placeholder: /Choose branches/i });

			await reverseCommandSubcommandAndRepo(vscode, 'branch');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});
});

test.describe('Quick Wizard — Switch Command', () => {
	// Enable Pro features since switch can work with branches linked to worktrees (Pro feature)
	test.beforeEach(async ({ vscode }) => {
		await vscode.gitlens.startSubscriptionSimulation();
	});
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.stopSubscriptionSimulation();
	});

	test('Complete flow: command → branch picker → confirm & reverse', async ({
		vscode,
		vscode: {
			gitlens: { quickPick },
		},
	}) => {
		await selectCommandAndWaitForStepWithOptionalRepo(
			vscode,
			'switch',
			{
				title: /Switch/i,
				placeholder: /Choose a branch/i,
			},
			true,
		);

		// Select a branch to switch to
		await quickPick.enterTextAndWaitForItems('feature-1');
		await quickPick.selectItem(/feature-1/i);

		// Confirm step
		await quickPick.waitForStep({ title: /Confirm Switch/i });

		// === REVERSE NAVIGATION ===

		// Back from confirm → branch
		await quickPick.goBackAndWaitForStep({ title: /Switch/i, placeholder: /Choose a branch/i });

		await reverseCommandAndRepo(vscode);

		await quickPick.cancel();
		expect(await quickPick.isVisible()).toBeFalsy();
	});
});

test.describe('Quick Wizard — Tag Commands', () => {
	test.describe('Tag Create Flow', () => {
		test('Complete flow: command → subcommand → reference → name → message → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'tag', 'create', {
				title: /Create Tag/,
				placeholder: /Choose a branch or tag/i,
			});

			// Select `main` branch as reference
			await quickPick.selectItem(/main/i);

			// Enter tag name
			await quickPick.waitForStep({ title: /Create Tag/, placeholder: /Tag name/i });
			await quickPick.enterTextAndSubmit('v2.0.0');

			// Enter tag message
			await quickPick.waitForStep({ title: /Create Tag/, placeholder: /provide an optional message/i });
			await quickPick.enterTextAndSubmit('Release 2.0.0');

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Create Tag/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → message
			await quickPick.goBackAndWaitForStep({ title: /Create Tag/, placeholder: /provide an optional message/i });

			// Back from message → name
			await quickPick.goBackAndWaitForStep({ title: /Create Tag/, placeholder: /Tag name/i });

			// Back from name → reference
			await quickPick.goBackAndWaitForStep({ title: /Create Tag/, placeholder: /Choose a branch or tag/i });

			await reverseCommandSubcommandAndRepo(vscode, 'tag');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Tag Delete Flow', () => {
		test('Complete flow: command → subcommand → pick tags → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'tag', 'delete', {
				title: /Delete Tag/,
				placeholder: /Choose tags to delete/i,
			});

			// Select a tag to delete (use v1.1.0)
			await quickPick.selectItemMulti(/v1\.1\.0/);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Delete Tag/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → tag
			await quickPick.goBackAndWaitForStep({ title: /Delete Tag/, placeholder: /Choose tags to delete/i });

			await reverseCommandSubcommandAndRepo(vscode, 'tag');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});
});

test.describe('Quick Wizard — Stash Commands', () => {
	test.describe('Stash Push Flow', () => {
		test('Complete flow: command → subcommand → message & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'stash', 'push', {
				title: /Push Stash/i,
				placeholder: /Stash message/i,
			});

			// Enter a stash message
			await quickPick.enterTextAndSubmit('Test stash message');

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Push Stash/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → message
			await quickPick.goBackAndWaitForStep({ title: /Push Stash/i, placeholder: /Stash message/i });

			await reverseCommandSubcommandAndRepo(vscode, 'stash');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Stash List Flow', () => {
		test('Complete flow: command → subcommand → stash picker → show (files) → show (commands) & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'stash', 'list', {
				title: /Stashes/i,
				placeholder: /Choose a stash/i,
			});

			// Ensure items appear
			await quickPick.waitForItems(ShortTimeout);
			const count = await quickPick.countItems();
			expect(count).toBeGreaterThan(0);

			// Select a stash to show
			await quickPick.selectItem(/Test stash/i);

			// Show step - starts in files mode (placeholder is the stash description)
			await quickPick.waitForStep({ title: /Stash #/i, placeholder: /Stash #.*Test stash/i });

			// Verify we're in files mode by checking for the toggle to actions hint
			let items = await quickPick.getVisibleItems();
			expect(items.some(item => /Click to see.*actions/i.test(item))).toBeTruthy();

			// Toggle to commands mode (click the toggle item with hint about stash actions)
			await quickPick.selectItem(/Click to see.*actions/i);

			// Verify we're now in commands mode by checking for the toggle back to files hint
			await quickPick.waitForStep({ title: /Stash #/i });
			items = await quickPick.getVisibleItems();
			expect(items.some(item => /Click to see.*files/i.test(item))).toBeTruthy();

			// === REVERSE NAVIGATION ===

			// Back from commands → stash picker (toggle doesn't add to history, so back skips files mode)
			await quickPick.goBackAndWaitForStep({ title: /Stashes/i, placeholder: /Choose a stash/i });

			await reverseCommandSubcommandAndRepo(vscode, 'stash');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Toggle multiple times: files → commands → files, then back should go directly to stash list', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'stash', 'list', {
				title: /Stashes/i,
				placeholder: /Choose a stash/i,
			});

			// Select a stash to show
			await quickPick.selectItem(/Test stash/i);

			// Start in files mode
			await quickPick.waitForStep({ title: /Stash #/i });
			let items = await quickPick.getVisibleItems();
			expect(items.some(item => /Click to see.*actions/i.test(item))).toBeTruthy();

			// Toggle to commands mode
			await quickPick.selectItem(/Click to see.*actions/i);
			await quickPick.waitForStep({ title: /Stash #/i });
			items = await quickPick.getVisibleItems();
			expect(items.some(item => /Click to see.*files/i.test(item))).toBeTruthy();

			// Toggle back to files mode
			await quickPick.selectItem(/Click to see.*files/i);
			await page.waitForTimeout(ShortTimeout); // Give time for the step to update
			await quickPick.waitForStep({ title: /Stash #/i });
			items = await quickPick.getVisibleItems();
			expect(items.some(item => /Click to see.*actions/i.test(item))).toBeTruthy();

			// Back from files → should go directly to stash picker (not through commands mode)
			await quickPick.goBackAndWaitForStep({ title: /Stashes/i, placeholder: /Choose a stash/i });

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Stash Apply Flow', () => {
		test('Complete flow: command → subcommand → stash picker → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'stash', 'apply', {
				title: /Apply Stash/i,
				placeholder: /Choose a stash/i,
			});

			// Select a stash to apply
			await quickPick.selectItem(/Test stash/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Apply Stash/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → stash
			await quickPick.goBackAndWaitForStep({ title: /Apply Stash/i, placeholder: /Choose a stash/i });

			await reverseCommandSubcommandAndRepo(vscode, 'stash');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Stash Pop Flow', () => {
		test('Complete flow: command → subcommand → stash picker → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'stash', 'pop', {
				title: /Pop Stash/i,
				placeholder: /Choose a stash/i,
			});

			// Select a stash to pop
			await quickPick.selectItem(/Test stash/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Pop Stash/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → stash
			await quickPick.goBackAndWaitForStep({ title: /Pop Stash/i, placeholder: /Choose a stash/i });

			await reverseCommandSubcommandAndRepo(vscode, 'stash');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Stash Drop Flow', () => {
		test('Complete flow: command → subcommand → stash picker → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'stash', 'drop', {
				title: /Drop Stash/i,
				placeholder: /Choose stashes/i,
			});

			// Select a stash to drop
			await quickPick.selectItemMulti(/Test stash/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Drop Stash/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → stash
			await quickPick.goBackAndWaitForStep({ title: /Drop Stash/i, placeholder: /Choose stashes/i });

			await reverseCommandSubcommandAndRepo(vscode, 'stash');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Stash Rename Flow', () => {
		test('Complete flow: command → subcommand → stash → message → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'stash', 'rename', {
				title: /Rename Stash/i,
				placeholder: /Choose a stash/i,
			});

			// Select a stash to rename
			await quickPick.selectItem(/Test stash/i);

			// Enter new message
			await quickPick.waitForStep({ title: /Rename Stash/i, placeholder: /Stash message/i });
			await quickPick.enterTextAndSubmit('Renamed stash');

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Rename Stash/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → message input
			await quickPick.goBackAndWaitForStep({ title: /Rename Stash/i, placeholder: /Stash message/i });

			// Back from message input → stash picker (input fields require two backs)
			await quickPick.goBackAndWaitForStep({ title: /Rename Stash/i, placeholder: /Choose a stash/i });

			// Now use helper to navigate back through subcommand to command
			await reverseCommandSubcommandAndRepo(vscode, 'stash');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});
});

test.describe('Quick Wizard — Remote Commands', () => {
	test.describe('Remote Add Flow', () => {
		test('Complete flow: command → subcommand → name → url → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'remote', 'add', {
				title: /Add Remote/i,
				placeholder: /Remote name/i,
			});

			// Enter new remote name
			await quickPick.enterTextAndSubmit('upstream');

			// Enter remote url
			await quickPick.waitForStep({ title: /Add Remote/i, placeholder: /Remote URL/i });
			await quickPick.enterTextAndSubmit('https://github.com/example/repo.git');

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Add Remote/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → url input
			await quickPick.goBackAndWaitForStep({ title: /Add Remote/i, placeholder: /Remote URL/i });

			// Back from url input → name input
			await quickPick.goBackAndWaitForStep({ title: /Add Remote/i, placeholder: /Remote name/i });

			await reverseCommandSubcommandAndRepo(vscode, 'remote');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Remote Prune Flow', () => {
		test('Complete flow: command → subcommand → pick remote → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'remote', 'prune', {
				title: /Prune Remote/i,
				placeholder: /Choose a remote/i,
			});

			// Select remote to prune
			await quickPick.selectItem(/origin/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Prune Remote/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → remote picker
			await quickPick.goBackAndWaitForStep({ title: /Prune Remote/i, placeholder: /Choose a remote/i });

			await reverseCommandSubcommandAndRepo(vscode, 'remote');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Remote Remove Flow', () => {
		test('Complete flow: command → subcommand → pick remote → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'remote', 'remove', {
				title: /Remove Remote/i,
				placeholder: /Choose remote/i,
			});

			// Select remote to remove
			await quickPick.selectItem(/origin/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Remove Remote/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → remote picker
			await quickPick.goBackAndWaitForStep({ title: /Remove Remote/i, placeholder: /Choose remote/i });

			await reverseCommandSubcommandAndRepo(vscode, 'remote');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});
});

test.describe('Quick Wizard — Fetch/Pull/Push Commands', () => {
	test.describe('Fetch Flow', () => {
		test('Complete flow: command → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'fetch', { title: /Confirm Fetch/i }, true);

			// === REVERSE NAVIGATION ===

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Pull Flow', () => {
		test('Complete flow: command → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'pull', { title: /Confirm Pull/i }, true);

			// === REVERSE NAVIGATION ===

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Push Flow', () => {
		test('Complete flow: command → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'push', { title: /Confirm Push/i }, true);

			// === REVERSE NAVIGATION ===

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});
});

test.describe('Quick Wizard — Merge/Rebase/Cherry-pick/Reset/Revert Commands', () => {
	// Enable Pro features since these commands work with branches that could be linked to worktrees (Pro feature)
	test.beforeEach(async ({ vscode }) => {
		await vscode.gitlens.startSubscriptionSimulation();
	});
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.stopSubscriptionSimulation();
	});

	test.describe('Merge Flow', () => {
		test('Complete flow: command → branch → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'merge', {
				title: /Merge/i,
				placeholder: /Choose a branch/i,
			});

			// Select a branch to merge (feature-1 has unique commits)
			await quickPick.enterTextAndWaitForItems('feature-1');
			await quickPick.selectItem(/feature-1/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Merge feature-1 into main/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → branch
			await quickPick.goBackAndWaitForStep({ title: /Merge/i, placeholder: /Choose a branch/i });

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Select current branch forces commit selection: command → branch (main) → commits & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'merge', {
				title: /Merge/i,
				placeholder: /Choose a branch/i,
			});

			// Select the current branch (main) - this should force commit selection
			// Use a pattern that matches "main" at the start but allows for additional text (icons, description)
			await quickPick.selectItem(/^\s*main\s/i);

			// Select a commit to merge
			await quickPick.waitForStep({ title: /Merge/i, placeholder: /Choose a commit/i });
			await quickPick.enterTextAndWaitForItems('Fourth');
			await quickPick.selectItem(/Fourth commit/i);

			await quickPick.waitForStep({ title: /Confirm Merge/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → commits
			await quickPick.goBackAndWaitForStep({ title: /Merge/i, placeholder: /Choose a commit/i });

			// Back from commits → branch
			await quickPick.goBackAndWaitForStep({ title: /Merge/i, placeholder: /Choose a branch/i });

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Toggle commit selection: command → toggle button → branch → commits & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'merge', {
				title: /Merge/i,
				placeholder: /Choose a branch/i,
			});

			// At branch selection step, click the commit toggle button (initially shows "Choose a Branch")
			// The button tooltip when off is "Choose a Branch or Tag", click to toggle to commit mode
			await quickPick.clickActionButton(/Choose a Branch/i);

			// Select a branch (after toggle, selecting a branch will then show commits)
			await quickPick.enterTextAndWaitForItems('feature-1');
			await quickPick.selectItem(/feature-1/i);
			await page.waitForTimeout(ShortTimeout);

			// Should go to commit selection step (because toggle was enabled)
			await quickPick.waitForStep({ title: /Merge/i, placeholder: /Choose a commit/i });

			// Select a commit to merge
			await quickPick.selectItem(/Feature 1 commit/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Merge/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → commits
			await quickPick.goBackAndWaitForStep({ title: /Merge/i, placeholder: /Choose a commit/i });

			// Back from commits → branch
			await quickPick.goBackAndWaitForStep({ title: /Merge/i, placeholder: /Choose a branch/i });

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Rebase Flow', () => {
		test('Complete flow: command → branch → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'rebase', {
				title: /Rebase/i,
				placeholder: /Choose a branch/i,
			});

			// Select a branch to rebase onto
			await quickPick.enterTextAndWaitForItems('feature-1');
			await quickPick.selectItem(/feature-1/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Rebase/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → branch
			await quickPick.goBackAndWaitForStep({ title: /Rebase/i, placeholder: /Choose a branch/i });

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Select current branch + current commit: command → branch (main) → commits -> confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'rebase', {
				title: /Rebase/i,
				placeholder: /Choose a branch/i,
			});

			// Select the current branch (main) forces commit selection
			// Use a pattern that matches "main" at the start but allows for additional text (icons, description)
			await quickPick.selectItem(/^\s*main\s/i);
			await page.waitForTimeout(ShortTimeout);

			// Select the most recent commit (Fourth commit) - rebasing onto HEAD results in "Nothing to rebase"
			await quickPick.waitForStep({ title: /Rebase/i, placeholder: /Choose a commit/i });
			await quickPick.enterTextAndWaitForItems('Fourth');
			await quickPick.selectItem(/Fourth commit/i);

			await quickPick.waitForStep({ title: /Confirm Rebase main onto/i, placeholder: /Nothing to rebase/i });

			// === REVERSE NAVIGATION ===

			// Back confirm → commits
			await quickPick.goBackAndWaitForStep({ title: /Rebase/i, placeholder: /Choose a commit/i });

			// Back from commits → branch
			await quickPick.goBackAndWaitForStep({ title: /Rebase/i, placeholder: /Choose a branch/i });

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Select current branch + non-current commit: command → branch (main) → commits → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'rebase', {
				title: /Rebase/i,
				placeholder: /Choose a branch/i,
			});

			// Select the current branch (main) forces commit selection
			// Use a pattern that matches "main" at the start but allows for additional text (icons, description)
			await quickPick.selectItem(/^\s*main\s/i);
			await page.waitForTimeout(ShortTimeout);

			// Select an older commit (Third commit) - allows a real rebase operation
			await quickPick.waitForStep({ title: /Rebase/i, placeholder: /Choose a commit/i });
			await quickPick.enterTextAndWaitForItems('Third');
			await quickPick.selectItem(/Third commit/i);

			await quickPick.waitForStep({ title: /Confirm Rebase main onto/i, placeholder: /Confirm Rebase/i });

			// === REVERSE NAVIGATION ===

			// Back confirm → commits
			await quickPick.goBackAndWaitForStep({ title: /Rebase/i, placeholder: /Choose a commit/i });

			// Back from commits → branch
			await quickPick.goBackAndWaitForStep({ title: /Rebase/i, placeholder: /Choose a branch/i });

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Toggle commit selection: command → toggle button → branch → commits → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'rebase', {
				title: /Rebase/i,
				placeholder: /Choose a branch/i,
			});

			// At branch selection step, click the commit toggle button (initially shows "Choose a Branch")
			// The button tooltip when off is "Choose a Branch or Tag", click to toggle to commit mode
			await quickPick.clickActionButton(/Choose a Branch/i);

			// Select a branch (after toggle, selecting a branch will then show commits)
			await quickPick.enterTextAndWaitForItems('feature-1');
			await quickPick.selectItem(/feature-1/i);
			await page.waitForTimeout(ShortTimeout);

			// Should go to commit selection step (because toggle was enabled)
			await quickPick.waitForStep({ title: /Rebase/i, placeholder: /Choose a commit/i });

			// Select a commit to rebase onto
			await quickPick.selectItem(/Feature 1 commit/i);

			// Confirm step - title is "Confirm Rebase main onto <sha> (<message>)"
			await quickPick.waitForStep({ title: /Confirm Rebase main onto/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → commits
			await quickPick.goBackAndWaitForStep({ title: /Rebase/i, placeholder: /Choose a commit/i });

			// Back from commits → branch
			await quickPick.goBackAndWaitForStep({ title: /Rebase/i, placeholder: /Choose a branch/i });

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Cherry-pick Flow', () => {
		test('Complete flow with commits: command → branch → commits → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'cherry', {
				title: /Cherry Pick/i,
				placeholder: /Choose a branch/i,
			});

			// Select main branch which has commits ahead of current branch
			// Select feature-1 which should have commits different from main
			await quickPick.enterTextAndWaitForItems('feature-1');
			await quickPick.selectItem(/feature-1/i);

			// Select a commit
			await page.waitForTimeout(ShortTimeout);
			await quickPick.waitForStep({ title: /Cherry Pick/i, placeholder: /Choose commit/i });
			await quickPick.selectItemMulti(/Feature 1 commit/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → commits
			await quickPick.goBackAndWaitForStep({ title: /Cherry Pick/i, placeholder: /Choose commit/i });

			// Back from commits → branch
			await quickPick.goBackAndWaitForStep({ title: /Cherry Pick/i, placeholder: /Choose a branch/i });

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('No commits to pick flow: command → branch → no commits & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'cherry', {
				title: /Cherry Pick/i,
				placeholder: /Choose a branch/i,
			});

			// Select a branch to pick from - main is currently checked out, so picking from main has no commits
			// Select develop which was branched from main at the same point, so no unique commits
			await quickPick.enterTextAndWaitForItems('develop');
			await quickPick.selectItem(/develop/i);

			// Should show "no commits" placeholder
			await quickPick.waitForStep({ title: /Cherry Pick/i, placeholder: /No pickable commits/i });

			// === REVERSE NAVIGATION ===

			// Back from commits → branch
			await quickPick.goBackAndWaitForStep({ title: /Cherry Pick/i, placeholder: /Choose a branch/i });

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Reset Flow', () => {
		test('Complete flow: command → commit → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'reset', {
				title: /Reset Branch/i,
				placeholder: /Choose a commit/i,
			});

			// Select a commit to reset to
			await quickPick.selectItem(/commit/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Reset Branch/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → commit
			await quickPick.goBackAndWaitForStep({ title: /Reset Branch/i, placeholder: /Choose a commit/i });

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Revert Flow', () => {
		test('Complete flow: command → commits → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'revert', {
				title: /Revert/i,
				placeholder: /Choose commit/i,
			});

			// Select a commit to revert
			await quickPick.selectItemMulti(/commit/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Revert/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → commits
			await quickPick.goBackAndWaitForStep({ title: /Revert/i, placeholder: /Choose commit/i });

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});
});

test.describe('Quick Wizard — Log/Show/Search Commands', () => {
	test.describe('Log Flow', () => {
		test('Complete flow: command → branch → commits → show & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'log', {
				title: /Commits/i,
				placeholder: /Choose a branch/i,
			});

			// Select a branch
			await quickPick.enterTextAndWaitForItems('main');
			await quickPick.selectItem(/main/i);

			await quickPick.waitForStep({ title: /Commits/i, placeholder: /Choose a commit/i });

			// Ensure items appear
			await quickPick.waitForItems(ShortTimeout);
			const count = await quickPick.countItems();
			expect(count).toBeGreaterThan(0);

			// Select a commit
			await quickPick.selectItem(/commit/i);

			// Show step - title is "Commit <sha> (<message>)" - transitions to show command
			await quickPick.waitForStep({ title: /Commit [a-f0-9]+/i });

			// Verify we're in files mode by checking for the toggle to actions hint
			const items = await quickPick.getVisibleItems();
			expect(items.some(item => /Click to see.*actions/i.test(item))).toBeTruthy();

			// === REVERSE NAVIGATION ===

			// Back from show → commits
			await quickPick.goBackAndWaitForStep({ title: /Commits/i, placeholder: /Choose a commit/i });

			// Back from commits → branch
			await quickPick.goBackAndWaitForStep({ title: /Commits/i, placeholder: /Choose a branch/i });

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Show Flow', () => {
		test('Complete flow: command → reference input → commit details & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'show', {
				title: /Show/i,
				placeholder: /Enter a reference or commit SHA/i,
			});

			// Enter a reference (HEAD or main) and submit
			await quickPick.enterTextAndSubmit('HEAD');

			// Should show commit details - title is "Commit <sha> (<message>)"
			await quickPick.waitForStep({ title: /Commit [a-f0-9]+/i });

			// Verify we're in actions mode by checking for the toggle to files hint
			const items = await quickPick.getVisibleItems();
			expect(items.some(item => /Click to see.*files/i.test(item))).toBeTruthy();

			// === REVERSE NAVIGATION ===

			// Back from commit details → reference input
			await quickPick.goBackAndWaitForStep({ title: /Show/i, placeholder: /Enter a reference or commit SHA/i });

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Search Flow', () => {
		test('Complete flow: command → search query → results → commit details & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'search', {
				title: /Commit Search/i,
				placeholder: /e.g. "Updates dependencies" author:eamodio/i,
			});

			// Enter a search query and submit (search for "Fourth" which should match our test commit)
			await quickPick.enterTextAndSubmit('Fourth');

			// Wait for search results
			await quickPick.waitForStep({ title: /Commit Search/i, placeholder: /.* results for/i });

			// Ensure items appear
			await quickPick.waitForItems(ShortTimeout);
			const count = await quickPick.countItems();
			expect(count).toBeGreaterThan(0);

			// Filter to find a specific commit (avoid stashes which also match "commit")
			await quickPick.enterTextAndWaitForItems('Fourth');
			await quickPick.selectItem(/Fourth commit/i);

			// Should show commit details - title is "Commit <sha> (<message>)"
			await quickPick.waitForStep({ title: /Commit [a-f0-9]+/i });

			// === REVERSE NAVIGATION ===

			// Back from commit details → search results
			await quickPick.goBack();
			// May be at search results or back to search input depending on flow
			const stepIndex = await quickPick.waitForAnyStep([
				{ title: /Commit Search|Searching for/i, placeholder: /.* results for/i },
				{ title: /Commit Search/i, placeholder: /e.g. "Updates dependencies"/i },
			]);

			if (stepIndex === 0) {
				// At search results, go back to search input
				await quickPick.goBackAndWaitForStep({
					title: /Commit Search/i,
					placeholder: /e.g. "Updates dependencies"/i,
				});
			}

			// Now at search input - if there's a query value, first back clears it
			const inputValue = await quickPick.input.inputValue();
			if (inputValue.trim()) {
				// First back clears the query, second back goes to previous step
				await quickPick.goBack();
			}

			// Now at search input with empty query, continue reverse
			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Search operators: verify all search operator options are shown', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'search', {
				title: /Commit Search/i,
				placeholder: /e.g. "Updates dependencies" author:eamodio/i,
			});

			// Verify search operators are shown in the list
			const items = await quickPick.getVisibleItems();

			// Check for expected search operators
			expect(items.some(item => item.includes('Search by Message'))).toBeTruthy();
			expect(items.some(item => item.includes('Search by Author'))).toBeTruthy();
			expect(items.some(item => item.includes('Search by Commit SHA'))).toBeTruthy();
			expect(items.some(item => item.includes('Search by Reference or Range'))).toBeTruthy();
			expect(items.some(item => item.includes('Search by Type'))).toBeTruthy();
			expect(items.some(item => item.includes('Search by File'))).toBeTruthy();
			expect(items.some(item => item.includes('Search by Changes'))).toBeTruthy();
			expect(items.some(item => item.includes('Search After Date'))).toBeTruthy();
			expect(items.some(item => item.includes('Search Before Date'))).toBeTruthy();

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Search with no results: shows appropriate message', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'search', {
				title: /Commit Search/i,
				placeholder: /e.g. "Updates dependencies" author:eamodio/i,
			});

			// Search for something that won't exist
			await quickPick.enterTextAndWaitForItems('xyznonexistentquery123456789');
			await page.waitForTimeout(ShortTimeout);
			await quickPick.selectItem(/Search for.*xyznonexistentquery123456789/i);

			// Wait for results - should show "No results"
			await quickPick.waitForStep({ title: /Commit Search/i, placeholder: /No results for|0 results for/i });

			// === REVERSE NAVIGATION ===

			await quickPick.goBack();
			await page.waitForTimeout(ShortTimeout);
			await quickPick.waitForStep({
				title: /Commit Search by Message/i,
				placeholder: /e.g. "Updates dependencies"/i,
			});

			// At search input - if there's a query value, first back clears it
			const inputValue = await quickPick.input.inputValue();
			if (inputValue.trim()) {
				// First back clears the query, second back goes to previous step
				await quickPick.goBack();
			}

			await reverseCommandAndRepo(vscode);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Search by author operator: selecting author operator adds to query', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'search', {
				title: /Commit Search/i,
				placeholder: /e.g. "Updates dependencies" author:eamodio/i,
			});

			// Select the "Search by Author" operator
			await quickPick.selectItem(/Search by Author/i);

			// The input should now contain "author:" operator
			await page.waitForTimeout(ShortTimeout / 2);
			const inputValue = await quickPick.input.inputValue();
			expect(inputValue).toContain('author:');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Search by commit SHA operator: selecting SHA operator adds to query', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'search', {
				title: /Commit Search/i,
				placeholder: /e.g. "Updates dependencies" author:eamodio/i,
			});

			// Select the "Search by Commit SHA" operator
			await quickPick.selectItem(/Search by Commit SHA/i);

			// The input should now contain "commit:" operator
			await page.waitForTimeout(ShortTimeout / 2);
			const inputValue = await quickPick.input.inputValue();
			expect(inputValue).toContain('commit:');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Back button clears query first before navigating back', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'search', {
				title: /Commit Search/i,
				placeholder: /e.g. "Updates dependencies" author:eamodio/i,
			});

			// Enter a search query (but don't submit)
			await quickPick.enterText('test query');
			await page.waitForTimeout(ShortTimeout / 2);

			// Verify query is entered
			let inputValue = await quickPick.input.inputValue();
			expect(inputValue).toBe('test query');

			// Press back - should clear the query, not navigate back
			await quickPick.goBack();
			await page.waitForTimeout(ShortTimeout / 2);

			// Verify we're still on the search step with empty query
			await quickPick.waitForStep({
				title: /Commit Search/i,
				placeholder: /e.g. "Updates dependencies" author:eamodio/i,
			});
			inputValue = await quickPick.input.inputValue();
			expect(inputValue).toBe('');

			// Press back again - now should navigate back (to repo or command)
			await quickPick.goBack();
			const stepIndex = await quickPick.waitForAnyStep([
				{ placeholder: /Choose a repository/ },
				{ placeholder: /Choose a command/ },
			]);

			// Verify we navigated back
			expect(stepIndex).toBeGreaterThanOrEqual(0);

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});
});

test.describe('Quick Wizard — Status Command', () => {
	test('Complete flow: command → status info & reverse', async ({
		vscode,
		vscode: {
			gitlens: { quickPick },
		},
	}) => {
		await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'status', { title: /Status/i });

		// Status step shows repository status information
		// Verify items are shown (branch info, changed files, etc.)
		await quickPick.waitForItems(ShortTimeout);
		const count = await quickPick.countItems();
		expect(count).toBeGreaterThan(0);

		// Verify status shows branch information (main branch)
		const items = await quickPick.getVisibleItems();
		expect(items.some(item => /main/i.test(item))).toBeTruthy();

		// === REVERSE NAVIGATION ===

		await reverseCommandAndRepo(vscode);

		await quickPick.cancel();
		expect(await quickPick.isVisible()).toBeFalsy();
	});
});

test.describe('Quick Wizard — Worktree Commands', () => {
	// Enable Pro features for all worktree tests since worktrees are a Pro feature
	test.beforeEach(async ({ vscode }) => {
		await vscode.gitlens.startSubscriptionSimulation();
	});
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.stopSubscriptionSimulation();
	});

	test.describe('Worktree Create Flow', () => {
		test('Create from non-checked-out branch: command → branch picker → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'create', {
				title: /Create Worktree/i,
				placeholder: /Choose a branch/i,
			});

			// Select a non-checked-out branch (feature-2 is not checked out and has no worktree)
			await quickPick.enterTextAndWaitForItems('feature-2');
			await quickPick.selectItem(/feature-2/i);

			// Should go directly to confirm step (no branch name input needed)
			await quickPick.waitForStep({ title: /Confirm Create Worktree.*feature-2/i });

			// Verify the confirm options are shown
			const items = await quickPick.getVisibleItems();
			expect(items.some(item => item.includes('Create Worktree from Branch'))).toBeTruthy();

			// === REVERSE NAVIGATION ===

			// Back from confirm → branch picker
			await quickPick.goBackAndWaitForStep({ title: /Create Worktree/i, placeholder: /Choose a branch/i });

			await reverseCommandSubcommandAndRepo(vscode, 'worktree');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Create from checked-out branch (current branch): command → branch picker → branch name input → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'create', {
				title: /Create Worktree/i,
				placeholder: /Choose a branch/i,
			});

			// Select the current checked-out branch (main) - this triggers the "create new branch" flow
			// because you can't have two worktrees for the same branch
			await quickPick.enterTextAndWaitForItems('main');
			await quickPick.selectItem(/^\s*main\s/i);

			// Should show branch name input step (since main is already checked out)
			await quickPick.waitForStep({
				title: /Create Worktree and New Branch from main/i,
				placeholder: /Branch name/i,
			});

			// Enter a new branch name
			await quickPick.enterTextAndSubmit('new-worktree-branch');

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Create Worktree.*new-worktree-branch/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → branch name input
			await quickPick.goBackAndWaitForStep({
				title: /Create Worktree and New Branch from main/i,
				placeholder: /Branch name/i,
			});

			// Back from branch name input → branch picker
			await quickPick.goBackAndWaitForStep({ title: /Create Worktree/i, placeholder: /Choose a branch/i });

			await reverseCommandSubcommandAndRepo(vscode, 'worktree');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Create from branch with existing worktree: command → branch picker → branch name input & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'create', {
				title: /Create Worktree/i,
				placeholder: /Choose a branch/i,
			});

			// Select the branch that already has a worktree (feature-with-worktree)
			// This should also require creating a new branch
			await quickPick.enterTextAndWaitForItems('feature-with-worktree');
			await quickPick.selectItem(/feature-with-worktree/i);

			// Should show branch name input step (since the branch already has a worktree)
			await quickPick.waitForStep({
				title: /Create Worktree and New Branch from feature-with-worktree/i,
				placeholder: /Branch name/i,
			});

			// Enter a new branch name
			await quickPick.enterTextAndSubmit('new-worktree-branch');

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Create Worktree/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → branch name input
			await quickPick.goBackAndWaitForStep({
				title: /Create Worktree and New Branch from feature-with-worktree/i,
				placeholder: /Branch name/i,
			});

			// Back from branch name input → branch picker
			await quickPick.goBackAndWaitForStep({ title: /Create Worktree/i, placeholder: /Choose a branch/i });

			await reverseCommandSubcommandAndRepo(vscode, 'worktree');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Choose Specific Folder: selecting folder returns to confirm, escaping returns to confirm', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'create', {
				title: /Create Worktree/i,
				placeholder: /Choose a branch/i,
			});

			// Select a non-checked-out branch to get to confirm step quickly
			await quickPick.enterTextAndWaitForItems('feature-2');
			await quickPick.selectItem(/feature-2/i);

			// Wait for confirm step
			await quickPick.waitForStep({ title: /Confirm Create Worktree.*feature-2/i });

			// Select "Choose a Specific Folder..." option
			await quickPick.selectItem(/Choose a Specific Folder/i);

			// The folder picker dialog should appear - press Escape to cancel it
			await page.waitForTimeout(ShortTimeout);
			await page.keyboard.press('Escape');

			// Should return to confirm step after escaping folder picker
			await quickPick.waitForStep({ title: /Confirm Create Worktree.*feature-2/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → branch picker
			await quickPick.goBackAndWaitForStep({ title: /Create Worktree/i, placeholder: /Choose a branch/i });

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Change Root Folder: selecting folder returns to confirm, escaping returns to confirm', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
				page,
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'create', {
				title: /Create Worktree/i,
				placeholder: /Choose a branch/i,
			});

			// Select a non-checked-out branch to get to confirm step quickly
			await quickPick.enterTextAndWaitForItems('feature-2');
			await quickPick.selectItem(/feature-2/i);

			// Wait for confirm step
			await quickPick.waitForStep({ title: /Confirm Create Worktree.*feature-2/i });

			// Select "Change Root Folder..." option
			await quickPick.selectItem(/Change Root Folder/i);

			// The folder picker dialog should appear - press Escape to cancel it
			await page.waitForTimeout(ShortTimeout);
			await page.keyboard.press('Escape');

			// Should return to confirm step after escaping folder picker
			await quickPick.waitForStep({ title: /Confirm Create Worktree.*feature-2/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → branch picker
			await quickPick.goBackAndWaitForStep({ title: /Create Worktree/i, placeholder: /Choose a branch/i });

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		// This test must run LAST in the Worktree Create Flow section because it actually creates a worktree
		test('Create → Open transition: after creating worktree, open prompt appears', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'create', {
				title: /Create Worktree/i,
				placeholder: /Choose a branch/i,
			});

			// Select a non-checked-out branch (feature-2 has no worktree yet)
			await quickPick.enterTextAndWaitForItems('feature-2');
			await quickPick.selectItem(/feature-2/i);

			// Should go directly to confirm step (no branch name input needed)
			await quickPick.waitForStep({ title: /Confirm Create Worktree.*feature-2/i });

			// Confirm to actually create the worktree
			// Select the default option "Create Worktree from Branch"
			await quickPick.selectItem(/Create Worktree from Branch/i);

			// After worktree is created, should transition to "Open Worktree" confirm step
			// The default setting is "prompt" so the open dialog should appear
			await quickPick.waitForStep(
				{ title: /Open Worktree.*feature-2|Confirm.*Open.*Worktree/i },
				15000, // Worktree creation can take a moment
			);

			// Verify the open options are shown
			const items = await quickPick.getVisibleItems();
			expect(items.some(item => item.includes('Open Worktree'))).toBeTruthy();
			expect(items.some(item => item.includes('New Window'))).toBeTruthy();

			// Cancel without opening the worktree (to avoid changing the workspace)
			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Worktree Open Flow', () => {
		test('Complete flow: command → subcommand → worktree picker → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'open', {
				title: /Open Worktree|Worktree/i,
				placeholder: /Choose worktree/i,
			});

			// Verify worktrees are shown
			await quickPick.waitForItems(ShortTimeout);
			const count = await quickPick.countItems();
			expect(count).toBeGreaterThan(0);

			// Select a worktree (the one we created in setup: feature-with-worktree)
			await quickPick.selectItem(/feature-with-worktree/i);

			// Confirm step with open options
			await quickPick.waitForStep({ title: /Open Worktree.*feature-with-worktree|Confirm.*Open.*Worktree/i });

			// Verify confirm options are shown
			const items = await quickPick.getVisibleItems();
			expect(items.some(item => item.includes('Open Worktree'))).toBeTruthy();
			expect(items.some(item => item.includes('New Window'))).toBeTruthy();
			expect(items.some(item => item.includes('Add Worktree to Workspace'))).toBeTruthy();
			expect(items.some(item => item.includes('Reveal in File Explorer'))).toBeTruthy();

			// === REVERSE NAVIGATION ===

			// Back from confirm → worktree picker
			await quickPick.goBackAndWaitForStep({ title: /Open Worktree|Worktree/i, placeholder: /Choose worktree/i });

			await reverseCommandSubcommandAndRepo(vscode, 'worktree');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Confirm options: Open in current window, new window, add to workspace, reveal in explorer', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'open', {
				title: /Open Worktree|Worktree/i,
				placeholder: /Choose worktree/i,
			});

			// Select a worktree
			await quickPick.waitForItems(ShortTimeout);
			await quickPick.selectItem(/feature-with-worktree/i);

			// Wait for confirm step
			await quickPick.waitForStep({ title: /Open Worktree.*feature-with-worktree|Confirm.*Open.*Worktree/i });

			// Verify all expected options are present
			// Note: getVisibleItems() returns all text content including descriptions
			const items = await quickPick.getVisibleItems();
			const hasOpenWorktree = items.some(item => item.includes('open the worktree in the current window'));
			const hasNewWindow = items.some(item => item.includes('New Window'));
			const hasAddToWorkspace = items.some(item => item.includes('Add Worktree to Workspace'));
			const hasRevealExplorer = items.some(item => item.includes('Reveal in File Explorer'));

			expect(hasOpenWorktree).toBeTruthy();
			expect(hasNewWindow).toBeTruthy();
			expect(hasAddToWorkspace).toBeTruthy();
			expect(hasRevealExplorer).toBeTruthy();

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Worktree Delete Flow', () => {
		test('Complete flow: command → subcommand → pick worktrees → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'delete', {
				title: /Delete Worktree/i,
				placeholder: /Choose worktrees to delete/i,
			});

			// Verify worktrees are shown
			await quickPick.waitForItems(ShortTimeout);
			const count = await quickPick.countItems();
			expect(count).toBeGreaterThan(0);

			// Select a worktree to delete (the one we created in setup: feature-with-worktree)
			await quickPick.enterTextAndWaitForItems('feature-with-worktree');
			await quickPick.selectItemMulti(/feature-with-worktree/i);

			// Confirm step
			await quickPick.waitForStep({ title: /Confirm Delete Worktree/i });

			// === REVERSE NAVIGATION ===

			// Back from confirm → worktree picker
			await quickPick.goBackAndWaitForStep({ title: /Delete Worktree/i, placeholder: /Choose worktree/i });

			await reverseCommandSubcommandAndRepo(vscode, 'worktree');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});

		test('Confirm options: Delete, Force Delete, Delete with Branch, Force Delete with Branch', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'delete', {
				title: /Delete Worktree/i,
				placeholder: /Choose worktrees to delete/i,
			});

			// Select a worktree
			await quickPick.waitForItems(ShortTimeout);
			await quickPick.selectItemMulti(/feature-with-worktree/i);

			// Wait for confirm step
			await quickPick.waitForStep({ title: /Confirm Delete Worktree/i });

			// Verify all expected options are present
			// Note: getVisibleItems() returns all text content including descriptions
			const items = await quickPick.getVisibleItems();
			// Basic delete has "Will delete worktree" without "forcibly"
			const hasDelete = items.some(
				item => item.includes('Delete Worktree') && item.includes('Will delete') && !item.includes('forcibly'),
			);
			const hasForceDelete = items.some(item => item.includes('Force Delete Worktree'));
			const hasDeleteWithBranch = items.some(item => item.includes('Delete Worktree & Branch'));
			const hasForceDeleteWithBranch = items.some(item => item.includes('Force Delete Worktree & Branch'));

			expect(hasDelete).toBeTruthy();
			expect(hasForceDelete).toBeTruthy();
			expect(hasDeleteWithBranch).toBeTruthy();
			expect(hasForceDeleteWithBranch).toBeTruthy();

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});

	test.describe('Worktree Copy Changes Flow', () => {
		test('Complete flow: command → subcommand → worktree picker → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'copy-changes', {
				title: /Copy.*Changes to Worktree/i,
				placeholder: /Choose a worktree to copy/i,
			});

			// Verify worktrees are shown
			await quickPick.waitForItems(ShortTimeout);
			const count = await quickPick.countItems();
			expect(count).toBeGreaterThan(0);

			try {
				// Create uncommitted changes BEFORE selecting worktree
				// The diff is checked after worktree selection, so changes must exist at that point
				await git.createFile('test-file.txt', 'modified content for copy changes test');

				// Select a target worktree
				await quickPick.selectItem(/feature-with-worktree/i);

				// Wait for confirm step (we have uncommitted changes)
				await quickPick.waitForStep({ title: /Confirm Copy.*Changes/i });

				// Verify confirm options
				const items = await quickPick.getVisibleItems();
				expect(items.some(item => item.includes('Copy'))).toBeTruthy();

				// === REVERSE NAVIGATION ===
				await quickPick.goBackAndWaitForStep({
					title: /Copy.*Changes to Worktree/i,
					placeholder: /Choose a worktree/i,
				});

				await reverseCommandSubcommandAndRepo(vscode, 'worktree');

				await quickPick.cancel();
				expect(await quickPick.isVisible()).toBeFalsy();
			} finally {
				// Clean up uncommitted changes
				await git.reset('HEAD', 'hard');
			}
		});

		test('Complete flow without any changes: command → subcommand → worktree picker → confirm & reverse', async ({
			vscode,
			vscode: {
				gitlens: { quickPick },
			},
		}) => {
			await selectCommandSubcommandAndWaitForStepWithOptionalRepo(vscode, 'worktree', 'copy-changes', {
				title: /Copy.*Changes to Worktree/i,
				placeholder: /Choose a worktree to copy/i,
			});

			// Verify worktrees are shown
			await quickPick.waitForItems(ShortTimeout);
			const count = await quickPick.countItems();
			expect(count).toBeGreaterThan(0);

			// Select a target worktree
			await quickPick.selectItem(/feature-with-worktree/i);

			// Wait for confirm step (we have uncommitted changes)
			await quickPick.waitForStep({ title: /Confirm Copy.*Changes/i });

			// Verify confirm options
			const items = await quickPick.getVisibleItems();
			expect(items.some(item => item.includes('OK'))).toBeTruthy();

			// === REVERSE NAVIGATION ===
			await quickPick.goBackAndWaitForStep({
				title: /Copy.*Changes to Worktree/i,
				placeholder: /Choose a worktree/i,
			});

			await reverseCommandSubcommandAndRepo(vscode, 'worktree');

			await quickPick.cancel();
			expect(await quickPick.isVisible()).toBeFalsy();
		});
	});
});

test.describe('Quick Wizard — Co-Authors Command', () => {
	test('Complete flow: command → contributors picker & reverse', async ({
		vscode,
		vscode: {
			gitlens: { quickPick },
		},
	}) => {
		await selectCommandAndWaitForStepWithOptionalRepo(vscode, 'co-author', { title: /Add Co-Author/i });

		// === REVERSE NAVIGATION ===

		await reverseCommandAndRepo(vscode);

		await quickPick.cancel();
		expect(await quickPick.isVisible()).toBeFalsy();
	});
});

test.describe('Quick Wizard — Direct Command Access', () => {
	test.describe('Branch Direct Commands', () => {
		test('Direct branch create command opens at create step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'branch.create', { title: /Create Branch/i });
		});

		test('Direct branch delete command opens at delete step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'branch.delete', { title: /Delete Branch/i });
		});

		test('Direct branch rename command opens at rename step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'branch.rename', { title: /Rename Branch/i });
		});
	});

	test.describe('Switch Direct Commands', () => {
		test('Direct switch command opens at switch step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'switch', { title: /Switch/i });
		});
	});

	test.describe('Tag Direct Commands', () => {
		test('Direct tag create command opens at create step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'tag.create', { title: /Create Tag/i });
		});

		test('Direct tag delete command opens at delete step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'tag.delete', { title: /Delete Tag/i });
		});
	});

	test.describe('Stash Direct Commands', () => {
		test('Direct stash push command opens at push step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'stash.push', { title: /Stash/i });
		});

		test('Direct stash list command opens at list step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'stash.list', { title: /Stash/i });
		});

		test('Direct stash pop command opens at pop step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'stash.pop', { title: /Stash/i });
		});

		test('Direct stash drop command opens at drop step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'stash.drop', { title: /Stash/i });
		});

		test('Direct stash rename command opens at rename step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'stash.rename', { title: /Stash/i });
		});
	});

	test.describe('Remote Direct Commands', () => {
		test('Direct remote add command opens at add step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'remote.add', { title: /Remote/i });
		});

		test('Direct remote prune command opens at prune step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'remote.prune', { title: /Remote/i });
		});

		test('Direct remote remove command opens at remove step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'remote.remove', { title: /Remote/i });
		});
	});

	test.describe('Merge/Rebase/Cherry-pick/Reset/Revert Direct Commands', () => {
		test('Direct merge command opens at merge step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'merge', { title: /Merge/i });
		});

		test('Direct rebase command opens at rebase step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'rebase', { title: /Rebase/i });
		});

		test('Direct cherry-pick command opens at cherry-pick step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'cherryPick', { title: /Cherry Pick/i });
		});

		test('Direct reset command opens at reset step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'reset', { title: /Reset/i });
		});

		test('Direct revert command opens at revert step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'revert', { title: /Revert/i });
		});
	});

	test.describe('Worktree Direct Commands', () => {
		test('Direct worktree create command opens at create step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'worktree.create', { title: /Create Worktree|Worktree/i });
		});

		test('Direct worktree open command opens at open step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'worktree.open', { title: /Open Worktree|Worktree/i });
		});

		test('Direct worktree delete command opens at delete step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'worktree.delete', { title: /Delete Worktree|Worktree/i });
		});
	});

	test.describe('Show/Status Direct Commands', () => {
		test('Direct show command opens at show step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'show', { title: /Show/i });
		});

		test('Direct status command opens at status step', async ({ vscode }) => {
			await testDirectGitCommand(vscode.gitlens, 'status', { title: /Status/i });
		});
	});
});

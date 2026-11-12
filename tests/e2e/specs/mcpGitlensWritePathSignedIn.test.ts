/**
 * MCP E2E — GitLens write-path tools, integration-backed happy paths (#5106)
 *
 * The validation and failure paths live in `mcpGitlensWritePath.test.ts`. These need what an unattended
 * run could not reach before #5682: a GitKraken account with a connected hosting integration. The worker
 * signs in to the test account (`vscodeOptions.signIn`, see `fixtures/gkSignIn.ts`), which brings the
 * account's cloud integrations with it, and opens a fresh clone of the GitHub test repository.
 *
 * What is asserted is GitLens' side (#5106 scope): the call reaches the live extension host, the wizard
 * runs to completion without a person, and what it reports matches what git now holds — never what the
 * CLI itself decided.
 *
 * Plan: Start Work / Start Review are Pro on every repository, and the test account's own plan changes over
 * time (free, trial), so every case runs under a simulated Pro subscription (`gitlens.plus.simulate.subscription`,
 * present in `bundle:e2e`) for a deterministic gate.
 *
 * Which issue Start Work can take: it matches the URL against the connected GitHub account's own issues
 * (assigned to, authored by or mentioning it), not by fetching the URL. The issue must be one of those for the
 * GitHub account bound to the test GitKraken account. Start Review looks the PR up by URL.
 *
 * Inputs (repository variables in CI — public values, kept visible for diagnosis; the spec skips when any is
 * missing, and fails under `E2E_REQUIRE_SIGNIN`). Canonical GitHub URLs, no trailing slash — Start Work matches
 * the issue URL exactly:
 * - `E2E_GITHUB_REPO_URL` — the test repository to clone
 * - `E2E_GITHUB_ISSUE_URL` — an open issue in it that belongs to the bound GitHub account (Start Work)
 * - `E2E_GITHUB_PR_URL` — an open PR in it whose branch lives in the repository itself, not in a fork (Start
 *   Review tracks a fork's branch on a remote named after the fork's owner, not `origin`)
 *
 * A private test repository also needs `GK_E2E_GITHUB_TOKEN` (a secret): a token that can only read that repository,
 * used to clone it and, through the clone's own config, for the editor's fetches (see `fixtures/testRepository.ts`).
 *
 * Both tools open the new worktree in a second window (the wizard defaults), which the worker closes only at
 * teardown, after `afterAll` — and on Windows files an editor holds open can't be deleted. So `afterAll` only
 * removes the clone's credential, and the clone itself goes in a worker fixture that is torn down after the editor
 * (`cloneCleanup`).
 *
 * No traces, videos or screenshots (account UI), no retries (each retry is a new worker and a new
 * non-expiring account token).
 */
import * as process from 'node:process';
import { canSignIn, createTmpDir, MaxTimeout } from '../baseTest.js';
import type { McpMessage } from '../fixtures/mcp.js';
import { expect, mcpTest } from '../fixtures/mcp.js';
import {
	git,
	gitlensLogDiagnosis,
	localBranches,
	normalizePath,
	TestRepositoryClone,
	testRepositoryUrl,
	worktreePaths,
} from '../fixtures/testRepository.js';

const repoUrl = testRepositoryUrl;
const issueUrl = process.env.E2E_GITHUB_ISSUE_URL;
const prUrl = process.env.E2E_GITHUB_PR_URL;

const clone = new TestRepositoryClone('[5106]');

const test = mcpTest.extend<object, { cloneCleanup: void }>({
	// Removes the clone and its worktrees once the worker's editor is gone. Auto and independent of `vscode`, so it
	// is set up before it and torn down after it: worker fixtures tear down in reverse order of setup.
	cloneCleanup: [
		// oxlint-disable-next-line no-empty-pattern -- Playwright fixtures declare their dependencies by destructuring
		async ({}, use) => {
			await use();
			await clone.remove();
		},
		{ scope: 'worker', auto: true },
	],
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			signIn: { requiredIntegrations: ['GitHub'] },
			setup: async () => clone.create(await createTmpDir()),
		},
		{ scope: 'worker' },
	],
});

const missingInputs = !repoUrl || !issueUrl || !prUrl;

if (missingInputs && process.env.E2E_REQUIRE_SIGNIN) {
	throw new Error(
		'E2E_GITHUB_REPO_URL / E2E_GITHUB_ISSUE_URL / E2E_GITHUB_PR_URL are required (E2E_REQUIRE_SIGNIN) but not all set',
	);
}

test.skip(!canSignIn(), 'GK_E2E_ACCESS_TOKEN_COOKIE is not set');
test.skip(missingInputs, 'E2E_GITHUB_REPO_URL / E2E_GITHUB_ISSUE_URL / E2E_GITHUB_PR_URL are not set');
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

type ToolResult = { content?: { text?: string }[]; isError?: boolean };
type StartResult = { branchName?: string; worktreePath?: string; prUrl?: string; prTitle?: string };

/**
 * The success payload is JSON nested in strings several times over (`text` → `{ data }` → `{ stdout }` →
 * the result, measured 09.10 on CLI 3.1.x). Unwrap until the result object appears rather than pinning the
 * nesting depth, which is the CLI's business.
 */
function decodeStartResult(response: McpMessage): StartResult {
	expect(
		response.error,
		`expected a result, got a JSON-RPC error: ${JSON.stringify(response.error)}`,
	).toBeUndefined();
	const result = response.result as ToolResult | undefined;
	const text = result?.content?.[0]?.text;
	expect(result?.isError, `expected success; text=${text}`).not.toBe(true);
	expect(text, 'result should carry text content').toBeTruthy();

	let value: unknown = text;
	for (let depth = 0; depth < 6; depth++) {
		if (typeof value === 'string') {
			try {
				value = JSON.parse(value);
			} catch {
				break;
			}
			continue;
		}
		if (value != null && typeof value === 'object') {
			if ('branchName' in value) return value as StartResult;

			const next = (value as { data?: unknown; stdout?: unknown }).data ?? (value as { stdout?: unknown }).stdout;
			if (next === undefined) break;

			value = next;
			continue;
		}
		break;
	}
	throw new Error(`no branchName in the start result: ${text}`);
}

test.describe('MCP — GitLens write path (signed in, integration-backed)', { tag: '@signed-in' }, () => {
	test.describe.configure({ mode: 'serial', retries: 0 });
	// Live GitHub lookups, a fetch and a worktree per test, and the first one also waits out MCP readiness
	test.slow();

	test.beforeEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test.afterEach(({ vscode }, testInfo) => {
		if (testInfo.status === testInfo.expectedStatus) return;

		const lines = gitlensLogDiagnosis(vscode.electron.args);
		console.log(`[5106] GitLens log after "${testInfo.title}":\n${lines.join('\n')}`);
	});

	test.afterAll(async ({ vscode }) => {
		await vscode.gitlens.stopSubscriptionSimulation().catch(() => {});
	});

	// No fixtures, so it runs even when the worker failed to start or sign in (a hook taking `vscode` is skipped
	// then) — the clone is set up before the sign-in, and must not keep its token either way. As early as possible:
	// the clone itself is removed only after the editor closes (`cloneCleanup`), and must not hold the token until
	// then (the worktrees share it).
	test.afterAll(() => {
		clone.removeCredential();
	});

	// Review first: it looks the PR up by URL, while Start Work depends on the issue belonging to the bound
	// GitHub account — so a misconfigured issue does not hide the review result (serial skips the rest).
	test('gitlens_start_review checks out the PR head in a worktree with its upstream', async ({
		mcpClient,
		vscode,
	}) => {
		const sim = await vscode.gitlens.startSubscriptionSimulation();
		expect(sim.success, 'Pro simulation started').toBe(true);

		const response = await mcpClient.callTool('gitlens_start_review', { directory: clone.path, pr_url: prUrl });
		const started = decodeStartResult(response);

		const prNumber = new URL(prUrl!).pathname.split('/').pop()!;
		expect(started.branchName, 'branch named after the PR').toMatch(new RegExp(`^pr/${prNumber}-`));
		expect(started.prUrl, 'the reported PR is the requested one').toBe(prUrl);
		expect(localBranches(clone.path!), 'the branch now exists in git').toContain(started.branchName);

		expect(started.worktreePath, 'a worktree path is reported').toBeTruthy();
		expect(worktreePaths(clone.path!), 'git lists the reported worktree').toContain(
			normalizePath(started.worktreePath!),
		);

		// The PR head as the host publishes it — independent of how GitLens fetched it
		const prHead = git(clone.path!, 'ls-remote', 'origin', `refs/pull/${prNumber}/head`).split(/\s+/)[0];
		expect(prHead, 'the host publishes the PR head').toMatch(/^[0-9a-f]{40}$/);
		expect(git(started.worktreePath!, 'rev-parse', 'HEAD'), 'the worktree is at the PR head').toBe(prHead);
		// The PR branch is the origin branch whose tip is the PR head (the PR is from the repository itself, not a fork).
		// The tip identifies it only while no other branch shares it, so the fixture must keep it unique: with two
		// candidates an upstream on the wrong one would pass
		const prBranches = git(clone.path!, 'ls-remote', '--heads', 'origin')
			.split('\n')
			.filter(l => l.startsWith(prHead))
			.map(l => `origin/${l.split(/\s+/)[1].slice('refs/heads/'.length)}`);
		expect(prBranches, 'exactly one origin branch is at the PR head (fixture)').toHaveLength(1);
		expect(
			git(started.worktreePath!, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'),
			'the review branch tracks the PR branch on origin',
		).toBe(prBranches[0]);

		await expect(vscode.page.locator('.quick-input-widget')).toBeHidden({ timeout: MaxTimeout });
	});

	test('gitlens_start_work creates the issue branch and its worktree', async ({ mcpClient, vscode }) => {
		const sim = await vscode.gitlens.startSubscriptionSimulation();
		expect(sim.success, 'Pro simulation started').toBe(true);

		const before = localBranches(clone.path!);
		const response = await mcpClient.callTool('gitlens_start_work', { directory: clone.path, issue_url: issueUrl });
		const started = decodeStartResult(response);

		const issueNumber = new URL(issueUrl!).pathname.split('/').pop()!;
		expect(started.branchName, 'branch named after the issue').toMatch(new RegExp(`^${issueNumber}-`));
		expect(before, 'the branch did not exist before').not.toContain(started.branchName);
		expect(localBranches(clone.path!), 'the branch now exists in git').toContain(started.branchName);

		expect(started.worktreePath, 'a worktree path is reported').toBeTruthy();
		expect(worktreePaths(clone.path!), 'git lists the reported worktree').toContain(
			normalizePath(started.worktreePath!),
		);
		expect(git(started.worktreePath!, 'branch', '--show-current'), 'the worktree is on the new branch').toBe(
			started.branchName,
		);
		expect(git(started.worktreePath!, 'rev-parse', 'HEAD'), 'the issue branch starts from the default branch').toBe(
			git(clone.path!, 'rev-parse', 'HEAD'),
		);

		await expect(vscode.page.locator('.quick-input-widget')).toBeHidden({ timeout: MaxTimeout });
	});
});

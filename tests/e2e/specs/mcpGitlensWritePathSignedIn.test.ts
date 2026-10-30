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
 * used to clone it and, through the clone's own config, for the editor's fetches (see {@link cloneTestRepository}).
 *
 * Both tools open the new worktree in a second window (the wizard defaults), which the worker closes only at
 * teardown, after `afterAll` — so the clone cleanup retries and reports a folder still held open instead of
 * failing the run.
 *
 * No traces, videos or screenshots (account UI), no retries (each retry is a new worker and a new
 * non-expiring account token).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import * as process from 'node:process';
import { canSignIn, createTmpDir, MaxTimeout } from '../baseTest.js';
import type { McpMessage } from '../fixtures/mcp.js';
import { expect, mcpTest } from '../fixtures/mcp.js';

const repoUrl = process.env.E2E_GITHUB_REPO_URL;
const issueUrl = process.env.E2E_GITHUB_ISSUE_URL;
const prUrl = process.env.E2E_GITHUB_PR_URL;
// Trimmed as the sign-in secrets are: a stored value often ends in a newline
const repoToken = process.env.GK_E2E_GITHUB_TOKEN?.trim();

let clonePath: string | undefined;

const test = mcpTest.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			signIn: { requiredIntegrations: ['GitHub'] },
			setup: async () => {
				const parent = await createTmpDir();
				clonePath = path.join(parent, path.basename(repoUrl!));
				cloneTestRepository(repoUrl!, clonePath, repoToken);
				return clonePath;
			},
		},
		{ scope: 'worker' },
	],
});

const missingInputs = !repoUrl || !issueUrl || !prUrl;

/**
 * Clones the test repository. With a token, the credential is an `http.<repository>/.extraheader`, as
 * `actions/checkout` sets one: handed to `git clone` through `GIT_CONFIG_*` (not its arguments, which show in process
 * lists and error messages), then written to the clone's own config so the editor's later fetches (Start Review)
 * authenticate too. Never in the remote URL, which git and GitLens display and log. The credential is
 * removed from the clone's config first thing at teardown, the clone is then deleted, and the header is masked out of
 * the GitLens log diagnosis ({@link redactLog}).
 */
function cloneTestRepository(url: string, dest: string, token: string | undefined): void {
	// The sign-in credentials stay in this process, as they do for the editor (baseTest.ts)
	const env = nonInteractiveGitEnv();
	if (!token) {
		execFileSync('git', ['clone', '--quiet', url, dest], { stdio: 'pipe', env: env });
		return;
	}

	const key = `http.${url}/.extraheader`;
	const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
	execFileSync('git', ['clone', '--quiet', url, dest], {
		stdio: 'pipe',
		env: {
			...env,
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: key,
			GIT_CONFIG_VALUE_0: header,
		},
	});
	appendFileSync(path.join(dest, '.git', 'config'), `[http "${url}/"]\n\textraheader = ${header}\n`);
}

/**
 * The environment the spec's own git runs in: no `GK_E2E_*`, and no credential prompts — a private repository
 * without a usable token fails instead of waiting on a terminal prompt or Git Credential Manager's dialog.
 */
function nonInteractiveGitEnv(): NodeJS.ProcessEnv {
	return {
		...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GK_E2E_'))),
		GIT_TERMINAL_PROMPT: '0',
		GCM_INTERACTIVE: 'never',
	};
}

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

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, {
		cwd: cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: nonInteractiveGitEnv(),
	}).trim();
}

function localBranches(repo: string): string[] {
	return git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean);
}

/** `git worktree list` paths, normalized — GitLens reports a lowercase drive and forward slashes on Windows. */
function worktreePaths(repo: string): string[] {
	return git(repo, 'worktree', 'list', '--porcelain')
		.split('\n')
		.filter(l => l.startsWith('worktree '))
		.map(l => normalize(l.slice('worktree '.length)));
}

function normalize(p: string): string {
	return path.resolve(p).replaceAll('\\', '/').toLowerCase();
}

/**
 * Masks what the GitLens log can carry from this worker's sign-in before any of it reaches the job log, where
 * GitHub masks only the configured secrets — never the account tokens a sign-in mints:
 * - the GK CLI sign-in, `gk auth login -t <token>`: a failed one is logged as `Command failed: <command>` with the
 *   CLI's stderr on the lines after it, and at debug level any stderr is logged with the command (`[EXEC] …`).
 *   Entries naming it are dropped whole, continuation lines included, so no quoting or echo of the token can
 *   slip past a pattern;
 * - the sign-in callback, logged as a link with its one-time `code` and `state`;
 * - anything token-shaped left over (`-t` / `--token` values, `token=`, bearer and basic authorization headers —
 *   the test repository's clone credential among them — and JWT-shaped strings), and e-mail addresses.
 */
function redactLog(lines: string[]): string[] {
	const entryStart = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;
	const cliSignIn = /auth\s+login/i;

	const kept: string[] = [];
	let dropping = false;
	for (const line of lines) {
		if (entryStart.test(line)) {
			dropping = cliSignIn.test(line);
		} else if (cliSignIn.test(line)) {
			dropping = true;
		}
		if (dropping) continue;

		kept.push(
			line
				.replace(/(\s-t\s+|--token[=\s]+)("[^"]*"|'[^']*'|\S+)/gi, '$1<redacted>')
				.replace(/([?&](?:code|state|token)(?:=|%3D))[^&\s"')]+/gi, '$1<redacted>')
				.replace(/(\b(?:Bearer|Basic)\s+)\S+/gi, '$1<redacted>')
				.replace(/\b(?:gh[opsur]_[A-Za-z0-9]{20,}|github_pat_\w+)\b/g, '<redacted>')
				.replace(/("?(?:access|refresh)_?token"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1<redacted>')
				.replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<redacted>')
				.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>'),
		);
	}
	return kept;
}

/**
 * On failure, the GitLens log lines that explain a wizard's decision (issue / PR lookup, launchpad, viewer
 * accounts, integrations) from this worker's profile, masked by {@link redactLog}.
 */
function gitlensLogDiagnosis(electronArgs: string[]): string[] {
	const userDataDir = electronArgs.find(a => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
	if (userDataDir == null) return ['<no --user-data-dir>'];

	const files: string[] = [];
	const walk = (dir: string): void => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				walk(full);
			} else if (full.includes('eamodio.gitlens') && e.name.endsWith('.log')) {
				files.push(full);
			}
		}
	};
	walk(path.join(userDataDir, 'logs'));
	if (!files.length) return ['<no GitLens log under the profile>'];

	const relevant =
		/launchpad|pullrequest|pull request|no current user|unsupported provider|startreview|startwork|start work|review|issue|viewer|integration|error|warn/i;
	return files
		.flatMap(f => redactLog(readFileSync(f, 'utf8').split('\n')))
		.filter(l => relevant.test(l))
		.map(l => l.slice(0, 400))
		.slice(-80);
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
	// then) — the clone is set up before the sign-in, and must not keep its token either way
	test.afterAll(async () => {
		// First, and before anything that can hang: a clone left behind by a teardown that times out must not keep
		// the token in its config (the worktrees share it)
		if (clonePath != null && repoToken) {
			try {
				git(clonePath, 'config', '--local', '--remove-section', `http.${repoUrl}/`);
			} catch (ex) {
				console.warn(
					`[5106] could not remove the clone credential: ${ex instanceof Error ? ex.name : 'error'}`,
				);
			}
		}

		if (clonePath == null) return;

		// Worktrees live next to the clone (`<repo>.worktrees/…`); `git worktree remove` leaves the
		// intermediate directories of slashed branch names behind, so drop the whole tree with the clone.
		await rm(path.dirname(clonePath), { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }).catch(
			(ex: unknown) => {
				console.warn(`[5106] could not remove the clone and its worktrees: ${String(ex)}`);
			},
		);
	});

	// Review first: it looks the PR up by URL, while Start Work depends on the issue belonging to the bound
	// GitHub account — so a misconfigured issue does not hide the review result (serial skips the rest).
	test('gitlens_start_review checks out the PR head in a worktree with its upstream', async ({
		mcpClient,
		vscode,
	}) => {
		const sim = await vscode.gitlens.startSubscriptionSimulation();
		expect(sim.success, 'Pro simulation started').toBe(true);

		const response = await mcpClient.callTool('gitlens_start_review', { directory: clonePath, pr_url: prUrl });
		const started = decodeStartResult(response);

		const prNumber = new URL(prUrl!).pathname.split('/').pop()!;
		expect(started.branchName, 'branch named after the PR').toMatch(new RegExp(`^pr/${prNumber}-`));
		expect(started.prUrl, 'the reported PR is the requested one').toBe(prUrl);
		expect(localBranches(clonePath!), 'the branch now exists in git').toContain(started.branchName);

		expect(started.worktreePath, 'a worktree path is reported').toBeTruthy();
		expect(worktreePaths(clonePath!), 'git lists the reported worktree').toContain(
			normalize(started.worktreePath!),
		);

		// The PR head as the host publishes it — independent of how GitLens fetched it
		const prHead = git(clonePath!, 'ls-remote', 'origin', `refs/pull/${prNumber}/head`).split(/\s+/)[0];
		expect(prHead, 'the host publishes the PR head').toMatch(/^[0-9a-f]{40}$/);
		expect(git(started.worktreePath!, 'rev-parse', 'HEAD'), 'the worktree is at the PR head').toBe(prHead);
		// The PR branch is the origin branch whose tip is the PR head (the PR is from the repository itself, not a fork)
		const prBranches = git(clonePath!, 'ls-remote', '--heads', 'origin')
			.split('\n')
			.filter(l => l.startsWith(prHead))
			.map(l => `origin/${l.split(/\s+/)[1].slice('refs/heads/'.length)}`);
		expect(prBranches, 'the PR branch lives in the test repository').not.toHaveLength(0);
		expect(prBranches, 'the review branch tracks the PR branch on origin').toContain(
			git(started.worktreePath!, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'),
		);

		await expect(vscode.page.locator('.quick-input-widget')).toBeHidden({ timeout: MaxTimeout });
	});

	test('gitlens_start_work creates the issue branch and its worktree', async ({ mcpClient, vscode }) => {
		const sim = await vscode.gitlens.startSubscriptionSimulation();
		expect(sim.success, 'Pro simulation started').toBe(true);

		const before = localBranches(clonePath!);
		const response = await mcpClient.callTool('gitlens_start_work', { directory: clonePath, issue_url: issueUrl });
		const started = decodeStartResult(response);

		const issueNumber = new URL(issueUrl!).pathname.split('/').pop()!;
		expect(started.branchName, 'branch named after the issue').toMatch(new RegExp(`^${issueNumber}-`));
		expect(before, 'the branch did not exist before').not.toContain(started.branchName);
		expect(localBranches(clonePath!), 'the branch now exists in git').toContain(started.branchName);

		expect(started.worktreePath, 'a worktree path is reported').toBeTruthy();
		expect(worktreePaths(clonePath!), 'git lists the reported worktree').toContain(
			normalize(started.worktreePath!),
		);
		expect(git(started.worktreePath!, 'branch', '--show-current'), 'the worktree is on the new branch').toBe(
			started.branchName,
		);
		expect(git(started.worktreePath!, 'rev-parse', 'HEAD'), 'the issue branch starts from the default branch').toBe(
			git(clonePath!, 'rev-parse', 'HEAD'),
		);

		await expect(vscode.page.locator('.quick-input-widget')).toBeHidden({ timeout: MaxTimeout });
	});
});

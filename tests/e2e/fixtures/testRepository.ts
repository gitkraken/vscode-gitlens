/**
 * The GitHub test repository of the signed-in specs (#5682): a fresh clone per worker, the spec's own git, and the
 * GitLens log diagnosis printed when a signed-in test fails.
 *
 * Inputs (repository variables in CI — public values, kept visible for diagnosis):
 * - `E2E_GITHUB_REPO_URL` — the test repository to clone (canonical GitHub URL, no trailing slash)
 * - `GK_E2E_GITHUB_TOKEN` (a secret) — for a private test repository only: a token that can only read it, used to clone
 *   it and, through the clone's own config, for the editor's fetches (see {@link cloneTestRepository})
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import * as process from 'node:process';
import { withoutSignInSecrets } from './gkSignIn.js';

export const testRepositoryUrl = process.env.E2E_GITHUB_REPO_URL;
// Trimmed as the sign-in secrets are: a stored value often ends in a newline
const testRepositoryToken = process.env.GK_E2E_GITHUB_TOKEN?.trim();

// The spec's git runs synchronously, so a stalled remote would block the event loop and with it Playwright's own
// timeouts and the teardown that removes the credential: each call is bounded, and a timeout throws
const cloneTimeout = 120_000;
const gitTimeout = 60_000;

/**
 * One worker's clone of the test repository. A spec creates it from its `vscodeOptions.setup` (the workspace the
 * editor opens), removes its credential in an `afterAll` that takes no fixtures, and deletes it in a worker fixture
 * torn down after the editor — on Windows, files an editor holds open can't be deleted.
 */
export class TestRepositoryClone {
	path: string | undefined;

	/** @param tag prefixes the clone's warnings in the job log, e.g. `[5106]` */
	constructor(private readonly tag: string) {}

	/** Clones the test repository into `parentDir`; returns the clone's path. */
	create(parentDir: string): string {
		this.path = path.join(parentDir, path.basename(testRepositoryUrl!));
		cloneTestRepository(testRepositoryUrl!, this.path, testRepositoryToken);
		return this.path;
	}

	/**
	 * Removes the clone's credential. As early as possible: the clone itself is removed only after the editor closes,
	 * and must not hold the token until then (its worktrees share it). Run it in an `afterAll` without fixtures, so it
	 * also runs when the worker failed to start or sign in — the clone is set up before the sign-in.
	 */
	removeCredential(): void {
		if (this.path == null || !testRepositoryToken) return;

		try {
			git(this.path, 'config', '--local', '--remove-section', `http.${testRepositoryUrl}/`);
		} catch (ex) {
			console.warn(
				`${this.tag} could not remove the clone credential: ${ex instanceof Error ? ex.name : 'error'}`,
			);
		}
	}

	/**
	 * Deletes the clone and its worktrees. Worktrees live next to the clone (`<repo>.worktrees/…`), and
	 * `git worktree remove` leaves the intermediate directories of slashed branch names behind, so the whole parent goes
	 * with the clone. A clone left behind still holds the private test repository (and its credential, if
	 * {@link removeCredential} couldn't remove it), so a failure throws rather than pass unnoticed.
	 */
	async remove(): Promise<void> {
		if (this.path == null) return;

		await rm(path.dirname(this.path), {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 500,
		}).catch((ex: unknown) => {
			console.warn(`${this.tag} could not remove the clone and its worktrees: ${String(ex)}`);
			throw ex;
		});
	}
}

/**
 * Clones the test repository. With a token, the credential is an `http.<repository>/.extraheader`, as
 * `actions/checkout` sets one: handed to `git clone` through `GIT_CONFIG_*` (not its arguments, which show in process
 * lists and error messages), then written to the clone's own config so the editor's later fetches authenticate too.
 * Never in the remote URL, which git and GitLens display and log. The credential is removed from the clone's config
 * first thing at teardown, the clone is then deleted, and the header is masked out of the GitLens log diagnosis
 * ({@link redactLog}).
 */
function cloneTestRepository(url: string, dest: string, token: string | undefined): void {
	// The sign-in credentials stay in this process, as they do for the editor (baseTest.ts)
	const env = nonInteractiveGitEnv();
	if (!token) {
		execFileSync('git', ['clone', '--quiet', url, dest], {
			stdio: 'pipe',
			env: env,
			timeout: cloneTimeout,
		});
		return;
	}

	const key = `http.${url}/.extraheader`;
	const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
	execFileSync('git', ['clone', '--quiet', url, dest], {
		stdio: 'pipe',
		timeout: cloneTimeout,
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
		...withoutSignInSecrets(),
		GIT_TERMINAL_PROMPT: '0',
		GCM_INTERACTIVE: 'never',
	};
}

/** Runs the spec's own git in `cwd`, bounded and without credential prompts; returns its trimmed stdout. */
export function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, {
		cwd: cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: nonInteractiveGitEnv(),
		timeout: gitTimeout,
	}).trim();
}

export function localBranches(repo: string): string[] {
	return git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean);
}

/** `git worktree list` paths, normalized — GitLens reports a lowercase drive and forward slashes on Windows. */
export function worktreePaths(repo: string): string[] {
	return git(repo, 'worktree', 'list', '--porcelain')
		.split('\n')
		.filter(l => l.startsWith('worktree '))
		.map(l => normalizePath(l.slice('worktree '.length)));
}

export function normalizePath(p: string): string {
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
export function gitlensLogDiagnosis(electronArgs: string[]): string[] {
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

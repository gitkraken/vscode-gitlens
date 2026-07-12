/**
 * Integration test helpers for @gitlens/git library.
 *
 * Creates real git repositories in temp directories and provides
 * a configured CliGitProvider for testing sub-providers.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSystemProvider, GitServiceConfig, GitServiceContext, GitServiceHooks } from '@gitlens/git/context.js';
import { Logger } from '@gitlens/utils/logger.js';
import { toFsPath } from '@gitlens/utils/uri.js';
import { CliGitProvider } from '../../../cliGitProvider.js';
import type { GitOptions } from '../../../exec/git.js';
import { findGitPath } from '../../../exec/locator.js';

export interface TestRepo {
	path: string;
	provider: CliGitProvider;
	cleanup: () => void;
}

// Cache git location across all tests
let gitLocationPromise: ReturnType<typeof findGitPath>;
function getGitLocation() {
	return (gitLocationPromise ??= findGitPath(null));
}

// Configure logger once (no-op unless debugging)
let loggerConfigured = false;
function ensureLogger() {
	if (loggerConfigured) return;

	loggerConfigured = true;

	const noop = () => {};
	const debugLog = process.env.GITLENS_TEST_DEBUG
		? (name: string) => (_msg: string) => {
				console.error(`[${name}] ${_msg}`);
			}
		: () => noop;

	Logger.configure({
		name: 'test',
		createChannel: function (name) {
			const log = debugLog(name);
			return {
				name: name,
				logLevel: 0,
				dispose: noop,
				trace: log,
				debug: log,
				info: log,
				warn: log,
				error: log,
			};
		},
	});
}

function createMinimalContext(hooks?: GitServiceHooks, config?: GitServiceConfig): GitServiceContext {
	return {
		fs: createNodeFs(),
		hooks: hooks,
		config: config ?? { commits: {} },
	};
}

function createNodeFs(): FileSystemProvider {
	return {
		readFile: async function (uri) {
			return readFile(toFsPath(uri));
		},
		stat: async function (uri) {
			try {
				const stats = statSync(toFsPath(uri));
				return {
					type: stats.isDirectory() ? 2 : 1,
					ctime: stats.ctimeMs,
					mtime: stats.mtimeMs,
					size: stats.size,
				};
			} catch {
				return undefined;
			}
		},
		readDirectory: async function (uri) {
			const entries = readdirSync(toFsPath(uri), { withFileTypes: true });
			return entries.map(e => [e.name, e.isDirectory() ? 2 : 1]);
		},
	};
}

/**
 * Creates a test git repository with an initial commit.
 * Returns the provider, git instance, and cleanup function.
 *
 * Call `cleanup()` in your `teardown()` / `suiteTeardown()`.
 */
export function createTestRepo(options?: {
	hooks?: GitServiceHooks;
	gitOptions?: GitOptions;
	config?: GitServiceConfig;
}): TestRepo {
	ensureLogger();

	const dir = mkdtempSync(join(tmpdir(), 'gitlens-test-'));

	// Initialize a git repo with deterministic config
	execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
	execFileSync('git', ['config', 'user.email', 'test@gitlens.test'], { cwd: dir, stdio: 'pipe' });
	execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
	// Disable gpg signing in test repos
	execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'pipe' });
	// Disable auto-gc: rapid seeding (many commits in quick succession) otherwise races a detached
	// `git gc --auto` that repacks/prunes underneath us and can corrupt the object store mid-test.
	execFileSync('git', ['config', 'gc.auto', '0'], { cwd: dir, stdio: 'pipe' });

	// Create initial commit
	writeFileSync(join(dir, 'README.md'), '# Test Repository\n');
	execFileSync('git', ['add', 'README.md'], {
		cwd: dir,
		stdio: 'pipe',
	});
	execFileSync('git', ['commit', '-m', 'Initial commit'], {
		cwd: dir,
		stdio: 'pipe',
		env: { ...process.env, GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z' },
	});

	const context = createMinimalContext(options?.hooks, options?.config);
	const provider = new CliGitProvider({
		context: context,
		locator: getGitLocation,
		gitOptions: { gitTimeout: 30000, ...options?.gitOptions },
	});

	return {
		path: dir,
		provider: provider,
		cleanup: () => {
			provider.dispose();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

// Monotonic commit clock: git commit dates have 1-second granularity, so rapid test commits otherwise
// share a timestamp — which the R6b date-boundary gate (correctly) treats as an interleave hazard and
// falls back on. Advancing a shared clock 60s per commit gives every commit a distinct, increasing date so
// the fast path's "new commits are strictly newer than the seam" reasoning is actually exercised. Starts
// well after `createTestRepo`'s fixed 2024-01-01 initial commit.
let commitClockMs = Date.parse('2024-06-01T00:00:00Z');
function nextCommitDate(): string {
	commitClockMs += 60_000;
	return new Date(commitClockMs).toISOString();
}

/**
 * Add a file and commit it in the test repo. Uses the monotonic commit clock unless an explicit `date` is
 * given (so successive commits get distinct, increasing timestamps).
 */
export function addCommit(
	repoPath: string,
	filename: string,
	content: string,
	message: string,
	options?: { date?: string; author?: { name: string; email: string } },
): void {
	const filePath = join(repoPath, filename);
	// Ensure parent directory exists
	mkdirSync(join(repoPath, ...filename.split('/').slice(0, -1)), { recursive: true });
	writeFileSync(filePath, content);
	const date = options?.date ?? nextCommitDate();
	const env: NodeJS.ProcessEnv = { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date };
	if (options?.author != null) {
		env.GIT_AUTHOR_NAME = options.author.name;
		env.GIT_AUTHOR_EMAIL = options.author.email;
	}
	execFileSync('git', ['add', filename], { cwd: repoPath, stdio: 'pipe', env: env });
	execFileSync('git', ['commit', '-m', message], { cwd: repoPath, stdio: 'pipe', env: env });
}

/**
 * Create a branch in the test repo.
 */
export function createBranch(repoPath: string, name: string, options?: { checkout?: boolean }): void {
	if (options?.checkout) {
		execFileSync('git', ['checkout', '-b', name], { cwd: repoPath, stdio: 'pipe' });
	} else {
		execFileSync('git', ['branch', name], { cwd: repoPath, stdio: 'pipe' });
	}
}

/** Create a local branch tracking `upstream` (e.g. `origin/main`) — populates the branch's upstream so it
 *  appears in the graph's downstreams map. */
export function createTrackingBranch(repoPath: string, name: string, upstream: string): void {
	execFileSync('git', ['branch', '--track', name, upstream], { cwd: repoPath, stdio: 'pipe' });
}

/**
 * Create a tag in the test repo.
 */
export function createTag(repoPath: string, name: string, message?: string): void {
	if (message) {
		execFileSync('git', ['tag', '-a', name, '-m', message], { cwd: repoPath, stdio: 'pipe' });
	} else {
		execFileSync('git', ['tag', name], { cwd: repoPath, stdio: 'pipe' });
	}
}

/**
 * Create a stash in the test repo.
 */
export function createStash(repoPath: string, message?: string): void {
	writeFileSync(join(repoPath, 'stash-file.txt'), `stash content ${Date.now()}\n`);
	execFileSync('git', ['add', 'stash-file.txt'], { cwd: repoPath, stdio: 'pipe' });
	const args = ['stash', 'push'];
	if (message) {
		args.push('-m', message);
	}
	execFileSync('git', args, { cwd: repoPath, stdio: 'pipe' });
}

/**
 * Get the HEAD sha of the test repo.
 */
export function getHeadSha(repoPath: string): string {
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf-8' }).trim();
}

/** Get the root (parentless) commit sha of the test repo. */
export function getRootSha(repoPath: string): string {
	return execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: repoPath, encoding: 'utf-8' })
		.trim()
		.split('\n')[0];
}

/** Resolve a revision (e.g. `HEAD~2`, `main~1`) to its full sha. */
export function revParse(repoPath: string, rev: string): string {
	return execFileSync('git', ['rev-parse', rev], { cwd: repoPath, encoding: 'utf-8' }).trim();
}

/**
 * Create a `git replace` ref mapping `original` → `replacement` (both existing commit shas). This rewrites
 * ancestry PRESENTATION globally — every walk substitutes `original` with `replacement` — without moving any
 * branch tip, so it exercises the R6b replace-ref gate.
 */
export function createReplaceRef(repoPath: string, original: string, replacement: string): void {
	execFileSync('git', ['replace', original, replacement], { cwd: repoPath, stdio: 'pipe' });
}

/** Deepen a shallow clone to full history (`git fetch --unshallow`) — the branch tips don't move. */
export function unshallow(repoPath: string, remote = 'origin'): void {
	execFileSync('git', ['fetch', '--unshallow', remote], { cwd: repoPath, stdio: 'pipe' });
}

/** Add `count` sequential file+commit pairs, simulating a multi-commit batch landing at HEAD. */
export function addCommits(repoPath: string, count: number, prefix = 'batch'): void {
	for (let i = 0; i < count; i++) {
		addCommit(repoPath, `${prefix}-${i}.txt`, `${prefix} content ${i}`, `${prefix} commit ${i}`);
	}
}

/**
 * Add `count` EMPTY commits (no file writes) with distinct monotonic dates — for building deep linear
 * history cheaply. Avoids the loose-object write race that hundreds of rapid file commits hit on some
 * filesystems (WSL2), and needs no stats.
 */
export function addEmptyCommits(repoPath: string, count: number, prefix = 'e'): void {
	for (let i = 0; i < count; i++) {
		const date = nextCommitDate();
		execFileSync('git', ['commit', '--allow-empty', '-m', `${prefix} commit ${i}`], {
			cwd: repoPath,
			stdio: 'pipe',
			env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
		});
	}
}

/** Create a branch rooted at an explicit start-point (needed to fork an old-dated commit off history). */
export function createBranchAt(
	repoPath: string,
	name: string,
	startPoint: string,
	options?: { checkout?: boolean },
): void {
	if (options?.checkout) {
		execFileSync('git', ['checkout', '-b', name, startPoint], { cwd: repoPath, stdio: 'pipe' });
	} else {
		execFileSync('git', ['branch', name, startPoint], { cwd: repoPath, stdio: 'pipe' });
	}
}

/** Check out an existing ref (moves HEAD). */
export function checkout(repoPath: string, ref: string): void {
	execFileSync('git', ['checkout', ref], { cwd: repoPath, stdio: 'pipe' });
}

/** Merge `branch` into the current branch with a real merge commit (--no-ff). */
export function mergeBranch(repoPath: string, branch: string, message: string): void {
	const date = nextCommitDate();
	execFileSync('git', ['merge', '--no-ff', '-m', message, branch], {
		cwd: repoPath,
		stdio: 'pipe',
		env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
	});
}

/** Delete a local branch (force, so merged-state doesn't matter). */
export function deleteBranch(repoPath: string, name: string): void {
	execFileSync('git', ['branch', '-D', name], { cwd: repoPath, stdio: 'pipe' });
}

/** Delete a tag. */
export function deleteTag(repoPath: string, name: string): void {
	execFileSync('git', ['tag', '-d', name], { cwd: repoPath, stdio: 'pipe' });
}

/** Amend the HEAD commit (rewrites its sha — a minimal history rewrite). */
export function amendHead(repoPath: string, message?: string): void {
	const args = ['commit', '--amend', '--no-edit'];
	if (message != null) {
		args.splice(2, 1, '-m', message);
	}
	execFileSync('git', args, { cwd: repoPath, stdio: 'pipe' });
}

/** Rebase the current branch onto `base` (rewrites the shas of the diverged commits). */
export function rebaseCurrentOnto(repoPath: string, base: string): void {
	execFileSync('git', ['rebase', base], {
		cwd: repoPath,
		stdio: 'pipe',
		env: { ...process.env, GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' },
	});
}

/** Pop the most recent stash. */
export function stashPop(repoPath: string): void {
	execFileSync('git', ['stash', 'pop'], { cwd: repoPath, stdio: 'pipe' });
}

/** Fetch from a remote (advances remote-tracking refs — a real fetch batch). */
export function fetch(repoPath: string, remote = 'origin'): void {
	execFileSync('git', ['fetch', remote], { cwd: repoPath, stdio: 'pipe' });
}

/** Push a branch to a remote (advances the remote's ref; the tracking ref updates on the next fetch). */
export function push(repoPath: string, remote = 'origin', branch = 'main'): void {
	execFileSync('git', ['push', remote, branch], { cwd: repoPath, stdio: 'pipe' });
}

/** Set a local git config value on a test repo (e.g. allow pushes into a non-bare origin's current branch). */
export function setConfig(repoPath: string, key: string, value: string): void {
	execFileSync('git', ['config', key, value], { cwd: repoPath, stdio: 'pipe' });
}

/** Retarget a branch's upstream (`git branch --set-upstream-to`) — a metadata-only change (no tip moves). */
export function setUpstream(repoPath: string, branch: string, upstream: string): void {
	execFileSync('git', ['branch', `--set-upstream-to=${upstream}`, branch], { cwd: repoPath, stdio: 'pipe' });
}

/** Retarget a remote's default branch (`git remote set-head`) — a metadata-only change (no tip moves). */
export function setRemoteHead(repoPath: string, remote: string, branch: string): void {
	execFileSync('git', ['remote', 'set-head', remote, branch], { cwd: repoPath, stdio: 'pipe' });
}

/** Add a linked worktree at `dir` checked out to `branch` — a metadata-only change (no tip moves). */
export function addWorktree(repoPath: string, dir: string, branch: string): void {
	execFileSync('git', ['worktree', 'add', dir, branch], { cwd: repoPath, stdio: 'pipe' });
}

/** Set a branch's GitKraken disposition directly in `.git/gk/config` — a metadata-only change (no tip moves). */
export function setBranchGkDisposition(repoPath: string, branch: string, disposition: 'starred' | 'archived'): void {
	const gkDir = join(repoPath, '.git', 'gk');
	mkdirSync(gkDir, { recursive: true });
	execFileSync('git', ['config', '--file', join(gkDir, 'config'), `branch.${branch}.gk-disposition`, disposition], {
		cwd: repoPath,
		stdio: 'pipe',
	});
}

/**
 * Ref tips of the repo right now: canonical refname (`refs/heads/…`, `refs/remotes/…`, `refs/tags/…`) →
 * PEELED commit sha. Peeled (`%(*objectname)` for annotated tags) so a tag maps to the commit its badge
 * sits on — the same convention the provider's tip gate uses. Used to build a {@link GraphIncrementalSeed}'s
 * `tips` map (the pre-mutation ref snapshot the R6b fast path diffs against).
 */
export function getRefTips(repoPath: string): Map<string, string> {
	const out = execFileSync('git', ['for-each-ref', '--format=%(objectname) %(*objectname) %(refname)'], {
		cwd: repoPath,
		encoding: 'utf-8',
	});
	const tips = new Map<string, string>();
	for (const line of out.split('\n')) {
		// `<objectname> <peeled-or-empty> <refname>`; peeled is set only for annotated tags.
		const match = /^(\S+) (\S*) (.+)$/.exec(line);
		if (match == null) continue;

		tips.set(match[3], match[2] || match[1]);
	}
	return tips;
}

/**
 * Clone an existing test repo into a fresh temp dir and return a configured {@link TestRepo} for it.
 * The clone gets deterministic user config + `gc.auto 0` and an `origin` remote pointing at the source,
 * so scenarios can commit to the source and `fetch()` the batch into the clone (a high-fidelity fetch).
 */
export function cloneTestRepo(
	originPath: string,
	options?: { hooks?: GitServiceHooks; gitOptions?: GitOptions; config?: GitServiceConfig; depth?: number },
): TestRepo {
	ensureLogger();

	const dir = mkdtempSync(join(tmpdir(), 'gitlens-clone-'));
	if (options?.depth != null) {
		// A local-path clone with `--depth` needs the `file://` transport (git's plain-path optimization
		// otherwise ignores depth and hardlinks full history), yielding a genuinely shallow clone.
		execFileSync('git', ['clone', '--depth', String(options.depth), `file://${originPath}`, dir], {
			stdio: 'pipe',
		});
	} else {
		execFileSync('git', ['clone', originPath, dir], { stdio: 'pipe' });
	}
	execFileSync('git', ['config', 'user.email', 'test@gitlens.test'], { cwd: dir, stdio: 'pipe' });
	execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
	execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'pipe' });
	execFileSync('git', ['config', 'gc.auto', '0'], { cwd: dir, stdio: 'pipe' });

	const context = createMinimalContext(options?.hooks, options?.config);
	const provider = new CliGitProvider({
		context: context,
		locator: getGitLocation,
		gitOptions: { gitTimeout: 30000, ...options?.gitOptions },
	});

	return {
		path: dir,
		provider: provider,
		cleanup: () => {
			provider.dispose();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

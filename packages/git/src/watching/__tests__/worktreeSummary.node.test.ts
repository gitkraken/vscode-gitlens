import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mixinDisposable } from '@gitlens/utils/disposable.js';
import { Emitter } from '@gitlens/utils/event.js';
import { fileUri, getRepositoryKey } from '@gitlens/utils/uri.js';
import type { MergeTargetsChangeEvent } from '../../cache.js';
import type { GitDir, RepositoryChange } from '../../models/repository.js';
import type { AheadOfBaseTier } from '../../providers/branches.js';
import type { RepositoryService } from '../../repositoryService.js';
import type { FileWatcher, FileWatchEvent, FileWatchingProvider } from '../provider.js';
import { RepositoryWatchService } from '../watchService.js';
import type { RepositoryWatchSession } from '../watchSession.js';
import type { WorktreeSummary, WorktreeSummarySubscribeOptions } from '../worktreeSummary.js';
import { WorktreeSummaryService } from '../worktreeSummary.js';

const repoPath = '/repo';
const key = getRepositoryKey(repoPath);

function createMockFactory(): FileWatchingProvider {
	return {
		createWatcher: function (
			_basePath: string,
			_pattern: string,
			_onEvent: (event: FileWatchEvent) => void,
		): FileWatcher {
			return mixinDisposable({}, () => {});
		},
	};
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 1000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');

		await delay(5);
	}
}

interface FakeUpstream {
	name: string;
	/** What git reported about the upstream's remote */
	remote?: string;
	remoteBranch?: string;
	local?: boolean;
	missing: boolean;
	ahead: number;
	behind: number;
}

interface FakeBase {
	ref: string;
	ahead: number;
	sha: string;
	forkPoint: string | undefined;
	tier: AheadOfBaseTier;
}

interface ReadCounts {
	dirty: number;
	branch: number;
	base: number;
	remotes: number;
}

/** A fake repository whose reads are counted, return the current {@link state}, and can be held on {@link gate} */
class FakeRepository {
	state: {
		branch: string | undefined;
		detached: boolean;
		/** HEAD's commit */
		sha: string | undefined;
		upstream: FakeUpstream | undefined;
		dirty: boolean;
		base: FakeBase | undefined;
		/** What the base read reports depending on, with or without a base */
		baseDependsOn: string[];
		remotes: string[];
		/** The stored values the base read consults: user merge target, detected merge target, recorded base */
		userMergeTarget: string | undefined;
		detectedMergeTarget: string | undefined;
		recordedBase: string | undefined;
		fail: Error | undefined;
		/** Makes only the base read throw */
		baseFail: Error | undefined;
	} = {
		branch: 'main',
		detached: false,
		sha: 'aaa111',
		upstream: { name: 'origin/main', missing: false, ahead: 1, behind: 2 },
		dirty: false,
		base: { ref: 'refs/heads/develop', ahead: 3, sha: 'ddd111', forkPoint: 'fff111', tier: 'user' },
		baseDependsOn: ['refs/heads/develop'],
		remotes: ['origin'],
		userMergeTarget: undefined,
		detectedMergeTarget: 'develop',
		recordedBase: undefined,
		fail: undefined,
		baseFail: undefined,
	};

	readonly counts: ReadCounts = { dirty: 0, branch: 0, base: 0, remotes: 0 };
	/** Reads of the stored base values (kept out of {@link counts}: they're shared, cached gk config reads) */
	baseKeyReads = 0;
	readonly signals: (AbortSignal | undefined)[] = [];
	/** The branch each base read was asked about, in order (`undefined` for a detached HEAD) */
	readonly baseBranches: (string | undefined)[] = [];
	/** Every read, in the order it started */
	readonly order: (keyof ReadCounts)[] = [];
	/** While set, every read waits for it before answering */
	gate: Promise<void> | undefined;
	private releaseGate: (() => void) | undefined;

	readonly service: RepositoryService;

	constructor(path: string = repoPath, gitDir: GitDir = { uri: fileUri(`${repoPath}/.git`) }) {
		this.service = {
			path: getRepositoryKey(path),
			branches: {
				getBranch: async (_name?: string, _options?: unknown, signal?: AbortSignal) => {
					await this.enter('branch', signal);
					if (this.state.branch == null && !this.state.detached) return undefined;

					const upstream = this.state.upstream;
					return {
						name: this.state.detached ? '(abc1234...)' : this.state.branch,
						detached: this.state.detached,
						sha: this.state.sha,
						upstream:
							upstream != null
								? {
										name: upstream.name,
										remote: upstream.remote,
										remoteBranch: upstream.remoteBranch,
										local: upstream.local,
										missing: upstream.missing,
										state: { ahead: upstream.ahead, behind: upstream.behind },
									}
								: undefined,
					};
				},
				getAheadOfBase: async (branch: string | undefined, _options?: unknown, signal?: AbortSignal) => {
					this.baseBranches.push(branch);
					await this.enter('base', signal);
					if (this.state.baseFail != null) throw this.state.baseFail;

					const base = this.state.base;
					return {
						base: base != null ? { ...base } : undefined,
						dependsOn: this.state.baseDependsOn,
					};
				},
				getStoredUserMergeTargetBranchName: async (_branch: string) => {
					this.baseKeyReads++;
					return this.state.userMergeTarget;
				},
				getStoredDetectedMergeTargetBranchName: async (_branch: string) => {
					this.baseKeyReads++;
					return this.state.detectedMergeTarget;
				},
			},
			status: {
				hasWorkingChanges: async (_options?: unknown, signal?: AbortSignal) => {
					await this.enter('dirty', signal);
					return this.state.dirty;
				},
			},
			remotes: {
				getRemotes: async (_options?: unknown, signal?: AbortSignal) => {
					await this.enter('remotes', signal);
					return this.state.remotes.map(name => ({ name: name }));
				},
			},
			config: {
				getGitDir: (): Promise<GitDir> => Promise.resolve(gitDir),
				getGkConfig: async (key: string) => {
					this.baseKeyReads++;
					return key === 'branch.main.gk-merge-base' ? this.state.recordedBase : undefined;
				},
			},
		} as unknown as RepositoryService;
	}

	hold(): void {
		this.gate = new Promise(resolve => (this.releaseGate = resolve));
	}

	release(): void {
		this.releaseGate?.();
		this.gate = undefined;
		this.releaseGate = undefined;
	}

	snapshot(): ReadCounts {
		return { ...this.counts };
	}

	private async enter(read: keyof ReadCounts, signal: AbortSignal | undefined): Promise<void> {
		this.counts[read]++;
		this.signals.push(signal);
		this.order.push(read);
		if (this.gate != null) {
			await this.gate;
		}
		if (this.state.fail != null) throw this.state.fail;
	}
}

interface Harness {
	readonly repo: FakeRepository;
	/** Adds a linked worktree of the same repository at `path`, sharing its common git directory */
	addWorktree(path: string): FakeRepository;
	readonly watchService: RepositoryWatchService;
	readonly service: WorktreeSummaryService;
	session(): RepositoryWatchSession;
	push(changes: RepositoryChange[], ref?: string): void;
	pushWorkingTree(): void;
	/** Fires the merge-targets event core raises as it writes a branch's merge target or base */
	fireMergeTargets(refs: string[] | undefined, commonPath?: string): void;
}

let harnesses: Harness[] = [];

function createHarness(options?: {
	defaultWorkingTreeDelayMs?: number;
	getCommonPath?: (repoPath: string) => string | undefined;
}): Harness {
	const repo = new FakeRepository();
	const repos = new Map<string, FakeRepository>([[key, repo]]);
	const watchService = new RepositoryWatchService({
		watchingProvider: createMockFactory(),
		defaultRepoDelayMs: 10,
		defaultWorkingTreeDelayMs: options?.defaultWorkingTreeDelayMs ?? 10,
	});
	const mergeTargets = new Emitter<MergeTargetsChangeEvent>();
	const service = new WorktreeSummaryService({
		watchService: watchService,
		getRepository: path => repos.get(getRepositoryKey(path))?.service,
		onDidChangeMergeTargets: mergeTargets.event,
		getCommonPath: options?.getCommonPath,
	});

	const session = (): RepositoryWatchSession => {
		const s = watchService.getSession(key);
		assert.ok(s != null, 'expected a watch session');
		return s;
	};

	const harness: Harness = {
		repo: repo,
		addWorktree: path => {
			const worktree = new FakeRepository(path, {
				uri: fileUri(`${repoPath}/.git/worktrees/${path.slice(path.lastIndexOf('/') + 1)}`),
				commonUri: fileUri(`${repoPath}/.git`),
			});
			repos.set(getRepositoryKey(path), worktree);
			return worktree;
		},
		watchService: watchService,
		service: service,
		session: session,
		push: (changes, ref) => session().pushRepoChanges(changes, ref),
		pushWorkingTree: () => session().pushWorkingTreeChanges([`${repoPath}/src/a.ts`]),
		fireMergeTargets: (refs, commonPath) =>
			mergeTargets.fire({ repoPath: commonPath ?? key, refs: refs != null ? new Set(refs) : undefined }),
	};
	harnesses.push(harness);
	return harness;
}

/** Counts the reads `action` triggers once they settle (waits for the first read, then for quiet) */
async function readsAfter(h: Harness, action: () => void, settleMs: number = 60): Promise<ReadCounts> {
	const before = h.repo.snapshot();
	action();
	await delay(settleMs);
	await h.service.getSummary(repoPath);
	const after = h.repo.snapshot();
	return {
		dirty: after.dirty - before.dirty,
		branch: after.branch - before.branch,
		base: after.base - before.base,
		remotes: after.remotes - before.remotes,
	};
}

const none: ReadCounts = { dirty: 0, branch: 0, base: 0, remotes: 0 };
const onlyDirty: ReadCounts = { dirty: 1, branch: 0, base: 0, remotes: 0 };
const onlyBranch: ReadCounts = { dirty: 0, branch: 1, base: 0, remotes: 1 };
const onlyBase: ReadCounts = { dirty: 0, branch: 0, base: 1, remotes: 0 };
const all: ReadCounts = { dirty: 1, branch: 1, base: 1, remotes: 1 };

const expectedInitial: WorktreeSummary = {
	repoPath: key,
	branch: 'main',
	detached: false,
	sha: 'aaa111',
	upstream: { name: 'origin/main', remote: 'origin', branch: 'main', missing: false },
	ahead: 1,
	behind: 2,
	dirty: false,
	base: { ref: 'refs/heads/develop', ahead: 3, sha: 'ddd111', forkPoint: 'fff111', tier: 'user' },
	baseDependsOn: ['refs/heads/develop'],
	stale: false,
};

describe('WorktreeSummaryService', () => {
	afterEach(() => {
		for (const h of harnesses) {
			h.service.dispose();
			h.watchService.dispose();
		}
		harnesses = [];
	});

	describe('lifecycle', () => {
		it('computes everything on first subscribe and resolves getSummary', async () => {
			const h = createHarness();
			const fired: WorktreeSummary[] = [];
			const sub = h.service.subscribe(repoPath);
			sub.onDidChange(e => fired.push(e));

			const summary = await h.service.getSummary(repoPath);

			assert.deepStrictEqual(summary, expectedInitial);
			assert.deepStrictEqual(sub.current, expectedInitial);
			assert.deepStrictEqual(h.repo.counts, all);
			assert.strictEqual(fired.length, 1, 'the first value is a change from nothing');
			assert.ok(h.watchService.getSession(key) != null);
			assert.deepStrictEqual(h.service.getResourceUsage(), { 'worktreeSummary.entries.count': 1 });
		});

		it('splits the upstream at the longest matching remote name', async () => {
			const h = createHarness();
			h.repo.state.remotes = ['origin', 'origin/fork'];
			h.repo.state.upstream = { name: 'origin/fork/feature', missing: true, ahead: 0, behind: 0 };
			h.service.subscribe(repoPath);

			const summary = await h.service.getSummary(repoPath);

			assert.deepStrictEqual(summary.upstream, {
				name: 'origin/fork/feature',
				remote: 'origin/fork',
				branch: 'feature',
				missing: true,
			});
		});

		it('splits a plain upstream at its remote', async () => {
			const h = createHarness();
			h.repo.state.upstream = { name: 'origin/feature/x', missing: false, ahead: 0, behind: 0 };
			h.service.subscribe(repoPath);

			const summary = await h.service.getSummary(repoPath);

			assert.deepStrictEqual(summary.upstream, {
				name: 'origin/feature/x',
				remote: 'origin',
				branch: 'feature/x',
				missing: false,
			});
		});

		it('does not split an upstream that names no known remote (a local tracking branch)', async () => {
			const h = createHarness();
			// `branch.<b>.remote = .`: the upstream is another local branch, whose name may still hold a slash
			h.repo.state.upstream = { name: 'release/main', missing: false, ahead: 0, behind: 0 };
			h.service.subscribe(repoPath);

			const summary = await h.service.getSummary(repoPath);

			assert.deepStrictEqual(summary.upstream, {
				name: 'release/main',
				remote: undefined,
				branch: undefined,
				missing: false,
			});
		});

		it('reads a local upstream as having no remote, even when a remote shares its first segment', async () => {
			const h = createHarness();
			h.repo.state.remotes = ['origin', 'release'];
			h.repo.state.upstream = { name: 'release/2.0', local: true, missing: false, ahead: 0, behind: 0 };
			h.service.subscribe(repoPath);

			const summary = await h.service.getSummary(repoPath);

			assert.deepStrictEqual(summary.upstream, {
				name: 'release/2.0',
				remote: undefined,
				branch: undefined,
				missing: false,
			});
		});

		it('uses the remote git reported when its name contains a slash', async () => {
			const h = createHarness();
			h.repo.state.remotes = ['team'];
			h.repo.state.upstream = {
				name: 'team/fork/feature',
				remote: 'team/fork',
				remoteBranch: 'feature',
				missing: false,
				ahead: 0,
				behind: 0,
			};
			h.service.subscribe(repoPath);

			const summary = await h.service.getSummary(repoPath);

			assert.deepStrictEqual(summary.upstream, {
				name: 'team/fork/feature',
				remote: 'team/fork',
				branch: 'feature',
				missing: false,
			});
		});

		it('uses the branch git reported over the name when a custom refspec renames it', async () => {
			const h = createHarness();
			h.repo.state.upstream = {
				name: 'mirror/pfx/x',
				remote: 'origin',
				remoteBranch: 'x',
				missing: false,
				ahead: 0,
				behind: 0,
			};
			h.service.subscribe(repoPath);

			const summary = await h.service.getSummary(repoPath);

			assert.deepStrictEqual(summary.upstream, {
				name: 'mirror/pfx/x',
				remote: 'origin',
				branch: 'x',
				missing: false,
			});
			assert.strictEqual(h.repo.counts.remotes, 0, 'no remotes read when git reported the remote');
		});

		it('does not split an upstream with nothing after its remote name', async () => {
			const h = createHarness();
			h.repo.state.remotes = ['origin', 'origin/fork'];
			h.repo.state.upstream = { name: 'origin/fork/', missing: false, ahead: 0, behind: 0 };
			h.service.subscribe(repoPath);

			const summary = await h.service.getSummary(repoPath);

			assert.deepStrictEqual(summary.upstream, {
				name: 'origin/fork/',
				remote: undefined,
				branch: undefined,
				missing: false,
			});
		});

		it('reports no branch or upstream, and the base measured for a detached HEAD', async () => {
			const h = createHarness();
			h.repo.state.detached = true;
			h.repo.state.upstream = undefined;
			h.repo.state.base = { ref: 'main', ahead: 2, sha: 'ddd111', forkPoint: 'fff111', tier: 'default' };
			h.repo.state.baseDependsOn = ['refs/heads/main'];
			h.service.subscribe(repoPath);

			const summary = await h.service.getSummary(repoPath);

			assert.strictEqual(summary.branch, undefined);
			assert.strictEqual(summary.detached, true);
			assert.strictEqual(summary.sha, 'aaa111', "HEAD's commit is still reported when detached");
			assert.strictEqual(summary.upstream, undefined);
			assert.deepStrictEqual(summary.base, {
				ref: 'main',
				ahead: 2,
				sha: 'ddd111',
				forkPoint: 'fff111',
				tier: 'default',
			});
			assert.deepStrictEqual(summary.baseDependsOn, ['refs/heads/main']);
			assert.deepStrictEqual(h.repo.baseBranches, [undefined], 'the base is read once, with no branch name');
			assert.strictEqual(h.repo.counts.remotes, 0, 'no remotes read without an upstream');
		});

		it('reads no base for an unborn HEAD with no name', async () => {
			const h = createHarness();
			h.repo.state.branch = undefined;
			h.repo.state.sha = undefined;
			h.repo.state.upstream = undefined;
			h.service.subscribe(repoPath);

			const summary = await h.service.getSummary(repoPath);

			assert.strictEqual(summary.base, undefined);
			assert.strictEqual(h.repo.counts.base, 0);
		});

		it('reports no HEAD commit before the first commit', async () => {
			const h = createHarness();
			h.repo.state.sha = undefined;
			h.service.subscribe(repoPath);

			const summary = await h.service.getSummary(repoPath);

			assert.strictEqual(summary.sha, undefined);
		});

		it('shares one entry and one set of reads across subscribers', async () => {
			const h = createHarness();
			const fired1: WorktreeSummary[] = [];
			const fired2: WorktreeSummary[] = [];
			const sub1 = h.service.subscribe(repoPath);
			const sub2 = h.service.subscribe(repoPath);
			sub1.onDidChange(e => fired1.push(e));
			sub2.onDidChange(e => fired2.push(e));
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(h.repo.counts, all);
			assert.deepStrictEqual(h.service.getResourceUsage(), { 'worktreeSummary.entries.count': 1 });

			h.repo.state.dirty = true;
			assert.deepStrictEqual(await readsAfter(h, () => h.pushWorkingTree()), onlyDirty);
			assert.strictEqual(fired1.length, 2);
			assert.strictEqual(fired2.length, 2);

			sub1.dispose();
			assert.strictEqual(sub1.current, undefined);
			assert.ok(h.watchService.getSession(key) != null, 'still watched for the other subscriber');
			assert.strictEqual(sub2.current?.dirty, true);

			sub2.dispose();
			assert.strictEqual(h.watchService.getSession(key), undefined);
			assert.deepStrictEqual(h.service.getResourceUsage(), { 'worktreeSummary.entries.count': 0 });
		});

		it('aborts the in-flight read and releases the watch on last dispose', async () => {
			const h = createHarness();
			const fired: WorktreeSummary[] = [];
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			sub.onDidChange(e => fired.push(e));
			const global: WorktreeSummary[] = [];
			h.service.onDidChangeSummary(e => global.push(e));

			h.repo.hold();
			h.repo.state.dirty = true;
			const before = h.repo.counts.dirty;
			h.pushWorkingTree();
			await waitFor(() => h.repo.counts.dirty > before);
			const signal = h.repo.signals.at(-1);
			assert.ok(signal != null);
			assert.strictEqual(signal.aborted, false);

			sub.dispose();

			assert.strictEqual(signal.aborted, true, 'the in-flight read is cancelled');
			assert.strictEqual(h.watchService.getSession(key), undefined, 'the watch handle is released');
			assert.deepStrictEqual(h.service.getResourceUsage(), { 'worktreeSummary.entries.count': 0 });

			h.repo.release();
			await delay(20);
			assert.strictEqual(fired.length, 0);
			assert.strictEqual(global.length, 0, 'a read that finishes after dispose fires nothing');
		});

		it('does a one-off uncached read when not subscribed', async () => {
			const h = createHarness();

			const summary = await h.service.getSummary(repoPath);

			assert.deepStrictEqual(summary, expectedInitial);
			assert.strictEqual(h.watchService.getSession(key), undefined, 'no watching for a one-off read');
			assert.deepStrictEqual(h.service.getResourceUsage(), { 'worktreeSummary.entries.count': 0 });

			await h.service.getSummary(repoPath);
			assert.strictEqual(h.repo.counts.branch, 2, 'one-off reads are not cached');
		});

		it('rejects a one-off read for an unknown repository', async () => {
			const h = createHarness();

			await assert.rejects(h.service.getSummary('/elsewhere'));
		});

		it('retries a failed start when another subscriber joins', async () => {
			const h = createHarness();
			const config = h.repo.service.config as unknown as { getGitDir: () => Promise<GitDir> };
			const getGitDir = config.getGitDir;
			config.getGitDir = () => Promise.reject(new Error('not a repository yet'));
			const sub1 = h.service.subscribe(repoPath);

			await assert.rejects(h.service.getSummary(repoPath));
			assert.strictEqual(h.watchService.getSession(key), undefined);

			config.getGitDir = getGitDir;
			h.service.subscribe(repoPath);

			assert.deepStrictEqual(await h.service.getSummary(repoPath), expectedInitial);
			assert.deepStrictEqual(sub1.current, expectedInitial);
			assert.ok(h.watchService.getSession(key) != null);
		});

		it('rejects getSummary when the repository is unknown to a subscriber', async () => {
			const h = createHarness();
			const sub = h.service.subscribe('/elsewhere');

			await assert.rejects(h.service.getSummary('/elsewhere'));
			assert.strictEqual(sub.current, undefined);
		});
	});

	describe('field-scoped recompute', () => {
		it('runs only the dirty probe for a working-tree change', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(await readsAfter(h, () => h.pushWorkingTree()), onlyDirty);
		});

		it('runs only dirty for index and ignores changes', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(await readsAfter(h, () => h.push(['index'])), onlyDirty);
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['ignores'])), onlyDirty);
		});

		it('runs nothing for unrelated refs, tags, stash and worktrees', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(await readsAfter(h, () => h.push(['heads'], 'refs/heads/other')), none);
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['tags'], 'refs/tags/v1')), none);
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['stash'], 'refs/stash')), none);
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['worktrees', 'pausedOp'])), none);
		});

		it('runs branch, base and dirty when the checked-out branch moves', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(await readsAfter(h, () => h.push(['heads'], 'refs/heads/main')), all);
		});

		it('runs only branch when the upstream moves', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(
				await readsAfter(h, () => h.push(['remotes'], 'refs/remotes/origin/main')),
				onlyBranch,
			);
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['remotes'], 'refs/remotes/origin/other')), none);
		});

		it('runs only branch when a local upstream moves', async () => {
			const h = createHarness();
			h.repo.state.upstream = { name: 'trunk', missing: false, ahead: 0, behind: 0 };
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(await readsAfter(h, () => h.push(['heads'], 'refs/heads/trunk')), onlyBranch);
		});

		it('runs only base when a ref the base depends on moves', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(await readsAfter(h, () => h.push(['heads'], 'refs/heads/develop')), onlyBase);
		});

		it('runs base when a ref a no-base answer depends on moves, and picks up the base it finds', async () => {
			const h = createHarness();
			// No upstream, so the moved ref reaches only the base read
			h.repo.state.upstream = undefined;
			h.repo.state.base = undefined;
			h.repo.state.baseDependsOn = ['refs/remotes/origin/main'];
			h.service.subscribe(repoPath);
			const first = await h.service.getSummary(repoPath);
			assert.strictEqual(first.base, undefined);
			assert.deepStrictEqual(first.baseDependsOn, ['refs/remotes/origin/main']);

			h.repo.state.base = { ref: 'origin/main', ahead: 0, sha: 'eee111', forkPoint: undefined, tier: 'default' };
			assert.deepStrictEqual(
				await readsAfter(h, () => h.push(['remotes'], 'refs/remotes/origin/main')),
				onlyBase,
			);
			assert.deepStrictEqual((await h.service.getSummary(repoPath)).base, {
				ref: 'origin/main',
				ahead: 0,
				sha: 'eee111',
				forkPoint: undefined,
				tier: 'default',
			});
		});

		it('re-reads only the stored base values for a gk config change that leaves them unchanged', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			assert.strictEqual(h.repo.baseKeyReads, 3, 'the first base read snapshots the stored values');

			// A bookkeeping write (e.g. `gk-last-accessed`) to the shared gk config
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['gkConfig'])), none);
			assert.strictEqual(h.repo.baseKeyReads, 6, 'only the three stored values were read');
		});

		it('runs base for a gk config change that moves a stored base value, then snapshots the new values', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			h.repo.state.userMergeTarget = 'release';
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['gkConfig'])), onlyBase);

			// Unchanged since that read
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['gkConfig'])), none);

			h.repo.state.recordedBase = 'trunk';
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['gkConfig'])), onlyBase);
		});

		it("re-reads the stored base values, and the base when they changed, once for core's own write", async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			h.repo.state.userMergeTarget = 'release';
			assert.deepStrictEqual(await readsAfter(h, () => h.fireMergeTargets(['main'])), onlyBase);
			assert.strictEqual(h.repo.baseKeyReads, 6, 'the three stored values were read once');

			// The watcher's later report of the same write
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['gkConfig'])), none);
			assert.strictEqual(h.repo.baseKeyReads, 9);

			assert.deepStrictEqual(await readsAfter(h, () => h.fireMergeTargets(['main'])), none);
			assert.strictEqual(h.repo.baseKeyReads, 12);
		});

		it("resolves getSummary to the new base when called as core's write completes", async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			const base: FakeBase = { ref: 'release', ahead: 5, sha: 'rrr111', forkPoint: 'fff222', tier: 'user' };
			h.repo.state.userMergeTarget = 'release';
			h.repo.state.base = base;
			h.fireMergeTargets(['main']);
			const summary = await h.service.getSummary(repoPath);

			assert.deepStrictEqual(summary.base, base);
		});

		it('reads nothing for a write to another branch', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			h.repo.state.userMergeTarget = 'release';
			assert.deepStrictEqual(await readsAfter(h, () => h.fireMergeTargets(['feature'])), none);
			assert.strictEqual(h.repo.baseKeyReads, 3);
		});

		it('re-reads the stored base values when the changed branches are unknown', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(await readsAfter(h, () => h.fireMergeTargets(undefined)), none);
			assert.strictEqual(h.repo.baseKeyReads, 6);
		});

		it("ignores another repository's merge-target write, named or coarse", async () => {
			const h = createHarness({ getCommonPath: p => p });
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			h.repo.state.userMergeTarget = 'release';
			assert.deepStrictEqual(await readsAfter(h, () => h.fireMergeTargets(['main'], '/other')), none);
			assert.deepStrictEqual(await readsAfter(h, () => h.fireMergeTargets(undefined, '/other')), none);
			assert.strictEqual(h.repo.baseKeyReads, 3);
		});

		it("re-reads for its own repository's write, from the common path or a sibling worktree", async () => {
			const h = createHarness({ getCommonPath: p => (p === repoPath || p.startsWith('/wt') ? repoPath : p) });
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			h.repo.state.userMergeTarget = 'release';
			assert.deepStrictEqual(await readsAfter(h, () => h.fireMergeTargets(['main'], repoPath)), onlyBase);

			h.addWorktree('/wt-one');
			h.service.subscribe('/wt-one');
			await h.service.getSummary('/wt-one');
			const before = h.repo.baseKeyReads;
			h.fireMergeTargets(undefined, repoPath);
			await delay(60);
			assert.ok(h.repo.baseKeyReads > before);
		});

		it('reacts to every repository without a getCommonPath', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			h.repo.state.userMergeTarget = 'release';
			assert.deepStrictEqual(await readsAfter(h, () => h.fireMergeTargets(['main'], '/other')), onlyBase);
		});

		it('reacts to every repository when getCommonPath has no answer', async () => {
			const h = createHarness({ getCommonPath: () => undefined });
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			h.repo.state.userMergeTarget = 'release';
			assert.deepStrictEqual(await readsAfter(h, () => h.fireMergeTargets(['main'], '/other')), onlyBase);
		});

		it('runs branch and base for a config change', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(await readsAfter(h, () => h.push(['config'])), {
				dirty: 0,
				branch: 1,
				base: 1,
				remotes: 1,
			});
		});

		it('runs everything for head and unknown changes', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(await readsAfter(h, () => h.push(['head', 'heads'], 'HEAD')), all);
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['unknown'])), all);
		});

		it("re-reads for core's own announced write, which raises no raw events", async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(
				await readsAfter(h, () => h.watchService.noteSelfWrite(repoPath, ['head', 'heads', 'index'])),
				all,
			);
			assert.deepStrictEqual(
				await readsAfter(h, () => h.watchService.noteSelfWrite(repoPath, ['index'])),
				onlyDirty,
			);
		});

		it('recomputes the base when switching between a branch and a detached HEAD', async () => {
			const h = createHarness();
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			assert.deepStrictEqual(h.repo.baseBranches, ['main']);

			h.repo.state.detached = true;
			h.repo.state.upstream = undefined;
			h.repo.state.base = { ref: 'main', ahead: 4, sha: 'ddd111', forkPoint: 'fff111', tier: 'default' };
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['head'], 'HEAD')), {
				dirty: 1,
				branch: 1,
				base: 1,
				remotes: 0,
			});
			assert.strictEqual(sub.current?.detached, true);
			assert.strictEqual(sub.current?.base?.ahead, 4);
			assert.deepStrictEqual(h.repo.baseBranches, ['main', undefined]);

			h.repo.state.detached = false;
			h.repo.state.base = {
				ref: 'refs/heads/develop',
				ahead: 3,
				sha: 'ddd111',
				forkPoint: 'fff111',
				tier: 'user',
			};
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['head'], 'HEAD')), {
				dirty: 1,
				branch: 1,
				base: 1,
				remotes: 0,
			});
			assert.strictEqual(sub.current?.branch, 'main');
			assert.strictEqual(sub.current?.base?.tier, 'user');
			assert.deepStrictEqual(h.repo.baseBranches, ['main', undefined, 'main']);
		});

		it('recomputes the base when HEAD moves, or a ref the base depends on moves, while detached', async () => {
			const h = createHarness();
			h.repo.state.detached = true;
			h.repo.state.upstream = undefined;
			h.repo.state.base = { ref: 'main', ahead: 1, sha: 'ddd111', forkPoint: 'fff111', tier: 'default' };
			h.repo.state.baseDependsOn = ['refs/heads/main', 'refs/remotes/origin/HEAD'];
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			h.repo.state.sha = 'bbb222';
			h.repo.state.base = { ref: 'main', ahead: 2, sha: 'ddd111', forkPoint: 'fff111', tier: 'default' };
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['head'], 'HEAD')), {
				dirty: 1,
				branch: 1,
				base: 1,
				remotes: 0,
			});
			assert.strictEqual(sub.current?.base?.ahead, 2);

			h.repo.state.base = { ref: 'main', ahead: 2, sha: 'eee222', forkPoint: 'fff111', tier: 'default' };
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['heads'], 'refs/heads/main')), onlyBase);
			assert.strictEqual(sub.current?.base?.sha, 'eee222');
			assert.deepStrictEqual(h.repo.baseBranches, [undefined, undefined, undefined]);
		});

		it('re-reads no stored base values for a detached HEAD, and the base only when it has none', async () => {
			const h = createHarness();
			h.repo.state.detached = true;
			h.repo.state.upstream = undefined;
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			assert.strictEqual(h.repo.baseKeyReads, 0, 'a detached HEAD has no stored values to read');

			assert.deepStrictEqual(await readsAfter(h, () => h.push(['gkConfig'])), none);
			assert.deepStrictEqual(await readsAfter(h, () => h.fireMergeTargets(['main'])), none);
			assert.strictEqual(h.repo.baseKeyReads, 0);
		});

		it('also reads base and dirty when a branch read finds a different branch', async () => {
			const h = createHarness();
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			h.repo.state.branch = 'feature';
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['remotes'], 'refs/remotes/origin/main')), all);
			assert.strictEqual(sub.current?.branch, 'feature');
		});

		it('reruns once with the merged fields for events during a run', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			const before = h.repo.snapshot();

			h.repo.hold();
			h.push(['index']);
			await waitFor(() => h.repo.counts.dirty > before.dirty);
			const orderStart = h.repo.order.length;
			// Base first, then branch: a merged rerun reads branch before base, separate reruns would not
			h.push(['heads'], 'refs/heads/develop');
			await delay(30);
			h.push(['remotes'], 'refs/remotes/origin/main');
			await delay(30);
			assert.deepStrictEqual(h.repo.snapshot(), { ...before, dirty: before.dirty + 1 }, 'no concurrent run');

			h.repo.release();
			await delay(30);
			await h.service.getSummary(repoPath);

			assert.deepStrictEqual(h.repo.snapshot(), {
				dirty: before.dirty + 1,
				branch: before.branch + 1,
				base: before.base + 1,
				remotes: before.remotes + 1,
			});
			assert.deepStrictEqual(h.repo.order.slice(orderStart), ['branch', 'remotes', 'base']);
		});
	});

	describe('change notification', () => {
		it('fires nothing for an unchanged recompute', async () => {
			const h = createHarness();
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			const fired: WorktreeSummary[] = [];
			const global: WorktreeSummary[] = [];
			sub.onDidChange(e => fired.push(e));
			h.service.onDidChangeSummary(e => global.push(e));

			await readsAfter(h, () => h.push(['head', 'heads'], 'HEAD'));

			assert.strictEqual(fired.length, 0);
			assert.strictEqual(global.length, 0);
		});

		it('fires once on the subscription and the service for a changed recompute', async () => {
			const h = createHarness();
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			const fired: WorktreeSummary[] = [];
			const global: WorktreeSummary[] = [];
			sub.onDidChange(e => fired.push(e));
			h.service.onDidChangeSummary(e => global.push(e));

			h.repo.state.upstream = { name: 'origin/main', missing: false, ahead: 1, behind: 5 };
			await readsAfter(h, () => h.push(['remotes'], 'refs/remotes/origin/main'));

			assert.strictEqual(fired.length, 1);
			assert.strictEqual(global.length, 1);
			assert.strictEqual(fired[0], global[0]);
			assert.deepStrictEqual(fired[0], { ...expectedInitial, behind: 5 });
			assert.strictEqual(sub.current, fired[0]);
		});

		it('fires for a commit and a fast-forward of the base that leave every count the same', async () => {
			const h = createHarness();
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			const fired: WorktreeSummary[] = [];
			const global: WorktreeSummary[] = [];
			sub.onDidChange(e => fired.push(e));
			h.service.onDidChangeSummary(e => global.push(e));

			h.repo.state.sha = 'aaa222';
			h.repo.state.base = { ...h.repo.state.base!, sha: 'ddd222' };
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['heads'], 'refs/heads/main')), all);

			assert.strictEqual(fired.length, 1);
			assert.strictEqual(global.length, 1);
			assert.deepStrictEqual(fired[0], {
				...expectedInitial,
				sha: 'aaa222',
				base: { ref: 'refs/heads/develop', ahead: 3, sha: 'ddd222', forkPoint: 'fff111', tier: 'user' },
			});
		});

		it('fires when only the base fork point or tier changes', async () => {
			const h = createHarness();
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			const fired: WorktreeSummary[] = [];
			sub.onDidChange(e => fired.push(e));

			h.repo.state.base = { ...h.repo.state.base!, forkPoint: 'fff222' };
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['heads'], 'refs/heads/develop')), onlyBase);
			assert.strictEqual(fired.length, 1);
			assert.strictEqual(fired[0].base?.forkPoint, 'fff222');

			h.repo.state.base = { ...h.repo.state.base, tier: 'default' };
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['heads'], 'refs/heads/develop')), onlyBase);
			assert.strictEqual(fired.length, 2);
			assert.strictEqual(fired[1].base?.tier, 'default');
		});

		it('fires when only the base tip moves, reading only the base', async () => {
			const h = createHarness();
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			const fired: WorktreeSummary[] = [];
			sub.onDidChange(e => fired.push(e));

			h.repo.state.base = { ...h.repo.state.base!, sha: 'ddd222' };
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['heads'], 'refs/heads/develop')), onlyBase);

			assert.strictEqual(fired.length, 1);
			assert.deepStrictEqual(fired[0], {
				...expectedInitial,
				base: { ref: 'refs/heads/develop', ahead: 3, sha: 'ddd222', forkPoint: 'fff111', tier: 'user' },
			});
			assert.strictEqual(fired[0].sha, 'aaa111');
		});

		it('fires when only the refs the base depends on change', async () => {
			const h = createHarness();
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			const fired: WorktreeSummary[] = [];
			sub.onDidChange(e => fired.push(e));

			h.repo.state.baseDependsOn = ['refs/heads/develop', 'refs/remotes/origin/develop'];
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['heads'], 'refs/heads/develop')), onlyBase);

			assert.strictEqual(fired.length, 1);
			assert.deepStrictEqual(fired[0], {
				...expectedInitial,
				baseDependsOn: ['refs/heads/develop', 'refs/remotes/origin/develop'],
			});

			assert.deepStrictEqual(
				await readsAfter(h, () => h.push(['remotes'], 'refs/remotes/origin/develop')),
				onlyBase,
				'the new list is what is watched now',
			);
		});

		it('keeps the tips through a dirty-only recompute', async () => {
			const h = createHarness();
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			const fired: WorktreeSummary[] = [];
			sub.onDidChange(e => fired.push(e));

			// Values the dirty probe must not re-read
			h.repo.state.dirty = true;
			h.repo.state.sha = 'aaa222';
			h.repo.state.base = { ...h.repo.state.base!, sha: 'ddd222' };
			assert.deepStrictEqual(await readsAfter(h, () => h.pushWorkingTree()), onlyDirty);

			assert.strictEqual(fired.length, 1);
			assert.strictEqual(fired[0].dirty, true);
			assert.strictEqual(fired[0].sha, 'aaa111');
			assert.strictEqual(fired[0].base?.sha, 'ddd111');
		});

		it('marks the value stale once on failure and clears it on recovery', async () => {
			const h = createHarness();
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			const fired: WorktreeSummary[] = [];
			sub.onDidChange(e => fired.push(e));

			h.repo.state.fail = new Error('index.lock exists');
			await readsAfter(h, () => h.push(['index']));
			assert.strictEqual(fired.length, 1);
			assert.deepStrictEqual(fired[0], { ...expectedInitial, stale: true });
			assert.deepStrictEqual(await h.service.getSummary(repoPath), { ...expectedInitial, stale: true });

			await readsAfter(h, () => h.push(['index']));
			assert.strictEqual(fired.length, 1, 'no refire while already stale');

			h.repo.state.fail = undefined;
			const recovery = await readsAfter(h, () => h.push(['index']));
			assert.strictEqual(fired.length, 2);
			assert.deepStrictEqual(fired[1], expectedInitial);
			assert.ok(
				recovery.branch === 1 && recovery.base === 1 && recovery.dirty === 1,
				'a stale value is re-read in full, not just the groups the event names',
			);
		});

		it('keeps the other fields and the last base, marked stale, when only the base read fails', async () => {
			const h = createHarness();
			const sub = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);
			const fired: WorktreeSummary[] = [];
			sub.onDidChange(e => fired.push(e));

			h.repo.state.baseFail = new Error('rev-list failed');
			h.repo.state.upstream = { name: 'origin/main', missing: false, ahead: 1, behind: 5 };
			const failed = await readsAfter(h, () => h.push(['config']));
			assert.deepStrictEqual(failed, { dirty: 0, branch: 1, base: 1, remotes: 1 });
			assert.strictEqual(fired.length, 1);
			assert.deepStrictEqual(fired[0], { ...expectedInitial, behind: 5, stale: true });

			await readsAfter(h, () => h.push(['config']));
			assert.strictEqual(fired.length, 1, 'no refire while the base keeps failing');

			h.repo.state.baseFail = undefined;
			await readsAfter(h, () => h.push(['config']));
			assert.strictEqual(fired.length, 2);
			assert.deepStrictEqual(fired[1], { ...expectedInitial, behind: 5 });
		});

		it('keeps the refs the base depends on when only the base read fails', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			h.repo.state.baseFail = new Error('rev-list failed');
			h.repo.state.baseDependsOn = ['refs/heads/other'];
			await readsAfter(h, () => h.push(['heads'], 'refs/heads/develop'));

			const summary = await h.service.getSummary(repoPath);
			assert.strictEqual(summary.stale, true);
			assert.deepStrictEqual(summary.baseDependsOn, ['refs/heads/develop']);
		});

		it('retries the base when a ref it depends on moves after the base read failed', async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			h.repo.state.baseFail = new Error('rev-list failed');
			await readsAfter(h, () => h.push(['config']));

			h.repo.state.baseFail = undefined;
			assert.deepStrictEqual(
				await readsAfter(h, () => h.push(['heads'], 'refs/heads/develop')),
				all,
				'the stale value is re-read in full',
			);
			assert.deepStrictEqual(await h.service.getSummary(repoPath), expectedInitial);
		});

		it('answers a first read whose base fails with the other fields and no base, marked stale', async () => {
			const h = createHarness();
			h.repo.state.baseFail = new Error('rev-list failed');
			h.service.subscribe(repoPath);

			assert.deepStrictEqual(await h.service.getSummary(repoPath), {
				...expectedInitial,
				base: undefined,
				baseDependsOn: [],
				stale: true,
			});
		});

		it('answers a one-off read of an unsubscribed worktree whose base fails', async () => {
			const h = createHarness();
			h.repo.state.baseFail = new Error('rev-list failed');

			assert.deepStrictEqual(await h.service.getSummary(repoPath), {
				...expectedInitial,
				base: undefined,
				baseDependsOn: [],
				stale: true,
			});
		});

		it("does not keep the previous branch's base when the base read fails after a checkout", async () => {
			const h = createHarness();
			h.service.subscribe(repoPath);
			assert.deepStrictEqual(await h.service.getSummary(repoPath), expectedInitial);

			h.repo.state.branch = 'other';
			h.repo.state.baseFail = new Error('rev-list failed');
			await readsAfter(h, () => h.push(['head']));

			const summary = await h.service.getSummary(repoPath);
			assert.strictEqual(summary.branch, 'other');
			assert.strictEqual(summary.base, undefined);
			assert.strictEqual(summary.stale, true);
		});

		it('rejects getSummary after a failed first read until a later run succeeds', async () => {
			const h = createHarness();
			const failure = new Error('not a git repository');
			h.repo.state.fail = failure;
			const fired: WorktreeSummary[] = [];
			const sub = h.service.subscribe(repoPath);
			sub.onDidChange(e => fired.push(e));

			await assert.rejects(h.service.getSummary(repoPath), failure);
			await assert.rejects(h.service.getSummary(repoPath), failure);
			assert.strictEqual(sub.current, undefined);
			assert.strictEqual(fired.length, 0);

			h.repo.state.fail = undefined;
			const before = h.repo.snapshot();
			h.push(['tags'], 'refs/tags/v1');
			await waitFor(() => h.repo.counts.branch > before.branch);

			assert.deepStrictEqual(await h.service.getSummary(repoPath), expectedInitial);
			assert.strictEqual(fired.length, 1);
		});
	});

	describe('remote HEAD symref', () => {
		it('reads the base again once the symref is written', async () => {
			const h = createHarness();
			const remoteHead = 'refs/remotes/origin/HEAD';
			h.repo.state.baseDependsOn = ['refs/heads/develop', remoteHead];
			h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			// What a fetch or `git remote set-head -a` writing the symref looks like to the watcher
			h.repo.state.base = { ref: 'origin/main', ahead: 4, sha: 'eee111', forkPoint: 'fff222', tier: 'default' };
			assert.deepStrictEqual(await readsAfter(h, () => h.push(['remotes'], remoteHead)), onlyBase);
			assert.deepStrictEqual((await h.service.getSummary(repoPath)).base, {
				ref: 'origin/main',
				ahead: 4,
				sha: 'eee111',
				forkPoint: 'fff222',
				tier: 'default',
			});
		});
	});

	describe('timing', () => {
		async function dirtyReadsWithin(h: Harness, ms: number): Promise<number> {
			const before = h.repo.counts.dirty;
			h.pushWorkingTree();
			await delay(ms);
			return h.repo.counts.dirty - before;
		}

		it("uses the session's cadence unless a subscriber asks for a shorter working-tree delay", async () => {
			const h = createHarness({ defaultWorkingTreeDelayMs: 300 });
			const slow = h.service.subscribe(repoPath);
			await h.service.getSummary(repoPath);

			assert.strictEqual(await dirtyReadsWithin(h, 80), 0, 'the listening subscription is timing-neutral');
			await waitFor(() => h.repo.counts.dirty === 2);

			const options: WorktreeSummarySubscribeOptions = { workingTreeDelayMs: 10 };
			const fast = h.service.subscribe(repoPath, options);
			assert.strictEqual(await dirtyReadsWithin(h, 80), 1, "the subscriber's delay shortens the cadence");

			fast.dispose();
			assert.strictEqual(await dirtyReadsWithin(h, 80), 0, 'disposing it restores the cadence');
			await waitFor(() => h.repo.counts.dirty === 4);

			slow.dispose();
		});
	});
});

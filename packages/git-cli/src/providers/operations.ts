import * as l10n from '@vscode/l10n';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitConflictCommand, GitServiceContext } from '@gitlens/git/context.js';
import {
	CheckoutError,
	CherryPickError,
	CommitError,
	FetchError,
	MergeError,
	PullError,
	PushError,
	RebaseError,
	ResetError,
	RevertError,
	SigningError,
} from '@gitlens/git/errors.js';
import type { GitBranchReference, GitReference } from '@gitlens/git/models/reference.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import type { SigningFormat } from '@gitlens/git/models/signature.js';
import type { GitConflictFile } from '@gitlens/git/models/staging.js';
import type {
	GitOperationResult,
	GitOperationRunOptions,
	GitOperationsSubProvider,
} from '@gitlens/git/providers/operations.js';
import { isBranchReference } from '@gitlens/git/utils/reference.utils.js';
import { getRefChangeKind } from '@gitlens/git/watching/changeEvent.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { sequentialize } from '@gitlens/utils/decorators/sequentialize.js';
import { chunkByStringLength } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { normalizePath, splitPath } from '@gitlens/utils/path.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import { mayWriteTracking } from '../exec/commandClassifier.js';
import type { Git, PushForceOptions } from '../exec/git.js';
import {
	classifySigningError,
	getGitCommandError,
	gitConfigsPull,
	GitErrors,
	inferSigningFormatFromError,
	isRunHookFailure,
	maxGitCliLength,
} from '../exec/git.js';
import type { HeadState } from '../exec/headState.js';
import { getMovedHead, readHeadState } from '../exec/headState.js';
import { resolveBranchRemote } from './branchRemote.js';
import { parseGitBoolean } from './config.js';

/** The remotes a fetch read with their configured refspecs: one named remote, all of them, or a bare fetch's default */
type FetchedRemotes = { remote: string } | 'all' | 'default';

/** The ref kinds a fetch can move, in the order its announcement lists them */
const fetchRefChangeKinds: readonly RepositoryChange[] = ['remotes', 'heads', 'tags', 'stash'];

/** The destinations a fetch's snapshot covers when the remotes' configured refspecs can't be read */
const broadFetchDestinations: readonly string[] = ['refs/heads', 'refs/remotes'];

/**
 * The ref a fetch refspec stores into, qualified as git's fetch does — `heads/`, `tags/` and `remotes/` get `refs/`,
 * and any other unqualified name is a local branch — or `undefined` when it stores nothing (no `:`, or nothing after
 * it). A glob destination keeps its glob.
 */
function getRefspecDestination(refspec: string): string | undefined {
	const stripped = refspec.startsWith('+') ? refspec.slice(1) : refspec;
	const colonIndex = stripped.indexOf(':');
	if (colonIndex === -1) return undefined;

	const destination = stripped.slice(colonIndex + 1);
	if (!destination) return undefined;
	if (destination.startsWith('refs/')) return destination;

	return /^(?:heads|tags|remotes)\//.test(destination) ? `refs/${destination}` : `refs/heads/${destination}`;
}

/**
 * The for-each-ref patterns covering `destinations` (the refs a fetch may store into) and tags, which a fetch follows
 * into what it fetched. A pattern's `*` doesn't match across `/`, so a glob destination is widened to the directory
 * above its first glob.
 */
function getFetchSnapshotPatterns(destinations: Iterable<string>): string[] {
	const patterns = ['refs/tags'];
	for (let destination of destinations) {
		const globIndex = destination.search(/[*?[]/);
		if (globIndex !== -1) {
			destination = destination.substring(0, destination.lastIndexOf('/', globIndex));
		}
		if (patterns.some(p => destination === p || destination.startsWith(`${p}/`))) continue;

		patterns.push(destination);
	}
	return patterns;
}

/** The refs created, moved, retargeted or deleted between two snapshots */
function getMovedRefs(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
	const moved: string[] = [];
	for (const [ref, sha] of after) {
		if (before.get(ref) !== sha) {
			moved.push(ref);
		}
	}
	for (const ref of before.keys()) {
		if (!after.has(ref)) {
			moved.push(ref);
		}
	}
	return moved;
}

export class OperationsGitSubProvider implements GitOperationsSubProvider {
	/** The `commonPath\0remote` pairs {@link followRemoteHeads} has handled */
	private readonly followedRemoteHeads = new Set<string>();

	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string; noTracking?: boolean },
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const scope = getScopedLogger();

		const params = ['checkout'];
		if (options?.createBranch) {
			params.push('-b', options.createBranch);
			if (options.noTracking) {
				params.push('--no-track');
			}
			params.push(ref, '--');
		} else {
			params.push(ref, '--');
		}

		try {
			await this.git.run({ cwd: repoPath, errors: 'throw', ...runOptions }, ...params);
			if (options?.createBranch) {
				// Evict the cached base only — see `createBranch` on why the persisted keys stay.
				this.cache.deleteBaseBranchName(repoPath, options.createBranch);
			}
		} catch (ex) {
			scope?.error(ex);
			if (isRunHookFailure(ex)) throw ex;

			throw getGitCommandError(
				'checkout',
				ex,
				reason =>
					new CheckoutError(
						{ reason: reason ?? 'other', ref: ref, gitCommand: { repoPath: repoPath, args: params } },
						ex,
					),
			);
		} finally {
			// `-b` moves only the branch it creates, and writes tracking to that branch's own config section
			this.announceHeadChanged(
				repoPath,
				options?.createBranch ? { branch: `refs/heads/${options.createBranch}` } : undefined,
				Boolean(options?.createBranch) && mayWriteTracking(ref, options?.noTracking),
				true,
			);
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async cherryPick(
		repoPath: string,
		revs: string[],
		options?: { edit?: boolean; noCommit?: boolean; source?: unknown },
		runOptions?: GitOperationRunOptions,
	): Promise<GitOperationResult> {
		const scope = getScopedLogger();

		const args = ['cherry-pick'];
		if (options?.edit) {
			args.push('-e');
		}
		if (options?.noCommit) {
			args.push('-n');
		}

		if (revs.length > 1) {
			// Sort commits in topological order (oldest ancestor first) so cherry-pick applies them correctly.
			// This is a local read-only pre-flight, not the user-initiated op — don't subject it to caller env/timeout.
			const revsSet = new Set(revs);
			const result = await this.git.run({ cwd: repoPath }, 'rev-list', '--topo-order', '--reverse', ...revs);

			const ordered: string[] = [];
			for (const sha of result.stdout.trim().split('\n')) {
				if (sha && revsSet.has(sha)) {
					ordered.push(sha);
					if (ordered.length === revs.length) break; // Early exit once we have all
				}
			}

			if (ordered.length === revs.length) {
				revs = ordered;
			}
			// If we didn't get all commits (shouldn't happen), keep original order
		}

		args.push(...revs);

		try {
			await this.runMovingHeadBranch(repoPath, () =>
				this.git.run({ cwd: repoPath, errors: 'throw', ...runOptions }, ...args),
			);
			return { conflicted: false };
		} catch (ex) {
			scope?.error(ex);
			if (isRunHookFailure(ex)) throw ex;

			await this.throwIfSigningError(repoPath, args, ex, options?.source);
			const mapped = getGitCommandError(
				'cherry-pick',
				ex,
				reason =>
					new CherryPickError(
						{ reason: reason ?? 'other', revs: revs, gitCommand: { repoPath: repoPath, args: args } },
						ex as Error,
					),
			);
			if (CherryPickError.is(mapped, 'conflicts')) {
				return this.createConflictResult(repoPath, 'cherry-pick');
			}
			throw mapped;
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async commit(
		repoPath: string,
		message: string,
		options?: {
			all?: boolean;
			allowEmpty?: boolean;
			amend?: boolean;
			author?: string;
			date?: string;
			signoff?: boolean;
			source?: unknown;
		},
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const scope = getScopedLogger();

		const params = ['commit'];
		if (options?.all) {
			params.push('--all');
		}
		if (options?.allowEmpty) {
			params.push('--allow-empty');
		}
		if (options?.amend) {
			params.push('--amend');
		}
		if (options?.signoff) {
			params.push('--signoff');
		}
		if (options?.author) {
			params.push(`--author=${options.author}`);
		}
		if (options?.date) {
			params.push(`--date=${options.date}`);
		}
		// Host-level override (e.g. VS Code's `git.enableCommitSigning`) — request signing explicitly
		// via `-S`. Implicit repo-config signing (`commit.gpgsign=true`) needs no flag, and `-S`
		// alongside it is harmless, so the override can only enable signing, never force it off.
		const sign = this.context.config?.signing?.enabled === true;
		if (sign) {
			params.push('-S');
		}
		// Read commit message from stdin via -F - to avoid shell escaping issues
		params.push('-F', '-');

		try {
			// A commit refused by a hook can still have restaged files, which the announcement covers too
			await this.runMovingHeadBranch(repoPath, () =>
				this.git.run(
					{ cwd: repoPath, stdin: message, stdinEncoding: 'utf8', errors: 'throw', ...runOptions },
					...params,
				),
			);
			if (sign) {
				// `-S` was passed and the commit succeeded, so signing is confirmed — fire the
				// explicit-sign hook (same contract as the patch provider's `commit-tree -S` path).
				let format: SigningFormat | undefined;
				try {
					format = (await this.provider.config.getSigningConfig?.(repoPath))?.format;
				} catch {}
				this.context.hooks?.commits?.onSigned?.(format ?? 'gpg', options?.source);
			}
		} catch (ex) {
			scope?.error(ex);
			if (isRunHookFailure(ex)) throw ex;

			await this.throwIfSigningError(repoPath, params, ex, options?.source);
			throw getGitCommandError(
				'commit',
				ex,
				reason =>
					new CommitError(
						{ reason: reason ?? 'other', gitCommand: { repoPath: repoPath, args: params } },
						ex,
					),
			);
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async fetch(
		repoPath: string,
		options?:
			| {
					all?: boolean;
					branch?: GitBranchReference;
					prune?: boolean;
					pull?: boolean;
					remote?: string;
					refspecs?: undefined;
					preserveFetchHead?: boolean;
			  }
			| {
					all?: undefined;
					branch?: undefined;
					prune?: boolean;
					pull?: undefined;
					remote: string;
					refspecs: readonly string[];
					preserveFetchHead?: boolean;
			  },
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const scope = getScopedLogger();

		const { branch, ...opts } = options ?? {};
		let ran = false;
		let fetched: FetchedRemotes | undefined;
		let snapshot: { patterns: string[]; before: Map<string, string> | undefined } | undefined;
		try {
			if (isBranchReference(branch)) {
				const resolved = await resolveBranchRemote(this.provider, repoPath, branch, runOptions?.cancellation);
				if (resolved.remote == null) return;

				// A pull fetch stores the upstream into the local branch (see `fetchCore`)
				const patterns = await this.getFetchSnapshotPatterns(
					repoPath,
					resolved.remote,
					options?.pull ? [`${resolved.upstream}:${resolved.name}`] : undefined,
				);
				snapshot = { patterns: patterns, before: await this.snapshotRefs(repoPath, patterns) };
				ran = true;
				await this.fetchCore(
					repoPath,
					{
						branch: resolved.name,
						remote: resolved.remote,
						upstream: resolved.upstream!,
						pull: options?.pull,
						preserveFetchHead: options?.preserveFetchHead,
					},
					runOptions,
				);
			} else {
				// A bare fetch reads its default remote, or all of them: every remote's refspecs cover either
				const patterns = await this.getFetchSnapshotPatterns(repoPath, opts.remote, opts.refspecs);
				snapshot = { patterns: patterns, before: await this.snapshotRefs(repoPath, patterns) };
				ran = true;
				await this.fetchCore(repoPath, opts, runOptions);
				if (!opts.refspecs?.length) {
					fetched = opts.remote != null ? { remote: opts.remote } : opts.all ? 'all' : 'default';
				}
			}
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		} finally {
			// A rejected fetch may have stored some of its refs before it failed
			if (ran) {
				await this.announceFetch(repoPath, snapshot, () => this.getFetchChanges(branch, options));
			}
			if (fetched != null) {
				void this.followRemoteHeads(repoPath, fetched);
			}
		}
	}

	/**
	 * Writes the missing `refs/remotes/<remote>/HEAD` (the default branch the base reads) of each remote a fetch just
	 * read with its configured refspecs, once per remote, on git < 2.48 — newer git's fetch creates it itself. A bare
	 * fetch/pull reads every remote when `fetch.all` is set (git 2.44+), else its default remote. Right after the
	 * fetch, so the credentials it used are still cached. Never awaited; never rejects, failures not retried.
	 */
	private async followRemoteHeads(repoPath: string, fetched: FetchedRemotes): Promise<void> {
		try {
			if (await this.git.supports('git:fetch:follow-remote-head')) return;

			const commonPath = this.cache.getCommonPath(repoPath);
			const pending = (names: string[]): string[] =>
				names.filter(r => !this.followedRemoteHeads.has(`${commonPath}\0${r}`));

			// One cached read for everything that picks the remotes
			const config = await this.provider.config.getConfigRegex(
				repoPath,
				'^(fetch\\.all|remote\\..+\\.skipfetchall|branch\\..+\\.remote)$',
			);

			if (
				fetched === 'default' &&
				parseGitBoolean(config.get('fetch.all')) &&
				(await this.git.supports('git:fetch:all-config'))
			) {
				fetched = 'all';
			}

			let remotes: string[];
			if (fetched === 'all') {
				// `fetch --all` skips the remotes marked `skipFetchAll`
				remotes = pending(
					(await this.provider.remotes.getRemotes(repoPath))
						.map(r => r.name)
						.filter(r => !parseGitBoolean(config.get(`remote.${r}.skipfetchall`))),
				);
			} else if (fetched === 'default') {
				const remote = await this.getDefaultFetchRemote(repoPath, config);
				remotes = pending(remote != null ? [remote] : []);
			} else {
				remotes = pending([fetched.remote]);
			}
			if (!remotes.length) return;

			for (const remote of remotes) {
				this.followedRemoteHeads.add(`${commonPath}\0${remote}`);
			}
			for (const remote of remotes) {
				try {
					await this.provider.branches.setRemoteHeadIfMissing(repoPath, remote);
				} catch {}
			}
		} catch {}
	}

	/**
	 * The remote a bare `fetch`/`pull` reads: the current branch's `branch.<name>.remote` (none for `.`, the local
	 * repository), else the sole remote, else `origin`
	 */
	private async getDefaultFetchRemote(repoPath: string, config: Map<string, string>): Promise<string | undefined> {
		const current = await this.provider.branches.getBranch(repoPath);
		const configured = current != null ? config.get(`branch.${current.name}.remote`) : undefined;
		if (configured) return configured === '.' ? undefined : configured;

		const remotes = await this.provider.remotes.getRemotes(repoPath);
		return remotes.length === 1 ? remotes[0].name : 'origin';
	}

	/**
	 * The for-each-ref patterns covering every ref a fetch from `remote` (`undefined`: from any remote) may write: the
	 * destinations of `refspecs`, those of the remote's configured `remote.<name>.fetch` refspecs (which a fetch of
	 * explicit refspecs still updates opportunistically, and which may store into local branches, as a mirror's do),
	 * and tags. A `remote` with no refspecs of its own may be a remote group (`remotes.<group>`), which fetches each of
	 * its remotes, so every remote's destinations stand for it. When the configuration can't be read, all local and
	 * remote-tracking branches stand for the configured destinations.
	 */
	private async getFetchSnapshotPatterns(
		repoPath: string,
		remote: string | undefined,
		refspecs: readonly string[] | undefined,
	): Promise<string[]> {
		const destinations: string[] = [];
		const add = (refspec: string): void => {
			const destination = getRefspecDestination(refspec);
			if (destination != null) {
				destinations.push(destination);
			}
		};

		for (const refspec of refspecs ?? []) {
			add(refspec);
		}

		let configured: Map<string, string[]> | undefined;
		try {
			configured = await this.provider.config.getConfigRegexAll(repoPath, '^remote\\..+\\.fetch$');
		} catch {
			destinations.unshift(...broadFetchDestinations);
		}
		const ownKey = remote != null ? `remote.${remote}.fetch` : undefined;
		const onlyKey = ownKey != null && configured?.has(ownKey) ? ownKey : undefined;
		for (const [key, values] of configured ?? []) {
			if (onlyKey != null && key !== onlyKey) continue;

			for (const refspec of values) {
				add(refspec);
			}
		}
		return getFetchSnapshotPatterns(destinations);
	}

	/**
	 * Announces what a fetch moved. Its refs are compared with the snapshot taken before it ran, so a fetch that
	 * brought nothing new announces nothing (and resets nothing), and one that did names exactly the refs it moved,
	 * letting every worktree that doesn't track them skip its refresh. When either snapshot is missing, it announces
	 * `fallback()`'s kinds unnamed, as if every ref of them may have moved; when a ref moved outside the kinds an
	 * announcement can name (`refs/notes/*`), the kinds it did see, together with `fallback()`'s, unnamed.
	 */
	private async announceFetch(
		repoPath: string,
		snapshot: { patterns: string[]; before: Map<string, string> | undefined } | undefined,
		fallback: () => RepositoryChange[],
	): Promise<void> {
		const after = snapshot?.before != null ? await this.snapshotRefs(repoPath, snapshot.patterns) : undefined;

		let changes: RepositoryChange[] | undefined;
		let moved: string[] | undefined;
		if (snapshot?.before != null && after != null) {
			moved = getMovedRefs(snapshot.before, after);
			if (!moved.length) return;

			const kinds = new Set<RepositoryChange>();
			let unnameable = false;
			for (const ref of moved) {
				const kind = ref.startsWith('refs/') ? getRefChangeKind(ref) : undefined;
				if (kind != null) {
					kinds.add(kind);
				} else {
					unnameable = true;
				}
			}
			if (unnameable) {
				for (const kind of fallback()) {
					kinds.add(kind);
				}
				moved = undefined;
			}
			changes = fetchRefChangeKinds.filter(k => kinds.has(k));
		}

		this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'tags');
		if (changes != null && moved != null) {
			this.context.hooks?.repository?.onChanged?.(repoPath, changes, moved);
		} else {
			this.context.hooks?.repository?.onChanged?.(repoPath, changes ?? fallback());
		}
	}

	/**
	 * Each ref under `patterns` (for-each-ref patterns) with its object and, for a symbolic ref, its target (a remote's
	 * `HEAD` can move to another branch at the same commit), or `undefined` when git couldn't answer. A read, so it
	 * announces nothing.
	 */
	private async snapshotRefs(
		repoPath: string,
		patterns: readonly string[],
	): Promise<Map<string, string> | undefined> {
		try {
			const result = await this.git.run(
				{ cwd: repoPath, errors: 'ignore' },
				'for-each-ref',
				'--format=%(refname)%00%(objectname)%00%(symref)',
				...patterns,
			);
			// `errors: 'ignore'` resolves a failed read empty, which would read as every ref deleted
			if (result.completion.status !== 'exited' || result.exitCode !== 0) return undefined;

			const refs = new Map<string, string>();
			for (const line of result.stdout.split('\n')) {
				const index = line.indexOf('\0');
				if (index === -1) continue;

				refs.set(line.substring(0, index), line.substring(index + 1).trim());
			}
			return refs;
		} catch {
			return undefined;
		}
	}

	/** `remotes`, plus `heads`/`tags` for any local branch or tag the fetch writes — a `pull` fetch writes `<upstream>:<branch>` */
	private getFetchChanges(
		branch: GitBranchReference | undefined,
		options: { pull?: boolean; refspecs?: readonly string[] } | undefined,
	): RepositoryChange[] {
		if (isBranchReference(branch)) {
			return options?.pull ? ['heads', 'remotes'] : ['remotes'];
		}
		if (!options?.refspecs?.length) return ['remotes'];

		const changes: RepositoryChange[] = ['remotes'];
		for (const refspec of options.refspecs) {
			const destination = getRefspecDestination(refspec);
			if (destination == null) continue;

			if (destination.startsWith('refs/tags/')) {
				if (!changes.includes('tags')) {
					changes.push('tags');
				}
			} else if (destination.startsWith('refs/heads/')) {
				if (!changes.includes('heads')) {
					changes.push('heads');
				}
			}
		}
		return changes;
	}

	private async fetchCore(
		repoPath: string,
		options:
			| {
					all?: boolean;
					branch?: undefined;
					prune?: boolean;
					pull?: boolean;
					remote?: string;
					refspecs?: undefined;
					preserveFetchHead?: boolean;
			  }
			| {
					all?: undefined;
					branch: string;
					prune?: undefined;
					pull?: boolean;
					remote: string;
					upstream: string;
					/**
					 * `-u` (`--update-head-ok`, the default) lets a `pull` fetch move a branch even where it is
					 * checked out; `false` keeps git's own refusal as a guard against a stale worktree lookup.
					 */
					updateHeadOk?: boolean;
					refspecs?: undefined;
					preserveFetchHead?: boolean;
			  }
			| {
					all?: undefined;
					branch?: undefined;
					prune?: boolean;
					pull?: undefined;
					remote: string;
					refspecs: readonly string[];
					preserveFetchHead?: boolean;
			  },
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const params = ['fetch'];

		if (options.prune) {
			params.push('--prune');
		}

		if (options.preserveFetchHead && (await this.git.supports('git:fetch:no-write-fetch-head'))) {
			params.push('--no-write-fetch-head');
		}

		if (options.branch && options.remote) {
			if (options.upstream && options.pull) {
				if (options.updateHeadOk !== false) {
					params.push('-u');
				}
				params.push(options.remote, `${options.upstream}:${options.branch}`);
			} else {
				params.push(options.remote, options.upstream || options.branch);
			}
		} else if (options.refspecs?.length) {
			params.push(options.remote, ...options.refspecs);
		} else if (options.remote) {
			params.push(options.remote);
		} else if (options.all) {
			params.push('--all');
		}

		try {
			await this.git.run({ cwd: repoPath, errors: 'throw', ...runOptions }, ...params);
		} catch (ex) {
			if (isRunHookFailure(ex)) throw ex;

			throw getGitCommandError(
				'fetch',
				ex,
				reason =>
					new FetchError(
						{
							reason: reason ?? 'other',
							branch: options?.branch,
							remote: options?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					),
			);
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async merge(
		repoPath: string,
		ref: string,
		options?: { fastForward?: boolean | 'only'; noCommit?: boolean; squash?: boolean; source?: unknown },
		runOptions?: GitOperationRunOptions,
	): Promise<GitOperationResult> {
		const scope = getScopedLogger();

		const args = ['merge'];

		if (options?.fastForward === 'only') {
			args.push('--ff-only');
		} else if (options?.fastForward === true) {
			args.push('--ff');
		} else if (options?.fastForward === false) {
			args.push('--no-ff');
		}
		if (options?.squash) {
			args.push('--squash');
		}
		if (options?.noCommit) {
			args.push('--no-commit');
		}

		args.push(ref);

		try {
			await this.runMovingHeadBranch(repoPath, () =>
				this.git.run(
					// Avoid a timeout since merges can take a long time (set to 0 to disable)
					{ cwd: repoPath, errors: 'throw', timeout: 0, ...runOptions },
					...args,
				),
			);
			return { conflicted: false };
		} catch (ex) {
			scope?.error(ex);
			if (isRunHookFailure(ex)) throw ex;

			await this.throwIfSigningError(repoPath, args, ex, options?.source);
			const mapped = getGitCommandError(
				'merge',
				ex,
				reason =>
					new MergeError(
						{ reason: reason ?? 'other', ref: ref, gitCommand: { repoPath: repoPath, args: args } },
						ex as Error,
					),
			);
			if (MergeError.is(mapped, 'conflicts')) {
				return this.createConflictResult(repoPath, 'merge');
			}
			throw mapped;
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async pull(
		repoPath: string,
		options?: {
			branch?: GitBranchReference;
			fastForward?: 'only';
			rebase?: boolean;
			tags?: boolean;
			source?: unknown;
		},
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const scope = getScopedLogger();

		// Set once a git command is about to run, so a pull that fails partway (a merge or rebase stopping on a
		// conflict, a fetch that stored some refs) announces what it changed the way a finished one does
		let announce: (() => void) | undefined;
		// A `pull` with no arguments fetches the branch's remote with its configured refspecs
		let fetched: { repoPath: string; remotes: FetchedRemotes } | undefined;
		try {
			if (isBranchReference(options?.branch)) {
				const branch = options.branch;
				// Find the worktree where this branch is checked out (if any)
				const worktree = await this.provider.worktrees?.getWorktree(
					repoPath,
					wt => wt.branchName === branch.name,
				);
				if (worktree != null) {
					// Branch is checked out in a worktree — run git pull in that worktree's directory
					// Any rebase state (e.g. from `pull.rebase=true`) appears under the worktree path
					const worktreePath = normalizePath(worktree.uri.fsPath);
					// Its HEAD, index and any paused merge or rebase belong to that worktree, not to `repoPath`
					announce = () => {
						this.announcePull(repoPath);
						if (worktreePath !== normalizePath(repoPath)) {
							this.announcePull(worktreePath);
						}
					};
					this.context.hooks?.operations?.onRebaseCapableOperation?.(worktreePath, 'pull', 'started');
					try {
						await this.pullCore(
							worktreePath,
							{
								fastForward: options?.fastForward,
								rebase: options?.rebase,
								tags: options?.tags,
								source: options?.source,
							},
							runOptions,
						);
						fetched = { repoPath: worktreePath, remotes: 'default' };
					} finally {
						this.context.hooks?.operations?.onRebaseCapableOperation?.(worktreePath, 'pull', 'ended');
					}
				} else if (options?.fastForward === 'only') {
					// Not checked out anywhere, so there is no working tree to merge into — but a fast-forward
					// needs none: fetching `<upstream>:<branch>` advances the local branch, and git refuses that
					// non-forced refspec unless it fast-forwards. A plain fetch would leave the branch unmoved
					// and report success.
					// Fetched without `-u`: the worktree lookup above is cached and can miss a worktree added
					// outside core, and then git's own refusal is what keeps a checked-out branch from moving.
					const {
						name: branchName,
						remote: remoteName,
						upstream,
					} = await resolveBranchRemote(this.provider, repoPath, branch, runOptions?.cancellation);
					if (remoteName == null || upstream == null) {
						throw new PullError({
							reason: 'noUpstream',
							gitCommand: { repoPath: repoPath, args: ['pull', '--ff-only', branch.name] },
						});
					}

					// A `pull` fetch writes `<upstream>:<branch>`, moving the local branch too — same
					// hooks `fetch()` fires for a pull fetch with a branch reference.
					announce = () => {
						this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'tags');
						this.context.hooks?.repository?.onChanged?.(repoPath, ['heads', 'remotes']);
					};
					try {
						await this.fetchCore(
							repoPath,
							{
								branch: branchName,
								remote: remoteName,
								upstream: upstream,
								pull: true,
								updateHeadOk: false,
							},
							runOptions,
						);
					} catch (ex) {
						if (FetchError.is(ex, 'noFastForward')) {
							throw new PullError(
								{ reason: 'noFastForward', gitCommand: ex.details.gitCommand },
								ex.original,
							);
						}
						throw ex;
					}
				} else {
					// Branch is not checked out anywhere — can only fetch (no working tree to merge into)
					await this.fetch(repoPath, { branch: branch }, runOptions);
				}
				return;
			}

			announce = () => this.announcePull(repoPath);
			this.context.hooks?.operations?.onRebaseCapableOperation?.(repoPath, 'pull', 'started');
			try {
				await this.pullCore(
					repoPath,
					{
						fastForward: options?.fastForward,
						rebase: options?.rebase,
						tags: options?.tags,
						source: options?.source,
					},
					runOptions,
				);
				fetched = { repoPath: repoPath, remotes: 'default' };
			} finally {
				this.context.hooks?.operations?.onRebaseCapableOperation?.(repoPath, 'pull', 'ended');
			}
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		} finally {
			announce?.();
			if (fetched != null) {
				void this.followRemoteHeads(fetched.repoPath, fetched.remotes);
			}
		}
	}

	private announcePull(repoPath: string): void {
		this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status', 'tags');
		this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads', 'remotes', 'index']);
	}

	private async pullCore(
		repoPath: string,
		options: { fastForward?: 'only'; rebase?: boolean; tags?: boolean; source?: unknown },
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const params = ['pull'];

		if (options.tags) {
			params.push('--tags');
		}

		if (options.rebase) {
			params.push('-r');
		}

		if (options.fastForward === 'only') {
			params.push('--ff-only');
		}

		try {
			await this.git.run({ cwd: repoPath, configs: gitConfigsPull, errors: 'throw', ...runOptions }, ...params);
		} catch (ex) {
			if (isRunHookFailure(ex)) throw ex;

			await this.throwIfSigningError(repoPath, params, ex, options.source);
			throw getGitCommandError(
				'pull',
				ex,
				reason =>
					new PullError({ reason: reason ?? 'other', gitCommand: { repoPath: repoPath, args: params } }, ex),
			);
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async push(
		repoPath: string,
		options?: { reference?: GitReference; force?: boolean; publish?: { remote: string } },
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const scope = getScopedLogger();

		let branchName: string;
		let remoteName: string | undefined;
		let upstreamName: string | undefined;
		// Whether the push itself writes `branch.<n>.remote/merge` (`-u`): only when it establishes tracking,
		// never to rewrite what a branch with a live upstream already has
		let trackUpstream = options?.publish != null;
		let setUpstream:
			| {
					branch: string;
					remote: string;
					remoteBranch: string;
			  }
			| undefined;

		if (isBranchReference(options?.reference)) {
			const resolved = await resolveBranchRemote(
				this.provider,
				repoPath,
				options.reference,
				runOptions?.cancellation,
			);
			if (options.publish != null) {
				branchName = options.reference.name;
				remoteName = options.publish.remote;
			} else {
				branchName = resolved.name;
				remoteName = resolved.remote;
			}
			// A local upstream names a branch in this repository, never a branch on the remote being published to
			upstreamName = options.publish != null && resolved.local ? undefined : resolved.upstream;
			trackUpstream ||= options.reference.upstream?.missing === true;

			// Without a remote, a bare `git push` would follow `push.default` somewhere the caller didn't pick
			if (options.publish == null && remoteName == null) {
				throw new PushError({ reason: 'noUpstream', branch: options.reference.name });
			}
		} else {
			const branch = await this.provider.branches.getBranch(repoPath);
			if (branch == null) return;

			const resolved = await resolveBranchRemote(this.provider, repoPath, branch, runOptions?.cancellation);
			if (options?.reference != null) {
				// Onto the upstream's remote-side name, which a custom fetch refspec or a renamed upstream can make differ
				branchName = `${options.reference.ref}:${
					options?.publish != null ? `refs/heads/${resolved.name}` : (resolved.upstream ?? resolved.name)
				}`;
			} else {
				const tracking = options?.publish == null ? resolved.upstream : undefined;
				branchName =
					tracking != null && tracking !== resolved.name ? `${branch.name}:${tracking}` : branch.name;
			}
			remoteName = resolved.remote ?? options?.publish?.remote;
			if (options?.publish == null && remoteName == null) {
				throw new PushError({ reason: 'noUpstream', branch: branch.name });
			}

			upstreamName = options?.reference == null && options?.publish != null ? branch.name : undefined;

			// Git can't setup upstream tracking when publishing a new branch to a specific commit, so we'll need to do it after the push
			if (options?.publish?.remote != null && options?.reference != null) {
				setUpstream = {
					branch: resolved.name,
					remote: remoteName!,
					remoteBranch: resolved.name,
				};
			}
		}

		let forceOpts: PushForceOptions | undefined;
		if (options?.force) {
			// Honor the host's force-push preferences (e.g. VS Code's `git.useForcePushWithLease` /
			// `git.useForcePushIfIncludes`); fall back to the safer `--force-with-lease` behavior.
			const useForceWithLease = this.context.config?.push?.useForceWithLease ?? true;
			forceOpts = useForceWithLease
				? { withLease: true, ifIncludes: this.context.config?.push?.useForceIfIncludes ?? true }
				: { withLease: false };
		}

		try {
			await this.pushCore(
				repoPath,
				{
					branch: branchName,
					remote: remoteName,
					upstream: upstreamName,
					force: forceOpts,
					setUpstream: trackUpstream,
				},
				runOptions,
			);

			// Since Git can't setup upstream tracking when publishing a new branch to a specific commit, do it now.
			// Soft-fail: the push already succeeded, so don't let a local upstream-tracking failure (cancellation
			// arriving mid-spawn, transient git error) suppress the post-push hook fan-out below.
			if (setUpstream != null) {
				try {
					await this.git.run(
						{ cwd: repoPath, ...runOptions },
						'branch',
						'--set-upstream-to',
						`${setUpstream.remote}/${setUpstream.remoteBranch}`,
						setUpstream.branch,
					);
				} catch (ex) {
					scope?.error(ex, 'Unable to set upstream tracking after publish');
				}
			}
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		} finally {
			// A rejected push may have updated some of its remote-tracking refs before it failed
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			const changes: RepositoryChange[] = [];
			if (trackUpstream || setUpstream != null) {
				changes.push('config');
			}
			if (options?.publish != null) {
				changes.push('heads');
			}
			changes.push('remotes');
			this.context.hooks?.repository?.onChanged?.(repoPath, changes);
		}
	}

	private async pushCore(
		repoPath: string,
		options: {
			branch?: string;
			force?: PushForceOptions;
			setUpstream?: boolean;
			remote?: string;
			upstream?: string;
			delete?: { remote: string; branch: string };
		},
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const params = ['push'];

		if (options.force != null) {
			if (options.force.withLease) {
				params.push('--force-with-lease');
				if (options.force.ifIncludes) {
					if (await this.git.supports('git:push:force-if-includes')) {
						params.push('--force-if-includes');
					}
				}
			} else {
				params.push('--force');
			}
		}

		// `push` refuses a branch without a remote before reaching here, as this would drop the branch
		if (options.branch && options.remote) {
			if (options.upstream) {
				if (options.setUpstream) {
					params.push('-u');
				}
				params.push(options.remote, `${options.branch}:${options.upstream}`);
			} else if (options.setUpstream) {
				params.push('--set-upstream', options.remote, options.branch);
			} else {
				params.push(options.remote, options.branch);
			}
		} else if (options.remote) {
			params.push(options.remote);
		} else if (options.delete) {
			params.push(options.delete.remote, `:${options.delete.branch}`);
		}

		try {
			await this.git.run({ cwd: repoPath, errors: 'throw', ...runOptions }, ...params);
		} catch (ex) {
			if (isRunHookFailure(ex)) throw ex;

			const error = getGitCommandError(
				'push',
				ex,
				reason =>
					new PushError(
						{
							reason: reason,
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					),
			);

			if (options?.force?.withLease && error.details.reason === 'rejected') {
				if (ex.stderr && /! \[rejected\].*\(stale info\)/m.test(ex.stderr)) {
					throw new PushError(
						{
							reason: 'rejectedWithLease',
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					);
				}
				if (
					options.force.ifIncludes &&
					ex.stderr &&
					/! \[rejected\].*\(remote ref updated since checkout\)/m.test(ex.stderr)
				) {
					throw new PushError(
						{
							reason: 'rejectedWithLeaseIfIncludes',
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					);
				}
				if (ex.stderr && GitErrors.pushRejectedRefDoesNotExists.test(ex.stderr)) {
					throw new PushError(
						{
							reason: 'rejectedRefDoesNotExist',
							branch: options?.branch || options?.delete?.branch,
							remote: options?.remote || options?.delete?.remote,
							gitCommand: { repoPath: repoPath, args: params },
						},
						ex,
					);
				}
			}
			throw error;
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async rebase(
		repoPath: string,
		upstream: string,
		options?: {
			autoStash?: boolean;
			branch?: string;
			editor?: string;
			interactive?: boolean;
			programmaticEditor?: boolean;
			autosquash?: boolean;
			messageEditor?: string;
			onto?: string;
			updateRefs?: boolean;
			source?: unknown;
		},
		runOptions?: GitOperationRunOptions,
	): Promise<GitOperationResult> {
		const scope = getScopedLogger();

		const args = ['rebase'];
		const configs: string[] = [];

		if (options?.autoStash !== false) {
			args.push('--autostash');
		}

		if (options?.interactive) {
			args.push('--interactive');

			if (options.editor) {
				configs.push('-c', `sequence.editor=${options.editor}`);
			}

			// A script-based sequence editor rewrites the todo by command word + SHA, so git must emit a
			// plain, natural-order todo regardless of the user's rebase config: `rebase.autosquash` would
			// reorder commits and rewrite `pick`→`fixup`, and `rebase.abbreviateCommands` would emit `p`.
			if (options.programmaticEditor) {
				configs.push('-c', 'rebase.autosquash=false', '-c', 'rebase.abbreviateCommands=false');
			}
		}

		if (options?.autosquash != null) {
			if (options.autosquash && options.programmaticEditor) {
				throw new Error(l10n.t('rebase: autosquash cannot be combined with programmaticEditor'));
			}

			// `--no-autosquash` is passed explicitly when `false` — omitting the flag would let a
			// `rebase.autosquash=true` git config fold fixups anyway.
			args.push(options.autosquash ? '--autosquash' : '--no-autosquash');
		}

		// Drive per-commit message editing (the combined message a `squash` produces, or a `reword`).
		// `GIT_EDITOR` (not `core.editor`) is what git's interactive-rebase backend honors for the `reword`
		// amend step, so set it on the environment; also set `core.editor` config as a fallback.
		let env = runOptions?.env;
		if (options?.messageEditor) {
			configs.push('-c', `core.editor=${options.messageEditor}`);
			env = { ...env, GIT_EDITOR: options.messageEditor };
		}

		if (options?.updateRefs === true) {
			args.push('--update-refs');
		} else if (options?.updateRefs === false) {
			args.push('--no-update-refs');
		}

		if (options?.onto) {
			args.push('--onto', options.onto);
		}

		args.push(upstream);

		if (options?.branch) {
			args.push(options.branch);
		}

		// Fired before the process runs — `git rebase` exits 0 when stopping at `edit`/`break`,
		// so the result can't be used to detect that a rebase started
		this.context.hooks?.operations?.onRebaseCapableOperation?.(repoPath, 'rebase', 'started');
		try {
			try {
				await this.git.run(
					// Avoid a timeout since rebases can take a long time (set to 0 to disable)
					{ cwd: repoPath, errors: 'throw', configs: configs, timeout: 0, ...runOptions, env: env },
					...args,
				);
			} finally {
				this.announceHeadChanged(repoPath, undefined, undefined, true);
			}
			return { conflicted: false };
		} catch (ex) {
			scope?.error(ex);
			if (isRunHookFailure(ex)) throw ex;

			await this.throwIfSigningError(repoPath, args, ex, options?.source);
			const mapped = getGitCommandError(
				'rebase',
				ex,
				reason =>
					new RebaseError(
						{
							reason: reason ?? 'other',
							upstream: upstream,
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex as Error,
					),
			);
			if (RebaseError.is(mapped, 'conflicts')) {
				return await this.createConflictResult(repoPath, 'rebase');
			}
			throw mapped;
		} finally {
			// The command exited (success, pause, or failure) — any rebase it left behind is on disk now
			this.context.hooks?.operations?.onRebaseCapableOperation?.(repoPath, 'rebase', 'ended');
		}
	}

	@debug()
	async reset(
		repoPath: string,
		rev: string,
		options?: { mode?: 'hard' | 'keep' | 'merge' | 'mixed' | 'soft' },
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const scope = getScopedLogger();

		try {
			await this.runMovingHeadBranch(repoPath, () => this.resetCore(repoPath, rev, options?.mode, runOptions));
		} catch (ex) {
			scope?.error(ex);
			throw ex;
		}
	}

	private async resetCore(
		repoPath: string,
		rev: string,
		mode?: 'hard' | 'keep' | 'merge' | 'mixed' | 'soft',
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const params = ['reset', '-q'];
		if (mode) {
			params.push(`--${mode}`);
		}
		params.push(rev, '--');

		try {
			await this.git.run({ cwd: repoPath, errors: 'throw', ...runOptions }, ...params);
		} catch (ex) {
			if (isRunHookFailure(ex)) throw ex;

			throw getGitCommandError(
				'reset',
				ex,
				reason =>
					new ResetError({ reason: reason ?? 'other', gitCommand: { repoPath: repoPath, args: params } }, ex),
			);
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async restore(
		repoPath: string,
		path: string | string[],
		options?: { ref?: string; side?: 'ours' | 'theirs' },
		runOptions?: GitOperationRunOptions,
	): Promise<void> {
		const paths = Array.isArray(path) ? path : [path];
		if (!paths.length) return;

		const scope = getScopedLogger();
		const normalized = paths.map(p => splitPath(p, repoPath, true)[0]);

		// `side` and `ref` are mutually exclusive in git (--ours/--theirs apply during conflict
		// resolution and take no source ref); side takes precedence if both are somehow supplied.
		// Use a truthy check on `ref` so an empty string falls through to index-restore rather than
		// producing a malformed `git checkout '' -- …`. Implemented via `checkout` rather than
		// `git restore` for compatibility with the minimum supported git (2.7.2); `git restore`
		// only landed in 2.23.
		const selector = options?.side != null ? `--${options.side}` : options?.ref || undefined;
		const prefix = selector != null ? ['checkout', selector, '--'] : ['checkout', '--'];

		let ran = false;
		try {
			if (await this.git.supports('git:checkout:pathspec-from-file')) {
				// Git ≥ 2.26: stream all pathspecs via stdin (NUL-separated) in a single invocation —
				// no CLI-length limit (so no batching), and robust for paths with spaces/newlines.
				// Pathspecs come from the file rather than argv, so `--` isn't used.
				const args = ['checkout'];
				if (selector != null) {
					args.push(selector);
				}
				args.push('--pathspec-from-file=-', '--pathspec-file-nul');
				ran = true;
				await this.git.run(
					{ cwd: repoPath, errors: 'throw', ...runOptions, stdin: normalized.join('\0') },
					...args,
				);
			} else {
				// Older git: pass pathspecs as args, one git invocation per chunk (collapsing N
				// path-mode checkouts into ⌈N / chunk⌉ spawns). Reserve the command prefix length and
				// a per-arg overhead (separator + possible quoting) so the assembled command line
				// can't exceed the OS limit even with many short paths.
				const perArgOverhead = 3;
				const prefixLength = prefix.reduce((sum, arg) => sum + arg.length + perArgOverhead, 0);
				for (const batch of chunkByStringLength(normalized, maxGitCliLength - prefixLength, perArgOverhead)) {
					ran = true;
					await this.git.run({ cwd: repoPath, errors: 'throw', ...runOptions }, ...prefix, ...batch);
				}
			}
		} catch (ex) {
			scope?.error(ex);
			if (isRunHookFailure(ex)) throw ex;

			throw getGitCommandError(
				'checkout',
				ex,
				reason =>
					new CheckoutError(
						{
							reason: reason ?? 'other',
							ref: options?.side ?? options?.ref,
							gitCommand: { repoPath: repoPath, args: [...prefix, ...normalized] },
						},
						ex,
					),
			);
		} finally {
			if (ran) {
				this.context.hooks?.cache?.onReset?.(repoPath, 'status');
				this.context.hooks?.repository?.onChanged?.(repoPath, ['index']);
			}
		}
	}

	@sequentialize({ getQueueKey: rp => rp })
	@debug()
	async revert(
		repoPath: string,
		refs: string[],
		options?: { editMessage?: boolean; source?: unknown },
		runOptions?: GitOperationRunOptions,
	): Promise<GitOperationResult> {
		const scope = getScopedLogger();

		const args = ['revert'];

		if (options?.editMessage === true) {
			args.push('--edit');
		} else if (options?.editMessage === false) {
			args.push('--no-edit');
		}

		args.push(...refs);

		try {
			await this.runMovingHeadBranch(repoPath, () =>
				this.git.run(
					// Avoid a timeout since reverts can take a long time (set to 0 to disable)
					{ cwd: repoPath, errors: 'throw', timeout: 0, ...runOptions },
					...args,
				),
			);
			return { conflicted: false };
		} catch (ex) {
			scope?.error(ex);
			if (isRunHookFailure(ex)) throw ex;

			await this.throwIfSigningError(repoPath, args, ex, options?.source);

			const mapped = getGitCommandError(
				'revert',
				ex,
				reason =>
					new RevertError(
						{ reason: reason ?? 'other', refs: refs, gitCommand: { repoPath: repoPath, args: args } },
						ex as Error,
					),
			);
			if (RevertError.is(mapped, 'conflicts')) {
				return this.createConflictResult(repoPath, 'revert');
			}
			throw mapped;
		}
	}

	/**
	 * Classifies `ex` as a signing failure; if so, fires the `commits.onSigningFailed`
	 * hook and throws a typed {@link SigningError}. Callers should invoke this first
	 * in their catch blocks, before falling through to command-specific error mapping
	 * via {@link getGitCommandError}.
	 *
	 * `SigningFormat` is read opportunistically from `config.getSigningConfig`, with
	 * {@link inferSigningFormatFromError} as a stderr-based fallback and `'gpg'` as
	 * the final default.
	 */
	private async throwIfSigningError(
		repoPath: string,
		args: readonly (string | undefined)[],
		ex: unknown,
		source?: unknown,
	): Promise<void> {
		const reason = classifySigningError(ex);
		if (reason == null) return;

		let format: SigningFormat | undefined;
		try {
			format = (await this.provider.config.getSigningConfig?.(repoPath))?.format;
		} catch {
			// Fall through — config read failed; use stderr-inferred format or gpg default
		}
		format ??= inferSigningFormatFromError(ex) ?? 'gpg';

		this.context.hooks?.commits?.onSigningFailed?.(reason, format, source);
		throw new SigningError(
			{ reason: reason, gitCommand: { repoPath: repoPath, args: args } },
			ex instanceof Error ? ex : undefined,
		);
	}

	/**
	 * Called once git has run, success or not — a rejected write can still have moved HEAD or left state behind.
	 * `moved` is the one branch the write could have moved, when it knows it, or `'detached'` when it moved a detached
	 * HEAD and so no branch; `wroteTracking` says it wrote that branch's tracking, to its own config section.
	 * `rewroteHead` says it rewrote the HEAD file (a checkout or rebase), as a detached HEAD's move always does: every other
	 * worktree's watcher reports that as `worktreeHead`, so the kind is announced for them to take the report for the
	 * write's own. A move of HEAD's branch alone (a commit) leaves the file be, and is announced without it.
	 */
	private announceHeadChanged(
		repoPath: string,
		moved?: HeadState,
		wroteTracking?: boolean,
		rewroteHead?: boolean,
	): void {
		if (moved === 'detached') {
			// The worktree list carries this worktree's HEAD, which `heads` would otherwise have reset
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status', 'worktrees');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'index', 'worktrees', 'worktreeHead']);
			return;
		}

		this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status');

		const changes: RepositoryChange[] = wroteTracking
			? ['config', 'head', 'heads', 'index']
			: ['head', 'heads', 'index'];
		if (rewroteHead) {
			changes.push('worktrees', 'worktreeHead');
		}
		if (moved == null) {
			this.context.hooks?.repository?.onChanged?.(repoPath, changes);
		} else if (wroteTracking) {
			this.context.hooks?.repository?.onChanged?.(repoPath, changes, [moved.branch], {
				configConfinedToRefs: true,
			});
		} else {
			this.context.hooks?.repository?.onChanged?.(repoPath, changes, [moved.branch]);
		}
	}

	/**
	 * Runs a write that moves only the branch HEAD is on (or no branch, on a detached HEAD), then announces it, success
	 * or not. HEAD is read on both sides of the run: a hook or an outside `git switch` that moves it meanwhile leaves the
	 * moved branch unknown, so then none is named.
	 */
	private async runMovingHeadBranch<T>(repoPath: string, write: () => Promise<T>): Promise<T> {
		const before = await readHeadState(repoPath, this.context.fs, this.cache);
		try {
			return await write();
		} finally {
			this.announceHeadChanged(
				repoPath,
				getMovedHead(before, await readHeadState(repoPath, this.context.fs, this.cache)),
			);
		}
	}

	/** The caller has already announced the change — the conflict is what the failed run left behind */
	private async createConflictResult(repoPath: string, command: GitConflictCommand): Promise<GitOperationResult> {
		let conflicts: GitConflictFile[] | undefined;
		try {
			conflicts = await this.provider.status.getConflictingFiles(repoPath);
		} catch (ex) {
			// Don't let a secondary status-read failure mask the original conflict signal
			Logger.warn(`Unable to read conflicting files after ${command}: ${ex}`);
		}
		this.context.hooks?.operations?.onConflicted?.(command, conflicts);
		return { conflicted: true, conflicts: conflicts };
	}
}

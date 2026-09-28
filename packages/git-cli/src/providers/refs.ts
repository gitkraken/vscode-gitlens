import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { ReferenceUpdateError } from '@gitlens/git/errors.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitReference, GitRefTip, RefRecord } from '@gitlens/git/models/reference.js';
import type { GitReflogEntry } from '@gitlens/git/models/reflog.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { GitTag } from '@gitlens/git/models/tag.js';
import type { GitRefsSubProvider } from '@gitlens/git/providers/refs.js';
import type { GitCommandPriority } from '@gitlens/git/run.types.js';
import { isRemoteHEAD } from '@gitlens/git/utils/branch.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { isSha, isShaWithOptionalRevisionSuffix, isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import { compareRefTips } from '@gitlens/git/utils/sorting.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { iterateAsyncByDelimiter } from '@gitlens/utils/string.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { Git, GitError } from '../exec/git.js';
import { getGitCommandError, gitConfigsBranch, gitConfigsLog } from '../exec/git.js';
import { getReflogEntryParser } from '../parsers/reflogParser.js';
import { getRefParser } from '../parsers/refParser.js';

export class RefsGitSubProvider implements GitRefsSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async checkIfCouldBeValidBranchOrTagName(repoPath: string, ref: string): Promise<boolean> {
		try {
			const result = await this.git.run({ cwd: repoPath, errors: 'throw' }, 'check-ref-format', '--branch', ref);
			return Boolean(result.stdout.trim());
		} catch {
			return false;
		}
	}

	/**
	 * Raw `git for-each-ref` records covering branches, remotes, tags, and replace-refs in a single
	 * pass. CLI-internal — siblings call via `this.provider.refs.getRefs(...)`. The `RefRecord` shape
	 * is `for-each-ref`-specific and intentionally absent from the public `GitRefsSubProvider`
	 * interface.
	 */
	@debug()
	async getRefs(repoPath: string, cancellation?: AbortSignal, options?: { force?: boolean }): Promise<RefRecord[]> {
		if (!repoPath) return [];

		const scope = getScopedLogger();

		// Forces a fresh enumeration: evicts the shared cache entry (and the derived `refTips` projection,
		// which would otherwise still answer from the old records) so the factory below re-runs and
		// repopulates both from one spawn. Deliberately `delete`, not `invalidate` — soft-invalidation
		// leaves an in-flight entry rideable, so a caller needing a point-in-time read (the graph's tip
		// gate) could join an enumeration that started before the change it's trying to detect. Evicting
		// is safe mid-flight: the in-flight factory's settle is ownership-guarded and won't evict the
		// successor installed here.
		if (options?.force) {
			const commonPath = this.cache.getCommonPath(repoPath);
			this.cache.refs.delete(commonPath);
			this.cache.refTips.delete(commonPath);
		}

		return this.cache.getRefs(
			repoPath,
			async (commonPath, cacheable, signal) => {
				try {
					const supported = await this.git.supported('git:for-each-ref');
					const parser = getRefParser(supported);
					const result = await this.git.run(
						{ cwd: commonPath, cancellation: signal, configs: gitConfigsBranch, errors: 'ignore' },
						'for-each-ref',
						...parser.arguments,
						'refs/heads/',
						'refs/remotes/',
						'refs/tags/',
						// `git replace`/grafts — not surfaced to branch/tag/refTip consumers (filtered by
						// refname prefix), but needed by the graph's replace-ref change gate (graph.ts).
						'refs/replace/',
					);
					// Under `errors: 'ignore'` a cancelled run RESOLVES empty rather than throwing, so the
					// catch below never sees it and an empty enumeration would be cached as a real answer —
					// permanently, since this map has no TTL. Same guard `git.run`'s own caching path uses.
					// The graph's tip gate calls this with `force: true` and supersedes itself freely, so it
					// is routinely the sole registrant on the aggregate whose abort kills the spawn.
					// Covers a FAILED enumeration too, not just a cancelled one: a transient `for-each-ref`
					// failure (a lingering `index.lock`, EMFILE, the git dir briefly unavailable) also
					// resolves empty, and caching that `[]` would blank every branch, tag and ref-tip
					// consumer for the rest of the session. A genuinely ref-less repo still exits cleanly
					// with empty stdout, so it caches as before.
					if (result.completion.status !== 'exited' || result.exitCode !== 0 || signal?.aborted) {
						cacheable?.invalidate();
						return [];
					}
					if (!result?.stdout) return [];

					using sw = maybeStopWatch(scope, { log: { onlyExit: true, level: 'debug' } });

					const records = [...parser.parse(result.stdout)];

					sw?.stop({ suffix: ` parsed ${records.length} ref records` });

					return records;
				} catch (ex) {
					cacheable?.invalidate();
					if (isCancellationError(ex)) throw ex;

					scope?.error(ex);
					return [];
				}
			},
			cancellation,
		);
	}

	@debug()
	async getRefTips(
		repoPath: string,
		options?: { include?: ReadonlyArray<'heads' | 'remotes' | 'tags'> },
		cancellation?: AbortSignal,
	): Promise<GitRefTip[]> {
		if (!repoPath) return [];

		const scope = getScopedLogger();

		// Cache always holds the full set; subset filtering is applied on read so callers asking
		// for different subsets share one cache entry.
		const all = await this.cache.getRefTips(
			repoPath,
			async (_commonPath, _cacheable, signal) => {
				const records = await this.getRefs(repoPath, signal);

				using sw = maybeStopWatch(scope, { log: { onlyExit: true, level: 'debug' } });

				const tips: GitRefTip[] = [];
				for (const record of records) {
					const fullName = record.name;
					if (!fullName) continue;
					// Skip refs/remotes/<remote>/HEAD — symbolic, not a real tip.
					if (isRemoteHEAD(fullName)) continue;

					let type: GitRefTip['type'];
					let name: string;
					if (fullName.startsWith('refs/heads/')) {
						type = 'branch';
						name = fullName.substring(11);
					} else if (fullName.startsWith('refs/remotes/')) {
						type = 'remote';
						name = fullName.substring(13);
					} else if (fullName.startsWith('refs/tags/')) {
						type = 'tag';
						name = fullName.substring(10);
					} else {
						continue;
					}

					// Annotated tags: peeledObjectname is the commit SHA; objectname is the tag-object SHA.
					// Lightweight tags / branches: peeledObjectname is empty; objectname is already the commit SHA.
					const sha = record.peeledObjectname || record.objectname;

					tips.push({ type: type, name: name, fullName: fullName, sha: sha });
				}

				sw?.stop({ suffix: ` projected ${tips.length} ref tips` });

				return tips;
			},
			cancellation,
		);

		const include = options?.include;
		if (include == null || (include.includes('heads') && include.includes('remotes') && include.includes('tags'))) {
			return all;
		}

		return all.filter(r => {
			switch (r.type) {
				case 'branch':
					return include.includes('heads');
				case 'remote':
					return include.includes('remotes');
				case 'tag':
					return include.includes('tags');
			}
		});
	}

	@debug()
	async getRefsContainingShas(
		repoPath: string,
		shas: ReadonlySet<string> | readonly string[],
		oldestSha: string,
		options?: { include?: ReadonlyArray<'heads' | 'remotes' | 'tags'> },
		cancellation?: AbortSignal,
	): Promise<Map<string, GitRefTip[]>> {
		const targetShas = shas instanceof Set ? shas : new Set(shas);
		if (!targetShas.size || !oldestSha) return new Map();

		const scope = getScopedLogger();

		const tips = await this.getRefTips(repoPath, options, cancellation);
		if (cancellation?.aborted) throw new CancellationError();
		if (!tips.length) return new Map();

		// Index tips by full ref name (for projection back to GitRefTip later) and seed the
		// propagation map by tip SHA. Multiple refs sharing a tip (e.g. local + remote-tracking)
		// collapse into one Set entry whose union covers all of them.
		const tipsByName = new Map<string, GitRefTip>();
		const propMap = new Map<string, Set<string>>();
		for (const tip of tips) {
			tipsByName.set(tip.fullName, tip);
			let names = propMap.get(tip.sha);
			if (names == null) {
				names = new Set();
				propMap.set(tip.sha, names);
			}
			names.add(tip.fullName);
		}

		using sw = maybeStopWatch(scope, { log: { onlyExit: true, level: 'debug' } });

		// `^<oldestSha>^@` excludes the parents of <oldestSha> and everything older. When <oldestSha>
		// is a root commit, `^@` resolves to nothing and the walk is naturally unbounded — git
		// doesn't error in that case (no negative refs to apply).
		const stream = this.git.stream(
			{ cwd: repoPath, cancellation: cancellation, configs: gitConfigsBranch },
			'rev-list',
			'--topo-order',
			'--parents',
			'--all',
			`^${oldestSha}^@`,
		);
		using _streamDisposer = createDisposable(() => void stream.return?.(undefined));

		// Topological propagation: `--topo-order` emits all children of X before X's own line, so
		// by the time we process "X P1 P2..." every child has already merged its set into X. We
		// then forward X's accumulated set to each parent — one-pass and correct.
		try {
			for await (const line of iterateAsyncByDelimiter(stream, '\n')) {
				if (cancellation?.aborted) throw new CancellationError();
				if (!line) continue;

				const firstSpace = line.indexOf(' ');
				const sha = firstSpace === -1 ? line : line.substring(0, firstSpace);
				if (!sha) continue;

				const refs = propMap.get(sha);
				if (!refs?.size) continue;

				if (firstSpace === -1) continue; // No parents — nothing to propagate to

				// Walk parent SHAs by index without splitting the whole line.
				let start = firstSpace + 1;
				while (start < line.length) {
					const next = line.indexOf(' ', start);
					const parentSha = next === -1 ? line.substring(start) : line.substring(start, next);
					if (parentSha) {
						let parentRefs = propMap.get(parentSha);
						if (parentRefs == null) {
							parentRefs = new Set(refs);
							propMap.set(parentSha, parentRefs);
						} else {
							for (const name of refs) {
								parentRefs.add(name);
							}
						}
					}
					if (next === -1) break;

					start = next + 1;
				}
			}
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			scope?.error(ex);
			return new Map();
		}

		// Project to targets, materialize GitRefTip[], sort.
		const result = new Map<string, GitRefTip[]>();
		for (const sha of targetShas) {
			const names = propMap.get(sha);
			if (!names?.size) continue;

			const refs: GitRefTip[] = [];
			for (const name of names) {
				const tip = tipsByName.get(name);
				if (tip != null) {
					refs.push(tip);
				}
			}
			refs.sort(compareRefTips);
			result.set(sha, refs);
		}

		sw?.stop({ suffix: ` resolved ${result.size}/${targetShas.size} target shas` });

		return result;
	}

	@debug()
	async getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		options?: { forkPoint?: boolean; priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		const scope = getScopedLogger();

		try {
			const result = await this.git.run(
				{
					cwd: repoPath,
					cancellation: cancellation,
					// Why: ref1/ref2 are usually branch names; correctness relies on the gitResults cache being
					// cleared on 'heads'/'remotes' events when refs move. Web (no fs watcher) sees up to
					// `accessTTL` of staleness — acceptable trade-off for the perf win on graph/branch reads.
					caching: { cache: this.cache.gitResults, options: { accessTTL: 5 * 60 * 1000 } },
					...(options?.priority != null ? { priority: options.priority } : undefined),
				},
				'merge-base',
				options?.forkPoint ? '--fork-point' : undefined,
				ref1,
				ref2,
			);
			if (!result.stdout) return undefined;

			return result.stdout.split('\n')[0].trim() || undefined;
		} catch (ex) {
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;

			return undefined;
		}
	}

	@debug()
	async getReflogEntries(
		repoPath: string,
		ref: string,
		options?: { grep?: string; priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<GitReflogEntry[]> {
		// `show` so a branch named `delete`, `expire` or `exists` isn't read as that subcommand, and the trailing
		// `--` so one named like a tracked file isn't rejected as ambiguous
		const parser = getReflogEntryParser();
		const args = ['reflog', 'show', ...parser.arguments];
		if (options?.grep) {
			args.push(`--grep-reflog=${options.grep}`);
		}
		args.push(ref, '--');

		const result = await this.git.run(
			{
				cwd: repoPath,
				errors: 'throw',
				cancellation: cancellation,
				// A user's `log.showSignature` would print gpg output into the records
				configs: gitConfigsLog,
				...(options?.priority != null ? { priority: options.priority } : undefined),
			},
			...args,
		);

		const entries: GitReflogEntry[] = [];
		for (const entry of parser.parse(result.stdout)) {
			entries.push({ sha: entry.sha, message: entry.subject });
		}
		return entries;
	}

	@debug()
	async getReference(
		repoPath: string,
		ref: string,
		options?: { force?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitReference | undefined> {
		if (!ref || ref === deletedOrMissing) return undefined;

		const valid = options?.force
			? await this.validateReference(repoPath, ref, { force: true }, cancellation)
			: await this.isValidReference(repoPath, ref, undefined, cancellation);
		if (!valid) return undefined;

		if (ref !== 'HEAD' && !isShaWithOptionalRevisionSuffix(ref)) {
			const branch = await this.provider.branches.getBranch(
				repoPath,
				ref,
				options?.force ? { force: true } : undefined,
				cancellation,
			);
			if (branch != null) {
				return createReference(branch.ref, repoPath, {
					id: branch.id,
					refType: 'branch',
					name: branch.name,
					remote: branch.remote,
					upstream: branch.upstream,
				});
			}

			// Not forced: a tag that moves is rare enough that `force` is scoped to branches and validation.
			const tag = await this.provider.tags.getTag(repoPath, ref, cancellation);
			if (tag != null) {
				return createReference(tag.ref, repoPath, {
					id: tag.id,
					refType: 'tag',
					name: tag.name,
				});
			}
		}

		return createReference(ref, repoPath, { refType: 'revision' });
	}

	@debug()
	async getSymbolicReferenceName(
		repoPath: string,
		ref: string,
		options?: { priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		const supportsEndOfOptions = await this.git.supports('git:rev-parse:end-of-options');

		const result = await this.git.run(
			{
				cwd: repoPath,
				cancellation: cancellation,
				errors: 'ignore',
				// Why: a fixed ref name's symbolic name is itself stable; only HEAD is mutable, and the
				// gitResults cache is cleared on 'head' events. 60s TTL is the failsafe for watcher
				// latency / web — matches the other "resolve symbolic state" calls in commits.ts.
				caching: { cache: this.cache.gitResults, options: { accessTTL: 60 * 1000 } },
				...(options?.priority != null ? { priority: options.priority } : undefined),
			},
			'rev-parse',
			'--verify',
			'--quiet',
			'--symbolic-full-name',
			'--abbrev-ref',
			supportsEndOfOptions ? '--end-of-options' : undefined,
			ref,
		);
		return result.stdout.trim() || undefined;
	}

	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		},
		cancellation?: AbortSignal,
	): Promise<boolean> {
		if (repoPath == null) return false;

		const [{ values: branches }, { values: tags }] = await Promise.all([
			this.provider.branches.getBranches(
				repoPath,
				{ filter: options?.filter?.branches, sort: false },
				cancellation,
			),
			this.provider.tags.getTags(repoPath, { filter: options?.filter?.tags, sort: false }, cancellation),
		]);

		return branches.length !== 0 || tags.length !== 0;
	}

	@debug()
	async isValidReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		cancellation?: AbortSignal,
	): Promise<boolean> {
		const path = pathOrUri != null ? toFsPath(pathOrUri) : undefined;
		const relativePath = path ? this.provider.getRelativePath(path, repoPath) : undefined;
		return Boolean(
			(await this.validateReference(repoPath, ref, { relativePath: relativePath }, cancellation))?.length,
		);
	}

	@trace()
	async validateReference(
		repoPath: string,
		ref: string,
		options?: { relativePath?: string; force?: boolean },
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		if (!ref) return undefined;
		if (ref === deletedOrMissing || isUncommitted(ref)) return ref;

		const relativePath = options?.relativePath;
		const supportsEndOfOptions = await this.git.supports('git:rev-parse:end-of-options');

		// Why: a SHA-only validation (no path suffix) is effectively immutable — 5-min TTL is safe.
		// Otherwise the resolved SHA can shift on ref move (or working-tree change for path-scoped
		// validation); rely on gitResults being cleared on 'head'/'heads'/'remotes' events, with 60s
		// TTL as the failsafe for watcher latency / web.
		const stable = relativePath == null && isSha(ref);
		const result = await this.git.run(
			{
				cwd: repoPath,
				cancellation: cancellation,
				errors: 'ignore',
				caching: {
					cache: this.cache.gitResults,
					options: { accessTTL: stable ? 5 * 60 * 1000 : 60 * 1000 },
					force: options?.force,
				},
			},
			'rev-parse',
			'--verify',
			supportsEndOfOptions ? '--end-of-options' : undefined,
			relativePath ? `${ref}:./${relativePath}` : `${ref}^{commit}`,
		);
		return result.stdout.trim() || undefined;
	}

	@debug()
	async deleteReference(
		repoPath: string,
		ref: string,
		options?: { expected?: string },
		cancellation?: AbortSignal,
	): Promise<void> {
		const scope = getScopedLogger();

		// `--no-deref`: without it git deletes what a symbolic ref points to rather than the ref itself, so
		// deleting `refs/remotes/origin/HEAD` would take `origin/main` with it
		const args = ['update-ref', '-d', '--no-deref', ref];
		if (options?.expected != null) {
			args.push(options.expected);
		}

		// `HEAD` is either the checked-out branch or, detached, the repository's own HEAD file — neither
		// may be deleted
		if (ref === 'HEAD') {
			throw new ReferenceUpdateError({
				reason: 'checkedOut',
				action: 'delete',
				ref: ref,
				gitCommand: { repoPath: repoPath, args: args },
			});
		}

		// `update-ref -d` has none of `git branch -d`'s guards or cleanup, so a local branch gets them here:
		// deleting one checked out in a worktree would leave that worktree on a branch that no longer exists.
		const branch = ref.startsWith('refs/heads/') ? ref.substring('refs/heads/'.length) : undefined;
		if (branch != null) {
			// Read git's worktree list directly rather than the cached one: that names a worktree's branch
			// only when the separately cached branch list has it, so a worktree or branch made outside core
			// since the last read would slip past this guard.
			const result = await this.git.run(
				{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
				'worktree',
				'list',
				'--porcelain',
			);
			if (result.stdout.split('\n').some(l => l.trim() === `branch ${ref}`)) {
				throw new ReferenceUpdateError({
					reason: 'checkedOut',
					action: 'delete',
					ref: ref,
					gitCommand: { repoPath: repoPath, args: args },
				});
			}
		}

		try {
			// `errors: 'throw'`: the default handler resolves a `GitWarnings` match (e.g. "not a git
			// repository"), which would report a write that never happened as done
			await this.git.run({ cwd: repoPath, cancellation: cancellation, errors: 'throw' }, ...args);
		} catch (ex) {
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;

			throw getGitCommandError(
				'update-ref-delete',
				ex as GitError,
				reason =>
					new ReferenceUpdateError(
						{
							reason: reason,
							action: 'delete',
							ref: ref,
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex as GitError,
					),
			);
		}

		if (branch != null) {
			// What `git branch -d` removes itself (the upstream and other per-branch settings), then GitLens's own
			await this.git.run({ cwd: repoPath, errors: 'ignore' }, 'config', '--remove-section', `branch.${branch}`);
			await this.provider.branches.forgetDeletedBranch(repoPath, branch);
			// A single combined reset/announce rather than this plus `fireReferenceChanged`'s own
			// `'branches'`/`['heads']` — a branch delete only needs one of each.
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'config');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['heads']);
			return;
		}

		this.fireReferenceChanged(repoPath, ref);
	}

	@debug()
	async updateReference(
		repoPath: string,
		ref: string,
		sha: string,
		options?: { expected?: string | 'absent' },
		cancellation?: AbortSignal,
	): Promise<void> {
		const scope = getScopedLogger();

		const args = ['update-ref', ref, sha];
		if (options?.expected != null) {
			// Git's own compare-and-swap old-value argument, which makes the update atomic against a
			// concurrent writer. An EMPTY old value is how git spells "the ref must not exist yet"; the
			// empty string has to reach argv intact, which it does because the executor drops only
			// null/undefined.
			args.push(options.expected === 'absent' ? '' : options.expected);
		}

		try {
			await this.git.run({ cwd: repoPath, cancellation: cancellation, errors: 'throw' }, ...args);
		} catch (ex) {
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;

			throw getGitCommandError(
				'update-ref',
				ex as GitError,
				reason =>
					new ReferenceUpdateError(
						{
							reason: reason,
							action: 'update',
							ref: ref,
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex as GitError,
					),
			);
		}

		this.fireReferenceChanged(repoPath, ref);
	}

	/** Announces a ref mutation to the cache and repository hooks. */
	private fireReferenceChanged(repoPath: string, ref: string): void {
		if (ref === 'HEAD') {
			// `update-ref HEAD` moves whatever HEAD resolves to — the checked-out branch, or a detached HEAD
			// — which also changes what the index and working tree are compared against.
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches', 'status');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['head', 'heads']);
		} else if (ref.startsWith('refs/heads/')) {
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['heads']);
		} else if (ref.startsWith('refs/tags/')) {
			this.context.hooks?.cache?.onReset?.(repoPath, 'tags');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['tags']);
		} else if (ref.startsWith('refs/remotes/')) {
			// Remote-tracking branches are read through the branch and ref-tip caches, which `'branches'`
			// clears; `'remotes'` covers only the configured remotes, which a ref write cannot change.
			this.context.hooks?.cache?.onReset?.(repoPath, 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['remotes']);
		} else if (ref === 'refs/stash') {
			this.context.hooks?.cache?.onReset?.(repoPath, 'stashes');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['stash']);
		}
		// A ref outside those namespaces (a consumer's own bookkeeping under `refs/<tool>/`) is visible to
		// nothing core caches, and announcing it as an unknown change would make a host refresh everything
		// for a write it cannot observe.
	}
}

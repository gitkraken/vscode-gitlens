import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitReference, GitRefTip, RefRecord } from '@gitlens/git/models/reference.js';
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
import type { Git } from '../exec/git.js';
import { gitConfigsBranch } from '../exec/git.js';
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
	 * Raw `git for-each-ref` records covering branches, remotes, and tags in a single pass.
	 * CLI-internal — siblings call via `this.provider.refs.getRefs(...)`. The `RefRecord` shape
	 * is `for-each-ref`-specific and intentionally absent from the public `GitRefsSubProvider`
	 * interface.
	 */
	@debug()
	async getRefs(repoPath: string, cancellation?: AbortSignal): Promise<RefRecord[]> {
		if (!repoPath) return [];

		const scope = getScopedLogger();

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
					);
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
	async getReference(repoPath: string, ref: string, cancellation?: AbortSignal): Promise<GitReference | undefined> {
		if (!ref || ref === deletedOrMissing) return undefined;

		if (!(await this.isValidReference(repoPath, ref, undefined, cancellation))) return undefined;

		if (ref !== 'HEAD' && !isShaWithOptionalRevisionSuffix(ref)) {
			const branch = await this.provider.branches.getBranch(repoPath, ref, cancellation);
			if (branch != null) {
				return createReference(branch.ref, repoPath, {
					id: branch.id,
					refType: 'branch',
					name: branch.name,
					remote: branch.remote,
					upstream: branch.upstream,
				});
			}

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
		return Boolean((await this.validateReference(repoPath, ref, relativePath, cancellation))?.length);
	}

	@trace()
	async validateReference(
		repoPath: string,
		ref: string,
		relativePath?: string,
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		if (!ref) return undefined;
		if (ref === deletedOrMissing || isUncommitted(ref)) return ref;

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
	async updateReference(repoPath: string, ref: string, newRef: string, cancellation?: AbortSignal): Promise<void> {
		const scope = getScopedLogger();

		try {
			await this.git.run({ cwd: repoPath, cancellation: cancellation }, 'update-ref', ref, newRef);
		} catch (ex) {
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;
		}
	}
}

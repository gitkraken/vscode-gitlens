import type { Cache } from '@gitlens/git/cache.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitReference, GitRefTip } from '@gitlens/git/models/reference.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { GitTag } from '@gitlens/git/models/tag.js';
import type { GitRefsSubProvider } from '@gitlens/git/providers/refs.js';
import type { GitCommandPriority } from '@gitlens/git/run.types.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import {
	createRevisionRange,
	isShaWithOptionalRevisionSuffix,
	stripOrigin,
} from '@gitlens/git/utils/revision.utils.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { toTokenInfo } from '../../api/tokenUtils.js';
import type { GitHubGitProviderInternal } from '../githubProvider.js';

// Since negative lookbehind isn't supported in all browsers, this leaves out the negative lookbehind condition `(?<!\.lock)` to ensure the branch name doesn't end with `.lock`
// oxlint-disable-next-line no-control-regex
const validBranchOrTagRegex = /^[^/](?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\x00-\x1F\x7F ~^:?*[\\]+[^./]$/;

export class RefsGitSubProvider implements GitRefsSubProvider {
	constructor(
		private readonly cache: Cache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@debug()
	checkIfCouldBeValidBranchOrTagName(_repoPath: string, ref: string): Promise<boolean> {
		return Promise.resolve(validBranchOrTagRegex.test(ref));
	}

	@debug()
	getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		_options?: { forkPoint?: boolean; priority?: GitCommandPriority },
		_cancellation?: AbortSignal,
	): Promise<string | undefined> {
		if (repoPath == null) return Promise.resolve(undefined);

		const a = stripOrigin(ref1);
		const b = stripOrigin(ref2);
		// `merge-base` is symmetric, so normalize ref order in the cache key to coalesce
		// `(A, B)` and `(B, A)` lookups onto a single entry.
		const [left, right] = a < b ? [a, b] : [b, a];
		const cacheKey = `${left}...${right}`;
		const queryRange = createRevisionRange(a, b, '...');

		return this.cache.mergeBase.getOrCreate(repoPath, cacheKey, async () => {
			const scope = getScopedLogger();

			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			try {
				const result = await github.getComparison(
					toTokenInfo(this.provider.authenticationProviderId, session),
					metadata.repo.owner,
					metadata.repo.name,
					queryRange,
				);
				return result?.merge_base_commit?.sha;
			} catch (ex) {
				scope?.error(ex);
				debugger;
				return undefined;
			}
		});
	}

	@debug()
	async getReference(repoPath: string, ref: string, _cancellation?: AbortSignal): Promise<GitReference | undefined> {
		if (!ref || ref === deletedOrMissing) return undefined;

		if (!(await this.isValidReference(repoPath, ref))) return undefined;

		if (ref !== 'HEAD' && !isShaWithOptionalRevisionSuffix(ref)) {
			const branch = await this.provider.branches.getBranch(repoPath, ref);
			if (branch != null) {
				return createReference(branch.ref, repoPath, {
					id: branch.id,
					refType: 'branch',
					name: branch.name,
					remote: branch.remote,
					upstream: branch.upstream,
				});
			}

			const tag = await this.provider.tags.getTag(repoPath, ref);
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
	getRefTips(
		_repoPath: string,
		_options?: { include?: ReadonlyArray<'heads' | 'remotes' | 'tags'> },
		_cancellation?: AbortSignal,
	): Promise<GitRefTip[]> {
		// Not implemented for GitHub virtual repos — current consumers (timeline slice-by-branch)
		// gate this off via `!repo.virtual`. A future implementation can use GraphQL `refs` /
		// `commit.associatedRefs`.
		return Promise.resolve([]);
	}

	@debug()
	getRefsContainingShas(
		_repoPath: string,
		_shas: ReadonlySet<string> | readonly string[],
		_oldestSha: string,
		_options?: { include?: ReadonlyArray<'heads' | 'remotes' | 'tags'> },
		_cancellation?: AbortSignal,
	): Promise<Map<string, GitRefTip[]>> {
		// See `getRefTips` — gated off for virtual repos until GraphQL `commit.associatedRefs` lands.
		return Promise.resolve(new Map<string, GitRefTip[]>());
	}

	@debug()
	async hasBranchOrTag(
		repoPath: string | undefined,
		options?: { filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean } },
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
	isValidReference(
		_repoPath: string,
		_ref: string,
		_pathOrUri?: string,
		_cancellation?: AbortSignal,
	): Promise<boolean> {
		return Promise.resolve(true);
	}

	@debug()
	validateReference(
		_repoPath: string,
		ref: string,
		_relativePath?: string,
		_cancellation?: AbortSignal,
	): Promise<string | undefined> {
		return Promise.resolve(ref);
	}

	@debug()
	updateReference(_repoPath: string, _ref: string, _newRef: string, _cancellation?: AbortSignal): Promise<void> {
		return Promise.resolve();
	}
}

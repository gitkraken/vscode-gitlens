import type { CancellationToken, Uri } from 'vscode';
import type { Container } from '../../../../../container.js';
import type { GitCache } from '../../../../../git/cache.js';
import type { GitRefsSubProvider } from '../../../../../git/gitProvider.js';
import type { GitBranch } from '../../../../../git/models/branch.js';
import type { GitReference } from '../../../../../git/models/reference.js';
import { deletedOrMissing } from '../../../../../git/models/revision.js';
import type { GitTag } from '../../../../../git/models/tag.js';
import { createReference } from '../../../../../git/utils/reference.utils.js';
import { createRevisionRange, isShaWithOptionalRevisionSuffix } from '../../../../../git/utils/revision.utils.js';
import { debug } from '../../../../../system/decorators/log.js';
import { getScopedLogger } from '../../../../../system/logger.scope.js';
import { toTokenWithInfo } from '../../../authentication/models.js';
import type { GitHubGitProviderInternal } from '../githubGitProvider.js';
import { stripOrigin } from '../githubGitProvider.js';

// Since negative lookbehind isn't supported in all browsers, this leaves out the negative lookbehind condition `(?<!\.lock)` to ensure the branch name doesn't end with `.lock`
// eslint-disable-next-line no-control-regex
const validBranchOrTagRegex = /^[^/](?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\x00-\x1F\x7F ~^:?*[\\]+[^./]$/;

export class RefsGitSubProvider implements GitRefsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@debug()
	checkIfCouldBeValidBranchOrTagName(ref: string, _repoPath?: string): Promise<boolean> {
		return Promise.resolve(validBranchOrTagRegex.test(ref));
	}

	@debug()
	async getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		_options?: { forkPoint?: boolean },
		_cancellation?: CancellationToken,
	): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		const scope = getScopedLogger();

		const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

		try {
			const result = await github.getComparison(
				toTokenWithInfo(this.provider.authenticationProviderId, session),
				metadata.repo.owner,
				metadata.repo.name,
				createRevisionRange(stripOrigin(ref1), stripOrigin(ref2), '...'),
			);
			return result?.merge_base_commit?.sha;
		} catch (ex) {
			scope?.error(ex);
			debugger;
			return undefined;
		}
	}

	@debug()
	async getReference(
		repoPath: string,
		ref: string,
		_cancellation?: CancellationToken,
	): Promise<GitReference | undefined> {
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
	async hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		},
		cancellation?: CancellationToken,
	): Promise<boolean> {
		const [{ values: branches }, { values: tags }] = await Promise.all([
			this.provider.branches.getBranches(
				repoPath,
				{
					filter: options?.filter?.branches,
					sort: false,
				},
				cancellation,
			),
			this.provider.tags.getTags(
				repoPath,
				{
					filter: options?.filter?.tags,
					sort: false,
				},
				cancellation,
			),
		]);

		return branches.length !== 0 || tags.length !== 0;
	}

	@debug()
	isValidReference(
		_repoPath: string,
		_ref: string,
		_pathOrUri?: string | Uri,
		_cancellation?: CancellationToken,
	): Promise<boolean> {
		return Promise.resolve(true);
	}

	@debug()
	updateReference(
		_repoPath: string,
		_ref: string,
		_newRef: string,
		_cancellation?: CancellationToken,
	): Promise<void> {
		return Promise.resolve();
	}
}

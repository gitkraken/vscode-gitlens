import type { Uri } from 'vscode';
import type { Container } from '../../../../../container';
import type { GitCache } from '../../../../../git/cache';
import type { GitRefsSubProvider } from '../../../../../git/gitProvider';
import type { GitBranch } from '../../../../../git/models/branch';
import { deletedOrMissing } from '../../../../../git/models/revision';
import type { GitTag } from '../../../../../git/models/tag';
import { isSha, isShaLike, isUncommitted, isUncommittedParent } from '../../../../../git/utils/revision.utils';
import { log } from '../../../../../system/decorators/log';
import type { GitHubGitProviderInternal } from '../githubGitProvider';
import { stripOrigin } from '../githubGitProvider';

// Since negative lookbehind isn't supported in all browsers, this leaves out the negative lookbehind condition `(?<!\.lock)` to ensure the branch name doesn't end with `.lock`
// eslint-disable-next-line no-control-regex
const validBranchOrTagRegex = /^[^/](?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\x00-\x1F\x7F ~^:?*[\\]+[^./]$/;

export class RefsGitSubProvider implements GitRefsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@log()
	async hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		},
	): Promise<boolean> {
		const [{ values: branches }, { values: tags }] = await Promise.all([
			this.provider.branches.getBranches(repoPath, {
				filter: options?.filter?.branches,
				sort: false,
			}),
			this.provider.tags.getTags(repoPath, {
				filter: options?.filter?.tags,
				sort: false,
			}),
		]);

		return branches.length !== 0 || tags.length !== 0;
	}

	@log()
	async resolveReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		_options?: { force?: boolean; timeout?: number },
	): Promise<string> {
		if (pathOrUri != null && isUncommittedParent(ref)) {
			ref = 'HEAD';
		}

		if (
			!ref ||
			ref === deletedOrMissing ||
			(pathOrUri == null && isSha(ref)) ||
			(pathOrUri != null && isUncommitted(ref))
		) {
			return ref;
		}

		let relativePath;
		if (pathOrUri != null) {
			relativePath = this.provider.getRelativePath(pathOrUri, repoPath);
		} else if (!isShaLike(ref) || ref.endsWith('^3')) {
			// If it doesn't look like a sha at all (e.g. branch name) or is a stash ref (^3) don't try to resolve it
			return ref;
		}

		const context = await this.provider.ensureRepositoryContext(repoPath);
		if (context == null) return ref;

		const { metadata, github, session } = context;

		const resolved = await github.resolveReference(
			session.accessToken,
			metadata.repo.owner,
			metadata.repo.name,
			stripOrigin(ref),
			relativePath,
		);

		if (resolved != null) return resolved;

		return relativePath ? deletedOrMissing : ref;
	}

	@log()
	validateBranchOrTagName(ref: string, _repoPath?: string): Promise<boolean> {
		return Promise.resolve(validBranchOrTagRegex.test(ref));
	}

	@log()
	validateReference(_repoPath: string, _ref: string): Promise<boolean> {
		return Promise.resolve(true);
	}
}

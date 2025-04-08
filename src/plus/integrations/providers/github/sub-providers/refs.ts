import type { Uri } from 'vscode';
import type { Container } from '../../../../../container';
import type { GitCache } from '../../../../../git/cache';
import type { GitRefsSubProvider } from '../../../../../git/gitProvider';
import type { GitBranch } from '../../../../../git/models/branch';
import type { GitReference } from '../../../../../git/models/reference';
import { deletedOrMissing } from '../../../../../git/models/revision';
import type { GitTag } from '../../../../../git/models/tag';
import { createReference } from '../../../../../git/utils/reference.utils';
import {
	createRevisionRange,
	isSha,
	isShaWithOptionalRevisionSuffix,
	isUncommitted,
	isUncommittedWithParentSuffix,
} from '../../../../../git/utils/revision.utils';
import { log } from '../../../../../system/decorators/log';
import { Logger } from '../../../../../system/logger';
import { getLogScope } from '../../../../../system/logger.scope';
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
	checkIfCouldBeValidBranchOrTagName(ref: string, _repoPath?: string): Promise<boolean> {
		return Promise.resolve(validBranchOrTagRegex.test(ref));
	}

	@log()
	async getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		_options?: { forkPoint?: boolean },
	): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

		try {
			const result = await github.getComparison(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				createRevisionRange(stripOrigin(ref1), stripOrigin(ref2), '...'),
			);
			return result?.merge_base_commit?.sha;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getReference(repoPath: string, ref: string): Promise<GitReference | undefined> {
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
	isValidReference(_repoPath: string, _ref: string, _pathOrUri?: string | Uri): Promise<boolean> {
		return Promise.resolve(true);
	}

	@log()
	async resolveReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		_options?: { force?: boolean; timeout?: number },
	): Promise<string> {
		if (pathOrUri != null && isUncommittedWithParentSuffix(ref)) {
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
		} else if (!isShaWithOptionalRevisionSuffix(ref) || ref.endsWith('^3')) {
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
}

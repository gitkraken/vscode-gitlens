import type { Cache } from '@gitlens/git/cache.js';
import type { GitDiffFilter, GitDiffShortStat } from '@gitlens/git/models/diff.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import { GitFileIndexStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitRevisionRange } from '@gitlens/git/models/revision.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type {
	GitDiffSubProvider,
	NextComparisonUrisResult,
	PreviousComparisonUrisResult,
	PreviousRangeComparisonUrisResult,
} from '@gitlens/git/providers/diff.js';
import type { DiffRange, RevisionUri } from '@gitlens/git/providers/types.js';
import { getChangedFilesCount } from '@gitlens/git/utils/commit.utils.js';
import {
	createRevisionRange,
	getRevisionRangeParts,
	isRevisionRange,
	stripOrigin,
} from '@gitlens/git/utils/revision.utils.js';
import { encodeGitLensRevisionUriAuthority } from '@gitlens/git/utils/uriAuthority.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { union } from '@gitlens/utils/iterable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fromUri } from '@gitlens/utils/uri.js';
import { toTokenInfo } from '../../api/tokenUtils.js';
import { fromCommitFileStatus } from '../../models.js';
import type { GitHubGitProviderInternal } from '../githubProvider.js';

const slash = 47;

function createRevisionUri(repoPath: string, relativePath: string, sha: string | undefined): RevisionUri {
	// For virtual repos, the path is the relative path prefixed with /
	let uriPath = relativePath.replace(/\\/g, '/');
	if (uriPath.charCodeAt(0) !== slash) {
		uriPath = `/${uriPath}`;
	}
	return {
		uri: fromUri({
			scheme: 'gitlens',
			authority: encodeGitLensRevisionUriAuthority({ ref: sha, repoPath: repoPath }),
			path: uriPath,
		}),
		path: relativePath,
		sha: sha,
		repoPath: repoPath,
	};
}

export class DiffGitSubProvider implements GitDiffSubProvider {
	constructor(
		private readonly cache: Cache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@debug()
	async getChangedFilesCount(
		repoPath: string,
		to?: string,
		_from?: string,
		_options?: { uris?: (string | Uri)[]; includeUntracked?: boolean },
		_cancellation?: AbortSignal,
	): Promise<GitDiffShortStat | undefined> {
		// TODO@eamodio if there is no ref we can't return anything, until we can get at the change store from RemoteHub
		if (!to) return undefined;

		const commit = await this.provider.commits.getCommit(repoPath, to);
		if (commit?.stats == null) return undefined;

		const { stats } = commit;

		const changedFiles = getChangedFilesCount(stats.files);
		return { additions: stats.additions, deletions: stats.deletions, files: changedFiles };
	}

	@debug()
	async getDiffStatus(
		repoPath: string,
		ref1OrRange: string | GitRevisionRange,
		ref2?: string,
		_options?: {
			filters?: GitDiffFilter[];
			includeUntracked?: boolean;
			path?: string;
			renameLimit?: number;
			similarityThreshold?: number;
		},
	): Promise<GitFile[] | undefined> {
		if (repoPath == null) return undefined;

		const scope = getScopedLogger();

		const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

		let range: GitRevisionRange;
		if (isRevisionRange(ref1OrRange)) {
			range = ref1OrRange;

			if (!isRevisionRange(ref1OrRange, 'qualified')) {
				const parts = getRevisionRangeParts(ref1OrRange);
				range = createRevisionRange(parts?.left || 'HEAD', parts?.right || 'HEAD', parts?.notation ?? '...');
			}
		} else {
			range = createRevisionRange(ref1OrRange || 'HEAD', ref2 || 'HEAD', '...');
		}

		let range2: GitRevisionRange | undefined;
		// GitHub doesn't support the `..` range notation, so we will need to do some extra work
		if (isRevisionRange(range, 'qualified-double-dot')) {
			const parts = getRevisionRangeParts(range)!;

			range = createRevisionRange(parts.left, parts.right, '...');
			range2 = createRevisionRange(parts.right, parts.left, '...');
		}

		try {
			let result = await github.getComparison(
				toTokenInfo(this.provider.authenticationProviderId, session),
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(range),
			);

			const files1 = result?.files;

			let files = files1;
			if (range2) {
				result = await github.getComparison(
					toTokenInfo(this.provider.authenticationProviderId, session),
					metadata.repo.owner,
					metadata.repo.name,
					stripOrigin(range2),
				);

				const files2 = result?.files;

				files = [...new Set(union(files1, files2))];
			}

			return files?.map(f => ({
				path: f.filename ?? '',
				originalPath: f.previous_filename,
				status: fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
				repoPath: repoPath,
				stats: { additions: f.additions, deletions: f.deletions, changes: f.changes },
			}));
		} catch (ex) {
			scope?.error(ex);
			debugger;
			return undefined;
		}
	}

	@debug()
	async getNextComparisonUris(
		repoPath: string,
		pathOrUri: string | Uri,
		rev: string | undefined,
		skip: number = 0,
		_options?: { ordering?: 'date' | 'author-date' | 'topo' | null },
		_cancellation?: AbortSignal,
	): Promise<NextComparisonUrisResult | undefined> {
		// If we have no revision there is no next commit
		if (!rev) return undefined;

		const scope = getScopedLogger();

		const path = this.provider.getRelativePath(pathOrUri, repoPath);

		try {
			const context = await this.provider.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;

			const { metadata, github, session } = context;
			const revision = (await metadata.getRevision()).revision;

			if (rev === 'HEAD') {
				rev = revision;
			}

			const refs = await github.getNextCommitRefs(
				toTokenInfo(this.provider.authenticationProviderId, session),
				metadata.repo.owner,
				metadata.repo.name,
				revision,
				path,
				stripOrigin(rev),
			);

			return {
				current:
					skip === 0
						? createRevisionUri(repoPath, path, rev)
						: createRevisionUri(repoPath, path, refs[skip - 1]),
				next: refs[skip] != null ? createRevisionUri(repoPath, path, refs[skip]) : undefined,
			};
		} catch (ex) {
			scope?.error(ex);
			debugger;

			throw ex;
		}
	}

	@debug()
	async getPreviousComparisonUris(
		repoPath: string,
		pathOrUri: string | Uri,
		rev: string | undefined,
		skip: number = 0,
		_unsaved?: boolean,
		_options?: { ordering?: 'date' | 'author-date' | 'topo' | null },
		_cancellation?: AbortSignal,
	): Promise<PreviousComparisonUrisResult | undefined> {
		if (rev === deletedOrMissing) return undefined;

		const scope = getScopedLogger();

		const path = this.provider.getRelativePath(pathOrUri, repoPath);

		try {
			const context = await this.provider.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;

			const { metadata, github, session } = context;

			const offset = rev != null ? 1 : 0;

			const result = await github.getCommitRefs(
				toTokenInfo(this.provider.authenticationProviderId, session),
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(!rev || rev === 'HEAD' ? (await metadata.getRevision()).revision : rev),
				{
					path: path,
					first: offset + skip + 1,
				},
			);
			if (result == null) return undefined;

			// If we are at a commit, diff commit with previous
			const currentSha = skip === 0 ? rev : (result.values[offset + skip - 1]?.oid ?? deletedOrMissing);

			if (currentSha === deletedOrMissing) return undefined;

			return {
				current: createRevisionUri(repoPath, path, currentSha),
				previous: createRevisionUri(repoPath, path, result.values[offset + skip]?.oid ?? deletedOrMissing),
			};
		} catch (ex) {
			scope?.error(ex);
			debugger;

			throw ex;
		}
	}

	@debug()
	// eslint-disable-next-line @typescript-eslint/require-await
	async getPreviousComparisonUrisForRange(
		_repoPath: string,
		_path: string | Uri,
		_rev: string | undefined,
		_range: DiffRange,
		_options?: { ordering?: 'date' | 'author-date' | 'topo' | null; skipFirstRev?: boolean },
		_cancellation?: AbortSignal,
	): Promise<PreviousRangeComparisonUrisResult | undefined> {
		// This method requires `getBlameForLine` which depends on VS Code-specific
		// blame infrastructure. It will be overridden in the extension wrapper.
		return undefined;
	}
}

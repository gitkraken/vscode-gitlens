import type { Uri } from 'vscode';
import type { Container } from '../../../../../container';
import type { GitCache } from '../../../../../git/cache';
import type {
	DiffRange,
	GitDiffSubProvider,
	NextComparisonUrisResult,
	PreviousComparisonUrisResult,
	PreviousRangeComparisonUrisResult,
} from '../../../../../git/gitProvider';
import { GitUri } from '../../../../../git/gitUri';
import type { GitDiffFilter, GitDiffShortStat } from '../../../../../git/models/diff';
import type { GitFile } from '../../../../../git/models/file';
import { GitFileChange } from '../../../../../git/models/fileChange';
import { GitFileIndexStatus } from '../../../../../git/models/fileStatus';
import type { GitRevisionRange } from '../../../../../git/models/revision';
import { deletedOrMissing, uncommitted } from '../../../../../git/models/revision';
import { getChangedFilesCount } from '../../../../../git/utils/commit.utils';
import { createRevisionRange, getRevisionRangeParts, isRevisionRange } from '../../../../../git/utils/revision.utils';
import { diffRangeToEditorLine } from '../../../../../system/-webview/vscode/editors';
import { log } from '../../../../../system/decorators/log';
import { union } from '../../../../../system/iterable';
import { Logger } from '../../../../../system/logger';
import { getLogScope } from '../../../../../system/logger.scope';
import type { GitHubGitProviderInternal } from '../githubGitProvider';
import { stripOrigin } from '../githubGitProvider';
import { fromCommitFileStatus } from '../models';

export class DiffGitSubProvider implements GitDiffSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@log()
	async getChangedFilesCount(repoPath: string, ref?: string): Promise<GitDiffShortStat | undefined> {
		// TODO@eamodio if there is no ref we can't return anything, until we can get at the change store from RemoteHub
		if (!ref) return undefined;

		const commit = await this.provider.commits.getCommit(repoPath, ref);
		if (commit?.stats == null) return undefined;

		const { stats } = commit;

		const changedFiles = getChangedFilesCount(stats.files);
		return { additions: stats.additions, deletions: stats.deletions, files: changedFiles };
	}

	@log()
	async getDiffStatus(
		repoPath: string,
		ref1OrRange: string | GitRevisionRange,
		ref2?: string,
		_options?: { filters?: GitDiffFilter[]; path?: string; similarityThreshold?: number },
	): Promise<GitFile[] | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

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
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(range),
			);

			const files1 = result?.files;

			let files = files1;
			if (range2) {
				result = await github.getComparison(
					session.accessToken,
					metadata.repo.owner,
					metadata.repo.name,
					stripOrigin(range2),
				);

				const files2 = result?.files;

				files = [...new Set(union(files1, files2))];
			}

			return files?.map(
				f =>
					new GitFileChange(
						this.container,
						repoPath,
						f.filename ?? '',
						fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
						f.previous_filename,
						undefined,
						// If we need to get a 2nd range, don't include the stats because they won't be correct (for files that overlap)
						range2
							? undefined
							: {
									additions: f.additions ?? 0,
									deletions: f.deletions ?? 0,
									changes: f.changes ?? 0,
								},
					),
			);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getNextComparisonUris(
		repoPath: string,
		uri: Uri,
		rev: string | undefined,
		skip: number = 0,
	): Promise<NextComparisonUrisResult | undefined> {
		// If we have no revision there is no next commit
		if (!rev) return undefined;

		const scope = getLogScope();

		try {
			const context = await this.provider.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;

			const { metadata, github, remotehub, session } = context;
			const relativePath = this.provider.getRelativePath(uri, remotehub.getProviderRootUri(uri));
			const revision = (await metadata.getRevision()).revision;

			if (rev === 'HEAD') {
				rev = revision;
			}

			const refs = await github.getNextCommitRefs(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				revision,
				relativePath,
				stripOrigin(rev),
			);

			return {
				current:
					skip === 0
						? GitUri.fromFile(relativePath, repoPath, rev)
						: new GitUri(await this.provider.getBestRevisionUri(repoPath, relativePath, refs[skip - 1])),
				next: new GitUri(await this.provider.getBestRevisionUri(repoPath, relativePath, refs[skip])),
			};
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			throw ex;
		}
	}

	@log()
	async getPreviousComparisonUris(
		repoPath: string,
		uri: Uri,
		rev: string | undefined,
		skip: number = 0,
		_unsaved?: boolean,
	): Promise<PreviousComparisonUrisResult | undefined> {
		if (rev === deletedOrMissing) return undefined;

		const scope = getLogScope();

		if (rev === uncommitted) {
			rev = undefined;
		}

		try {
			const context = await this.provider.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;

			const { metadata, github, remotehub, session } = context;
			const relativePath = this.provider.getRelativePath(uri, remotehub.getProviderRootUri(uri));

			const offset = rev != null ? 1 : 0;

			const result = await github.getCommitRefs(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(!rev || rev === 'HEAD' ? (await metadata.getRevision()).revision : rev),
				{
					path: relativePath,
					first: offset + skip + 1,
				},
			);
			if (result == null) return undefined;

			// If we are at a commit, diff commit with previous
			const current =
				skip === 0
					? GitUri.fromFile(relativePath, repoPath, rev)
					: new GitUri(
							await this.provider.getBestRevisionUri(
								repoPath,
								relativePath,
								result.values[offset + skip - 1]?.oid ?? deletedOrMissing,
							),
						);
			if (current == null || current.sha === deletedOrMissing) return undefined;

			return {
				current: current,
				previous: new GitUri(
					await this.provider.getBestRevisionUri(
						repoPath,
						relativePath,
						result.values[offset + skip]?.oid ?? deletedOrMissing,
					),
				),
			};
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			throw ex;
		}
	}

	@log()
	async getPreviousComparisonUrisForRange(
		repoPath: string,
		uri: Uri,
		rev: string | undefined,
		range: DiffRange,
		_options?: { skipFirstRev?: boolean },
	): Promise<PreviousRangeComparisonUrisResult | undefined> {
		if (rev === deletedOrMissing) return undefined;

		const scope = getLogScope();

		try {
			const context = await this.provider.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;

			const { remotehub } = context;

			let relativePath = this.provider.getRelativePath(uri, remotehub.getProviderRootUri(uri));

			// FYI, GitHub doesn't currently support returning the original line number, nor the previous sha, so this is untrustworthy

			const editorLine = diffRangeToEditorLine(range);

			let current = GitUri.fromFile(relativePath, repoPath, rev);
			let currentLine = editorLine;
			let previous;
			let previousLine = editorLine;
			let nextLine = editorLine;

			for (let i = 0; i < 2; i++) {
				const blameLine = await this.provider.getBlameForLine(previous ?? current, nextLine, undefined, {
					forceSingleLine: true,
				});
				if (blameLine == null) break;

				// Diff with line ref with previous
				rev = blameLine.commit.sha;
				relativePath = blameLine.commit.file?.path ?? blameLine.commit.file?.originalPath ?? relativePath;
				nextLine = blameLine.line.originalLine - 1;

				const gitUri = GitUri.fromFile(relativePath, repoPath, rev);
				if (previous == null) {
					previous = gitUri;
					previousLine = nextLine;
				} else {
					current = previous;
					currentLine = previousLine;
					previous = gitUri;
					previousLine = nextLine;
				}
			}

			if (current == null) return undefined;

			const line = currentLine != null ? currentLine + 1 : range.startLine;
			return {
				current: current,
				previous: previous,
				range: { startLine: line, endLine: line, active: range.active },
			};
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			throw ex;
		}
	}
}

import type { Cache } from '@gitlens/git/cache.js';
import type { GitBlame, GitBlameAuthor, ProgressiveGitBlame } from '@gitlens/git/models/blame.js';
import type { GitCommitLine } from '@gitlens/git/models/commit.js';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { GitFileIndexStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitBlameSubProvider } from '@gitlens/git/providers/blame.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import { getBlameRange } from '@gitlens/git/utils/blame.utils.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { joinUriPath } from '@gitlens/utils/uri.js';
import { toTokenInfo } from '../../api/tokenUtils.js';
import type { GitHubGitProviderInternal } from '../githubProvider.js';

function isViewer(name: string, viewer: string | undefined): boolean | undefined {
	return (viewer != null && name === viewer) || undefined;
}

export class BlameGitHubSubProvider implements GitBlameSubProvider {
	constructor(
		private readonly cache: Cache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@debug()
	async getBlame(
		repoPath: string,
		path: string,
		rev?: string,
		contents?: string,
		_options?: { args?: string[] | null; ignoreWhitespace?: boolean },
	): Promise<GitBlame | undefined> {
		// GitHub doesn't support contents-based blame
		if (contents != null) return undefined;

		if (await this.provider.context.hasUncommittedChanges?.(repoPath, path)) return undefined;

		const cacheKey = `${normalizePath(path)}:${rev ?? ''}`;
		const progressive = await this.cache.blame.getOrCreate(
			repoPath,
			cacheKey,
			async () => {
				const blame = await this.getBlameCore(repoPath, path, rev);
				if (blame == null) return undefined;

				return createCompletedBlame(blame);
			},
			{ errorTTL: 1000 * 60 },
		);
		return progressive?.completed;
	}

	@debug()
	async getBlameForLine(
		repoPath: string,
		path: string,
		editorLine: number,
		rev?: string,
		contents?: string,
		options?: { forceSingleLine?: boolean } & { args?: string[] | null; ignoreWhitespace?: boolean },
	): Promise<{ author: GitBlameAuthor & { lineCount: number }; commit: GitCommit; line: GitCommitLine } | undefined> {
		// GitHub doesn't support contents-based blame
		if (contents != null) return undefined;

		if (await this.provider.context.hasUncommittedChanges?.(repoPath, path)) return undefined;

		const blame = await this.getBlame(repoPath, path, rev, contents, options);
		if (blame == null) return undefined;

		let blameLine = blame.lines[editorLine];
		if (blameLine == null) {
			if (blame.lines.length !== editorLine) return undefined;
			blameLine = blame.lines[editorLine - 1];
		}

		const commit = blame.commits.get(blameLine.sha);
		if (commit == null) return undefined;

		const author = blame.authors.get(commit.author.name)!;
		return {
			author: { ...author, lineCount: commit.lines.length },
			commit: commit,
			line: blameLine,
		};
	}

	@debug()
	async getBlameForRange(
		repoPath: string,
		path: string,
		range: DiffRange,
		rev?: string,
		contents?: string,
		options?: { args?: string[] | null; ignoreWhitespace?: boolean },
	): Promise<GitBlame | undefined> {
		const blame = await this.getBlame(repoPath, path, rev, contents, options);
		if (blame == null) return undefined;

		return getBlameRange(blame, range);
	}

	private async getBlameCore(repoPath: string, path: string, rev: string | undefined): Promise<GitBlame | undefined> {
		try {
			const context = await this.provider.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;
			const { metadata, github, session } = context;

			const root = this.provider.createVirtualUri(repoPath, undefined);

			const resolvedRef = !rev || rev === 'HEAD' ? (await metadata.getRevision()).revision : rev;
			const blame = await github.getBlame(
				toTokenInfo(this.provider.authenticationProviderId, session),
				metadata.repo.owner,
				metadata.repo.name,
				resolvedRef,
				path,
			);

			const authors = new Map<string, GitBlameAuthor>();
			const commits = new Map<string, GitCommit>();
			const lines: GitCommitLine[] = [];

			for (const range of blame.ranges) {
				const c = range.commit;

				const { viewer = session.account.label } = blame;

				let author = authors.get(c.author.name);
				if (author == null) {
					author = { name: c.author.name, lineCount: 0, current: isViewer(c.author.name, viewer) };
					authors.set(c.author.name, author);
				}

				author.lineCount += range.endingLine - range.startingLine + 1;

				let commit = commits.get(c.oid);
				if (commit == null) {
					commit = new GitCommit(
						repoPath,
						c.oid,
						new GitCommitIdentity(
							c.author.name,
							c.author.email,
							new Date(c.author.date),
							c.author.avatarUrl,
							isViewer(c.author.name, viewer),
						),
						new GitCommitIdentity(
							c.committer.name,
							c.committer.email,
							new Date(c.committer.date),
							undefined,
							isViewer(c.committer.name, viewer),
						),
						c.message.split('\n', 1)[0],
						c.parents.nodes[0]?.oid ? [c.parents.nodes[0]?.oid] : [],
						c.message,
						{
							files: undefined,
							filtered: {
								files: [
									new GitFileChange(
										root.toString(),
										path,
										GitFileIndexStatus.Modified,
										joinUriPath(root, path),
									),
								],
								pathspec: path,
							},
						},
						{
							files: c.changedFiles ?? 0,
							additions: c.additions ?? 0,
							deletions: c.deletions ?? 0,
						},
						[],
					);

					commits.set(c.oid, commit);
				}

				for (let i = range.startingLine; i <= range.endingLine; i++) {
					const line: GitCommitLine = { sha: c.oid, originalLine: i, line: i };
					commit.lines.push(line);
					lines[i - 1] = line;
				}
			}

			const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

			return {
				repoPath: repoPath,
				authors: sortedAuthors,
				commits: commits,
				lines: lines,
			};
		} catch (ex) {
			debugger;
			if (!String(ex).includes('No provider registered with')) {
				Logger.error(ex);
			}
			return undefined;
		}
	}
}

/** Creates an already-completed progressive blame. Used when the provider doesn't support streaming. */
function createCompletedBlame(blame: GitBlame): ProgressiveGitBlame {
	const noop = createDisposable(() => {});
	return {
		current: blame,
		isComplete: true,
		completed: Promise.resolve(blame),
		onDidProgress: function () {
			return noop;
		},
	};
}

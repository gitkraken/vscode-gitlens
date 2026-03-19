import type { Cache } from '@gitlens/git/cache.js';
import type { GitBlame, GitBlameAuthor } from '@gitlens/git/models/blame.js';
import type { GitCommitLine } from '@gitlens/git/models/commit.js';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { GitFileIndexStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitBlameSubProvider } from '@gitlens/git/providers/blame.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import { getBlameRange } from '@gitlens/git/utils/blame.utils.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { joinUriPath } from '@gitlens/utils/uri.js';
import { toTokenInfo } from '../../api/tokenUtils.js';
import type { GitHubGitProviderInternal } from '../githubProvider.js';

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
		return this.cache.blame.getOrCreate(repoPath, cacheKey, () => this.getBlameCore(repoPath, path, rev), {
			errorTTL: 1000 * 60,
		});
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
				const authorName = viewer != null && c.author.name === viewer ? 'You' : c.author.name;
				const committerName = viewer != null && c.committer.name === viewer ? 'You' : c.committer.name;

				let author = authors.get(authorName);
				if (author == null) {
					author = { name: authorName, lineCount: 0 };
					authors.set(authorName, author);
				}

				author.lineCount += range.endingLine - range.startingLine + 1;

				let commit = commits.get(c.oid);
				if (commit == null) {
					commit = new GitCommit(
						repoPath,
						c.oid,
						new GitCommitIdentity(authorName, c.author.email, new Date(c.author.date), c.author.avatarUrl),
						new GitCommitIdentity(committerName, c.committer.email, new Date(c.committer.date)),
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

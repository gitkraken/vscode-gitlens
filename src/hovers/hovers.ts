import { CancellationToken, MarkdownString, TextDocument } from 'vscode';
import { hrtime } from '@env/hrtime';
import { DiffWithCommand, ShowQuickCommitCommand } from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { CommitFormatter } from '../git/formatters';
import { GitUri } from '../git/gitUri';
import { GitCommit, GitDiffHunk, GitDiffHunkLine, GitRemote, GitRevision, PullRequest } from '../git/models';
import { Logger, LogLevel } from '../logger';
import { count } from '../system/iterable';
import { PromiseCancelledError } from '../system/promise';
import { getDurationMilliseconds } from '../system/string';

export namespace Hovers {
	export async function changesMessage(
		commit: GitCommit,
		uri: GitUri,
		editorLine: number,
		document: TextDocument,
	): Promise<MarkdownString | undefined> {
		const documentRef = uri.sha;

		async function getDiff() {
			if (commit.file == null) return undefined;

			// TODO: Figure out how to optimize this
			let ref;
			let ref2 = documentRef;
			if (commit.isUncommitted) {
				if (GitRevision.isUncommittedStaged(documentRef)) {
					ref = documentRef;
				}

				// Check for a staged diff
				if (ref == null && ref2 == null) {
					ref2 = GitRevision.uncommittedStaged;
				}
			} else {
				ref = commit.file.previousSha;
				if (ref == null) {
					return `\`\`\`diff\n+ ${document.lineAt(editorLine).text}\n\`\`\``;
				}
			}

			const line = editorLine + 1;
			const commitLine = commit.lines.find(l => l.to.line === line) ?? commit.lines[0];

			let originalPath = commit.file.originalPath;
			if (originalPath == null) {
				if (uri.fsPath !== commit.file.uri.fsPath) {
					originalPath = commit.file.path;
				}
			}

			editorLine = commitLine.to.line - 1;
			// TODO: Doesn't work with dirty files -- pass in editor? or contents?
			let hunkLine = await Container.instance.git.getDiffForLine(uri, editorLine, ref, ref2);

			// If we didn't find a diff & ref is undefined (meaning uncommitted), check for a staged diff
			if (hunkLine == null && ref == null && ref2 !== GitRevision.uncommittedStaged) {
				hunkLine = await Container.instance.git.getDiffForLine(
					uri,
					editorLine,
					undefined,
					GitRevision.uncommittedStaged,
				);
			}

			return hunkLine != null ? getDiffFromHunkLine(hunkLine) : undefined;
		}

		const diff = await getDiff();
		if (diff == null) return undefined;

		let message;
		let previous;
		let current;
		if (commit.isUncommitted) {
			const diffUris = await commit.getPreviousLineDiffUris(uri, editorLine, documentRef);
			if (diffUris?.previous == null) return undefined;

			message = `[$(compare-changes)](${DiffWithCommand.getMarkdownCommandArgs({
				lhs: {
					sha: diffUris.previous.sha ?? '',
					uri: diffUris.previous.documentUri(),
				},
				rhs: {
					sha: diffUris.current.sha ?? '',
					uri: diffUris.current.documentUri(),
				},
				repoPath: commit.repoPath,
				line: editorLine,
			})} "Open Changes")`;

			previous =
				diffUris.previous.sha == null || diffUris.previous.isUncommitted
					? `  &nbsp;_${GitRevision.shorten(diffUris.previous.sha, {
							strings: { working: 'Working Tree' },
					  })}_ &nbsp;${GlyphChars.ArrowLeftRightLong}&nbsp; `
					: `  &nbsp;[$(git-commit) ${GitRevision.shorten(
							diffUris.previous.sha || '',
					  )}](${ShowQuickCommitCommand.getMarkdownCommandArgs(
							diffUris.previous.sha || '',
					  )} "Show Commit") &nbsp;${GlyphChars.ArrowLeftRightLong}&nbsp; `;

			current =
				diffUris.current.sha == null || diffUris.current.isUncommitted
					? `_${GitRevision.shorten(diffUris.current.sha, {
							strings: {
								working: 'Working Tree',
							},
					  })}_`
					: `[$(git-commit) ${GitRevision.shorten(
							diffUris.current.sha || '',
					  )}](${ShowQuickCommitCommand.getMarkdownCommandArgs(diffUris.current.sha || '')} "Show Commit")`;
		} else {
			message = `[$(compare-changes)](${DiffWithCommand.getMarkdownCommandArgs(
				commit,
				editorLine,
			)} "Open Changes")`;

			const previousSha = commit.file?.previousSha;
			if (previousSha) {
				previous = `  &nbsp;[$(git-commit) ${GitRevision.shorten(
					previousSha,
				)}](${ShowQuickCommitCommand.getMarkdownCommandArgs(previousSha)} "Show Commit") &nbsp;${
					GlyphChars.ArrowLeftRightLong
				}&nbsp;`;
			}

			current = `[$(git-commit) ${commit.shortSha}](${ShowQuickCommitCommand.getMarkdownCommandArgs(
				commit.sha,
			)} "Show Commit")`;
		}

		message = `${diff}\n---\n\nChanges${previous ?? ' added in '}${current} &nbsp;&nbsp;|&nbsp;&nbsp; ${message}`;

		const markdown = new MarkdownString(message, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;
		return markdown;
	}

	export async function localChangesMessage(
		fromCommit: GitCommit | undefined,
		uri: GitUri,
		editorLine: number,
		hunk: GitDiffHunk,
	): Promise<MarkdownString | undefined> {
		const diff = getDiffFromHunk(hunk);

		let message;
		let previous;
		let current;
		if (fromCommit == null) {
			previous = '_Working Tree_';
			current = '_Unsaved_';
		} else {
			const file = await fromCommit.findFile(uri.fsPath);
			if (file == null) return undefined;

			message = `[$(compare-changes)](${DiffWithCommand.getMarkdownCommandArgs({
				lhs: {
					sha: fromCommit.sha,
					uri: GitUri.fromFile(file, uri.repoPath!, undefined, true).toFileUri(),
				},
				rhs: {
					sha: '',
					uri: uri.toFileUri(),
				},
				repoPath: uri.repoPath!,
				line: editorLine,
			})} "Open Changes")`;

			previous = `[$(git-commit) ${fromCommit.shortSha}](${ShowQuickCommitCommand.getMarkdownCommandArgs(
				fromCommit.sha,
			)} "Show Commit")`;

			current = '_Working Tree_';
		}
		message = `${diff}\n---\n\nLocal Changes  &nbsp;${previous} &nbsp;${
			GlyphChars.ArrowLeftRightLong
		}&nbsp; ${current}${message == null ? '' : ` &nbsp;&nbsp;|&nbsp;&nbsp; ${message}`}`;

		const markdown = new MarkdownString(message, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;
		return markdown;
	}

	export async function detailsMessage(
		commit: GitCommit,
		uri: GitUri,
		editorLine: number,
		format: string,
		dateFormat: string | null,
		options?: {
			autolinks?: boolean;
			cancellationToken?: CancellationToken;
			pullRequests?: {
				enabled: boolean;
				pr?: PullRequest | PromiseCancelledError<Promise<PullRequest | undefined>>;
			};
			getBranchAndTagTips?: (
				sha: string,
				options?: { compact?: boolean | undefined; icons?: boolean | undefined },
			) => string | undefined;
		},
	): Promise<MarkdownString> {
		if (dateFormat === null) {
			dateFormat = 'MMMM Do, YYYY h:mma';
		}

		let message = commit.message ?? commit.summary;
		if (commit.message == null && !commit.isUncommitted) {
			await commit.ensureFullDetails();
			message = commit.message ?? commit.summary;

			if (options?.cancellationToken?.isCancellationRequested) return new MarkdownString();
		}

		const remotes = await Container.instance.git.getRemotesWithProviders(commit.repoPath, { sort: true });

		if (options?.cancellationToken?.isCancellationRequested) return new MarkdownString();

		const [previousLineDiffUris, autolinkedIssuesOrPullRequests, pr, presence] = await Promise.all([
			commit.isUncommitted ? commit.getPreviousLineDiffUris(uri, editorLine, uri.sha) : undefined,
			getAutoLinkedIssuesOrPullRequests(message, remotes),
			options?.pullRequests?.pr ??
				getPullRequestForCommit(commit.ref, remotes, {
					pullRequests:
						options?.pullRequests?.enabled ||
						CommitFormatter.has(
							format,
							'pullRequest',
							'pullRequestAgo',
							'pullRequestAgoOrDate',
							'pullRequestDate',
							'pullRequestState',
						),
				}),
			Container.instance.vsls.maybeGetPresence(commit.author.email),
		]);

		if (options?.cancellationToken?.isCancellationRequested) return new MarkdownString();

		const details = await CommitFormatter.fromTemplateAsync(format, commit, {
			autolinkedIssuesOrPullRequests: autolinkedIssuesOrPullRequests,
			dateFormat: dateFormat,
			editor: {
				line: editorLine,
				uri: uri,
			},
			getBranchAndTagTips: options?.getBranchAndTagTips,
			markdown: true,
			messageAutolinks: options?.autolinks,
			pullRequestOrRemote: pr,
			presence: presence,
			previousLineDiffUris: previousLineDiffUris,
			remotes: remotes,
		});

		const markdown = new MarkdownString(details, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;
		return markdown;
	}

	function getDiffFromHunk(hunk: GitDiffHunk): string {
		return `\`\`\`diff\n${hunk.diff.trim()}\n\`\`\``;
	}

	function getDiffFromHunkLine(hunkLine: GitDiffHunkLine, diffStyle?: 'line' | 'hunk'): string {
		if (diffStyle === 'hunk' || (diffStyle == null && Container.instance.config.hovers.changesDiff === 'hunk')) {
			return getDiffFromHunk(hunkLine.hunk);
		}

		return `\`\`\`diff${hunkLine.previous == null ? '' : `\n- ${hunkLine.previous.line.trim()}`}${
			hunkLine.current == null ? '' : `\n+ ${hunkLine.current.line.trim()}`
		}\n\`\`\``;
	}

	async function getAutoLinkedIssuesOrPullRequests(message: string, remotes: GitRemote[]) {
		const cc = Logger.getNewCorrelationContext('Hovers.getAutoLinkedIssuesOrPullRequests');
		Logger.debug(cc, `${GlyphChars.Dash} message=<message>`);

		const start = hrtime();

		if (
			!Container.instance.config.hovers.autolinks.enabled ||
			!Container.instance.config.hovers.autolinks.enhanced ||
			!CommitFormatter.has(Container.instance.config.hovers.detailsMarkdownFormat, 'message')
		) {
			Logger.debug(cc, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

			return undefined;
		}

		const remote = await Container.instance.git.getRichRemoteProvider(remotes);
		if (remote?.provider == null) {
			Logger.debug(cc, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

			return undefined;
		}

		// TODO: Make this configurable?
		const timeout = 250;

		try {
			const autolinks = await Container.instance.autolinks.getIssueOrPullRequestLinks(message, remote, {
				timeout: timeout,
			});

			if (autolinks != null && Logger.enabled(LogLevel.Debug)) {
				// If there are any issues/PRs that timed out, log it
				const prCount = count(autolinks.values(), pr => pr instanceof PromiseCancelledError);
				if (prCount !== 0) {
					Logger.debug(
						cc,
						`timed out ${
							GlyphChars.Dash
						} ${prCount} issue/pull request queries took too long (over ${timeout} ms) ${
							GlyphChars.Dot
						} ${getDurationMilliseconds(start)} ms`,
					);

					// const pending = [
					// 	...Iterables.map(autolinks.values(), issueOrPullRequest =>
					// 		issueOrPullRequest instanceof CancelledPromiseError
					// 			? issueOrPullRequest.promise
					// 			: undefined,
					// 	),
					// ];
					// void Promise.all(pending).then(() => {
					// 	Logger.debug(
					// 		cc,
					// 		`${GlyphChars.Dot} ${count} issue/pull request queries completed; refreshing...`,
					// 	);
					// 	void commands.executeCommand('editor.action.showHover');
					// });

					return autolinks;
				}
			}

			Logger.debug(cc, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

			return autolinks;
		} catch (ex) {
			Logger.error(ex, cc, `failed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

			return undefined;
		}
	}

	async function getPullRequestForCommit(
		ref: string,
		remotes: GitRemote[],
		options?: {
			pullRequests?: boolean;
		},
	) {
		const cc = Logger.getNewCorrelationContext('Hovers.getPullRequestForCommit');
		Logger.debug(cc, `${GlyphChars.Dash} ref=${ref}`);

		const start = hrtime();

		if (!options?.pullRequests) {
			Logger.debug(cc, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

			return undefined;
		}

		const remote = await Container.instance.git.getRichRemoteProvider(remotes, { includeDisconnected: true });
		if (remote?.provider == null) {
			Logger.debug(cc, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

			return undefined;
		}

		const { provider } = remote;
		const connected = provider.maybeConnected ?? (await provider.isConnected());
		if (!connected) {
			Logger.debug(cc, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

			return remote;
		}

		try {
			const pr = await Container.instance.git.getPullRequestForCommit(ref, provider, { timeout: 250 });

			Logger.debug(cc, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

			return pr;
		} catch (ex) {
			if (ex instanceof PromiseCancelledError) {
				Logger.debug(cc, `timed out ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

				return ex;
			}

			Logger.error(ex, cc, `failed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

			return undefined;
		}
	}
}

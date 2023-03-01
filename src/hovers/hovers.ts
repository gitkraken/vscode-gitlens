import type { CancellationToken, TextDocument } from 'vscode';
import { MarkdownString } from 'vscode';
import { hrtime } from '@env/hrtime';
import { DiffWithCommand, ShowQuickCommitCommand } from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { CommitFormatter } from '../git/formatters/commitFormatter';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { uncommittedStaged } from '../git/models/constants';
import type { GitDiffHunk, GitDiffHunkLine } from '../git/models/diff';
import type { PullRequest } from '../git/models/pullRequest';
import { isUncommittedStaged, shortenRevision } from '../git/models/reference';
import type { GitRemote } from '../git/models/remote';
import { configuration } from '../system/configuration';
import { count } from '../system/iterable';
import { Logger } from '../system/logger';
import { LogLevel } from '../system/logger.constants';
import { getNewLogScope } from '../system/logger.scope';
import { getSettledValue, PromiseCancelledError } from '../system/promise';
import { getDurationMilliseconds } from '../system/string';

export async function changesMessage(
	commit: GitCommit,
	uri: GitUri,
	editorLine: number, // 0-based, Git is 1-based
	document: TextDocument,
): Promise<MarkdownString | undefined> {
	const documentRef = uri.sha;

	let previousSha = null;

	async function getDiff() {
		if (commit.file == null) return undefined;

		// TODO: Figure out how to optimize this
		let ref;
		if (commit.isUncommitted) {
			if (isUncommittedStaged(documentRef)) {
				ref = documentRef;
			}
		} else {
			previousSha = await commit.getPreviousSha();
			ref = previousSha;
			if (ref == null) {
				return `\`\`\`diff\n+ ${document.lineAt(editorLine).text}\n\`\`\``;
			}
		}

		const line = editorLine + 1;
		const commitLine = commit.lines.find(l => l.line === line) ?? commit.lines[0];

		let originalPath = commit.file.originalPath;
		if (originalPath == null) {
			if (uri.fsPath !== commit.file.uri.fsPath) {
				originalPath = commit.file.path;
			}
		}

		editorLine = commitLine.line - 1;
		// TODO: Doesn't work with dirty files -- pass in editor? or contents?
		let hunkLine = await Container.instance.git.getDiffForLine(uri, editorLine, ref, documentRef);

		// If we didn't find a diff & ref is undefined (meaning uncommitted), check for a staged diff
		if (hunkLine == null && ref == null && documentRef !== uncommittedStaged) {
			hunkLine = await Container.instance.git.getDiffForLine(uri, editorLine, undefined, uncommittedStaged);
		}

		return hunkLine != null ? getDiffFromHunkLine(hunkLine) : undefined;
	}

	const diff = await getDiff();
	if (diff == null) return undefined;

	let message;
	let previous;
	let current;
	if (commit.isUncommitted) {
		const compareUris = await commit.getPreviousComparisonUrisForLine(editorLine, documentRef);
		if (compareUris?.previous == null) return undefined;

		message = `[$(compare-changes)](${DiffWithCommand.getMarkdownCommandArgs({
			lhs: {
				sha: compareUris.previous.sha ?? '',
				uri: compareUris.previous.documentUri(),
			},
			rhs: {
				sha: compareUris.current.sha ?? '',
				uri: compareUris.current.documentUri(),
			},
			repoPath: commit.repoPath,
			line: editorLine,
		})} "Open Changes")`;

		previous =
			compareUris.previous.sha == null || compareUris.previous.isUncommitted
				? `  &nbsp;_${shortenRevision(compareUris.previous.sha, {
						strings: { working: 'Working Tree' },
				  })}_ &nbsp;${GlyphChars.ArrowLeftRightLong}&nbsp; `
				: `  &nbsp;[$(git-commit) ${shortenRevision(
						compareUris.previous.sha || '',
				  )}](${ShowQuickCommitCommand.getMarkdownCommandArgs(
						compareUris.previous.sha || '',
				  )} "Show Commit") &nbsp;${GlyphChars.ArrowLeftRightLong}&nbsp; `;

		current =
			compareUris.current.sha == null || compareUris.current.isUncommitted
				? `_${shortenRevision(compareUris.current.sha, {
						strings: {
							working: 'Working Tree',
						},
				  })}_`
				: `[$(git-commit) ${shortenRevision(
						compareUris.current.sha || '',
				  )}](${ShowQuickCommitCommand.getMarkdownCommandArgs(compareUris.current.sha || '')} "Show Commit")`;
	} else {
		message = `[$(compare-changes)](${DiffWithCommand.getMarkdownCommandArgs(commit, editorLine)} "Open Changes")`;

		if (previousSha === null) {
			previousSha = await commit.getPreviousSha();
		}
		if (previousSha) {
			previous = `  &nbsp;[$(git-commit) ${shortenRevision(
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
	editorLine: number, // 0-based, Git is 1-based
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
		const file = await fromCommit.findFile(uri);
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
	editorLine: number, // 0-based, Git is 1-based
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

	const [previousLineComparisonUrisResult, autolinkedIssuesOrPullRequestsResult, prResult, presenceResult] =
		await Promise.allSettled([
			commit.isUncommitted ? commit.getPreviousComparisonUrisForLine(editorLine, uri.sha) : undefined,
			getAutoLinkedIssuesOrPullRequests(message, remotes),
			options?.pullRequests?.pr ??
				getPullRequestForCommit(commit.ref, remotes, {
					pullRequests:
						options?.pullRequests?.enabled !== false &&
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

	const previousLineComparisonUris = getSettledValue(previousLineComparisonUrisResult);
	const autolinkedIssuesOrPullRequests = getSettledValue(autolinkedIssuesOrPullRequestsResult);
	const pr = getSettledValue(prResult);
	const presence = getSettledValue(presenceResult);

	// Remove possible duplicate pull request
	if (pr != null && !(pr instanceof PromiseCancelledError)) {
		autolinkedIssuesOrPullRequests?.delete(pr.id);
	}

	const details = await CommitFormatter.fromTemplateAsync(format, commit, {
		autolinkedIssuesOrPullRequests: autolinkedIssuesOrPullRequests,
		dateFormat: dateFormat,
		editor: {
			line: editorLine,
			uri: uri,
		},
		getBranchAndTagTips: options?.getBranchAndTagTips,
		messageAutolinks: options?.autolinks,
		pullRequestOrRemote: pr,
		presence: presence,
		previousLineComparisonUris: previousLineComparisonUris,
		outputFormat: 'markdown',
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
	if (diffStyle === 'hunk' || (diffStyle == null && configuration.get('hovers.changesDiff') === 'hunk')) {
		return getDiffFromHunk(hunkLine.hunk);
	}

	return `\`\`\`diff${hunkLine.previous == null ? '' : `\n- ${hunkLine.previous.line.trim()}`}${
		hunkLine.current == null ? '' : `\n+ ${hunkLine.current.line.trim()}`
	}\n\`\`\``;
}

async function getAutoLinkedIssuesOrPullRequests(message: string, remotes: GitRemote[]) {
	const scope = getNewLogScope('Hovers.getAutoLinkedIssuesOrPullRequests');
	Logger.debug(scope, `${GlyphChars.Dash} message=<message>`);

	const start = hrtime();

	const cfg = configuration.get('hovers');
	if (
		!cfg.autolinks.enabled ||
		!cfg.autolinks.enhanced ||
		!CommitFormatter.has(cfg.detailsMarkdownFormat, 'message')
	) {
		Logger.debug(scope, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

		return undefined;
	}

	const remote = await Container.instance.git.getBestRemoteWithRichProvider(remotes);
	if (remote?.provider == null) {
		Logger.debug(scope, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

		return undefined;
	}

	// TODO: Make this configurable?
	const timeout = 250;

	try {
		const autolinks = await Container.instance.autolinks.getLinkedIssuesAndPullRequests(message, remote, {
			timeout: timeout,
		});

		if (autolinks != null && Logger.enabled(LogLevel.Debug)) {
			// If there are any issues/PRs that timed out, log it
			const prCount = count(autolinks.values(), pr => pr instanceof PromiseCancelledError);
			if (prCount !== 0) {
				Logger.debug(
					scope,
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
				// 		scope,
				// 		`${GlyphChars.Dot} ${count} issue/pull request queries completed; refreshing...`,
				// 	);
				// 	void executeCoreCommand(CoreCommands.EditorShowHover);
				// });

				return autolinks;
			}
		}

		Logger.debug(scope, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

		return autolinks;
	} catch (ex) {
		Logger.error(ex, scope, `failed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

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
	const scope = getNewLogScope('Hovers.getPullRequestForCommit');
	Logger.debug(scope, `${GlyphChars.Dash} ref=${ref}`);

	const start = hrtime();

	if (!options?.pullRequests) {
		Logger.debug(scope, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

		return undefined;
	}

	const remote = await Container.instance.git.getBestRemoteWithRichProvider(remotes, {
		includeDisconnected: true,
	});
	if (remote?.provider == null) {
		Logger.debug(scope, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

		return undefined;
	}

	const { provider } = remote;
	const connected = provider.maybeConnected ?? (await provider.isConnected());
	if (!connected) {
		Logger.debug(scope, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

		return remote;
	}

	try {
		const pr = await Container.instance.git.getPullRequestForCommit(ref, provider, { timeout: 250 });

		Logger.debug(scope, `completed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

		return pr;
	} catch (ex) {
		if (ex instanceof PromiseCancelledError) {
			Logger.debug(scope, `timed out ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

			return ex;
		}

		Logger.error(ex, scope, `failed ${GlyphChars.Dot} ${getDurationMilliseconds(start)} ms`);

		return undefined;
	}
}

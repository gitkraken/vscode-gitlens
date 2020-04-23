'use strict';
import { MarkdownString } from 'vscode';
import { DiffWithCommand, ShowQuickCommitCommand } from '../commands';
import { FileAnnotationType } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import {
	CommitFormatter,
	GitBlameCommit,
	GitCommit,
	GitDiffHunkLine,
	GitLogCommit,
	GitRemote,
	GitRevision,
} from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger, TraceLevel } from '../logger';
import { Iterables, Promises, Strings } from '../system';

export namespace Hovers {
	export async function changesMessage(
		commit: GitBlameCommit,
		uri: GitUri,
		editorLine: number,
	): Promise<MarkdownString | undefined>;
	export async function changesMessage(
		commit: GitLogCommit,
		uri: GitUri,
		editorLine: number,
		hunkLine: GitDiffHunkLine,
	): Promise<MarkdownString | undefined>;
	export async function changesMessage(
		commit: GitBlameCommit | GitLogCommit,
		uri: GitUri,
		editorLine: number,
		hunkLine?: GitDiffHunkLine,
	): Promise<MarkdownString | undefined> {
		const documentRef = uri.sha;
		if (GitBlameCommit.is(commit)) {
			// TODO: Figure out how to optimize this
			let ref;
			if (commit.isUncommitted) {
				if (GitRevision.isUncommittedStaged(documentRef)) {
					ref = documentRef;
				}
			} else {
				ref = commit.sha;
			}

			const line = editorLine + 1;
			const commitLine = commit.lines.find(l => l.line === line) || commit.lines[0];

			let originalFileName = commit.originalFileName;
			if (originalFileName === undefined) {
				if (uri.fsPath !== commit.uri.fsPath) {
					originalFileName = commit.fileName;
				}
			}

			editorLine = commitLine.originalLine - 1;
			hunkLine = await Container.git.getDiffForLine(uri, editorLine, ref, undefined, originalFileName);

			// If we didn't find a diff & ref is undefined (meaning uncommitted), check for a staged diff
			if (hunkLine === undefined && ref === undefined) {
				hunkLine = await Container.git.getDiffForLine(
					uri,
					editorLine,
					undefined,
					GitRevision.uncommittedStaged,
					originalFileName,
				);
			}
		}

		if (hunkLine === undefined || commit.previousSha === undefined) return undefined;

		const diff = getDiffFromHunkLine(hunkLine);

		let message;
		let previous;
		let current;
		if (commit.isUncommitted) {
			const diffUris = await commit.getPreviousLineDiffUris(uri, editorLine, documentRef);
			if (diffUris === undefined || diffUris.previous === undefined) {
				return undefined;
			}

			message = `[$(compare-changes) Changes](${DiffWithCommand.getMarkdownCommandArgs({
				lhs: {
					sha: diffUris.previous.sha || '',
					uri: diffUris.previous.documentUri(),
				},
				rhs: {
					sha: diffUris.current.sha || '',
					uri: diffUris.current.documentUri(),
				},
				repoPath: commit.repoPath,
				line: editorLine,
			})} "Open Changes")`;

			previous =
				diffUris.previous.sha === undefined || diffUris.previous.isUncommitted
					? `_${GitRevision.shorten(diffUris.previous.sha, {
							strings: {
								working: 'Working Tree',
							},
					  })}_`
					: `[$(git-commit) ${GitRevision.shorten(
							diffUris.previous.sha || '',
					  )}](${ShowQuickCommitCommand.getMarkdownCommandArgs(
							diffUris.previous.sha || '',
					  )} "Show Commit Details")`;

			current =
				diffUris.current.sha === undefined || diffUris.current.isUncommitted
					? `_${GitRevision.shorten(diffUris.current.sha, {
							strings: {
								working: 'Working Tree',
							},
					  })}_`
					: `[$(git-commit) ${GitRevision.shorten(
							diffUris.current.sha || '',
					  )}](${ShowQuickCommitCommand.getMarkdownCommandArgs(
							diffUris.current.sha || '',
					  )} "Show Commit Details")`;
		} else {
			message = `[$(compare-changes) Changes](${DiffWithCommand.getMarkdownCommandArgs(
				commit,
				editorLine,
			)} "Open Changes")`;

			previous = `[$(git-commit) ${commit.previousShortSha}](${ShowQuickCommitCommand.getMarkdownCommandArgs(
				commit.previousSha,
			)} "Show Commit Details")`;

			current = `[$(git-commit) ${commit.shortSha}](${ShowQuickCommitCommand.getMarkdownCommandArgs(
				commit.sha,
			)} "Show Commit Details")`;
		}

		message += ` &nbsp; ${GlyphChars.Dash} &nbsp; ${previous} &nbsp;${GlyphChars.ArrowLeftRightLong}&nbsp; ${current}\n${diff}`;

		const markdown = new MarkdownString(message, true);
		markdown.isTrusted = true;
		return markdown;
	}

	export async function detailsMessage(
		commit: GitCommit,
		uri: GitUri,
		editorLine: number,
		dateFormat: string | null,
		annotationType: FileAnnotationType | undefined,
	): Promise<MarkdownString> {
		if (dateFormat === null) {
			dateFormat = 'MMMM Do, YYYY h:mma';
		}

		const remotes = await Container.git.getRemotes(commit.repoPath, { sort: true });

		const [previousLineDiffUris, autolinkedIssuesOrPullRequests, pr, presence] = await Promise.all([
			commit.isUncommitted ? commit.getPreviousLineDiffUris(uri, editorLine, uri.sha) : undefined,
			getAutoLinkedIssuesOrPullRequests(commit.message, remotes),
			getPullRequestForCommit(commit.ref, remotes),
			Container.vsls.maybeGetPresence(commit.email).catch(reason => undefined),
		]);

		const details = CommitFormatter.fromTemplate(Container.config.hovers.detailsMarkdownFormat, commit, {
			annotationType: annotationType,
			autolinkedIssuesOrPullRequests: autolinkedIssuesOrPullRequests,
			dateFormat: dateFormat,
			line: editorLine,
			markdown: true,
			pullRequestOrRemote: pr,
			presence: presence,
			previousLineDiffUris: previousLineDiffUris,
			remotes: remotes,
		});

		const markdown = new MarkdownString(details, true);
		markdown.isTrusted = true;
		return markdown;
	}

	function getDiffFromHunkLine(hunkLine: GitDiffHunkLine): string {
		if (Container.config.hovers.changesDiff === 'hunk') {
			return `\`\`\`diff\n${hunkLine.hunk.diff}\n\`\`\``;
		}

		return `\`\`\`diff${hunkLine.previous === undefined ? '' : `\n-${hunkLine.previous.line}`}${
			hunkLine.current === undefined ? '' : `\n+${hunkLine.current.line}`
		}\n\`\`\``;
	}

	async function getAutoLinkedIssuesOrPullRequests(message: string, remotes: GitRemote[]) {
		const cc = Logger.getNewCorrelationContext('Hovers.getAutoLinkedIssues');
		Logger.debug(cc, `${GlyphChars.Dash} message=<message>`);

		const start = process.hrtime();

		if (
			!Container.config.hovers.autolinks.enabled ||
			!Container.config.hovers.autolinks.enhanced ||
			!CommitFormatter.has(Container.config.hovers.detailsMarkdownFormat, 'message')
		) {
			Logger.debug(cc, `completed ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(start)} ms`);

			return undefined;
		}

		const remote = remotes.find(r => r.default && r.provider != null);
		if (remote === undefined) {
			Logger.debug(cc, `completed ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(start)} ms`);

			return undefined;
		}

		// TODO: Make this configurable?
		const timeout = 250;

		try {
			const autolinks = await Container.autolinks.getIssueOrPullRequestLinks(message, remote, {
				timeout: timeout,
			});

			if (autolinks !== undefined && (Logger.level === TraceLevel.Debug || Logger.isDebugging)) {
				const timeouts = [
					...Iterables.filterMap(autolinks.values(), issue =>
						issue instanceof Promises.CancellationError ? issue.promise : undefined,
					),
				];

				// If there are any PRs that timed out, refresh the annotation(s) once they complete
				if (timeouts.length !== 0) {
					Logger.debug(
						cc,
						`timed out ${GlyphChars.Dash} issue/pr queries (${
							timeouts.length
						}) took too long (over ${timeout} ms) ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(
							start,
						)} ms`,
					);

					return autolinks;
				}
			}

			Logger.debug(cc, `completed ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(start)} ms`);

			return autolinks;
		} catch (ex) {
			Logger.error(ex, cc, `failed ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(start)} ms`);

			return undefined;
		}
	}

	async function getPullRequestForCommit(ref: string, remotes: GitRemote[]) {
		const cc = Logger.getNewCorrelationContext('Hovers.getPullRequestForCommit');
		Logger.debug(cc, `${GlyphChars.Dash} ref=${ref}`);

		const start = process.hrtime();

		if (
			!Container.config.hovers.pullRequests.enabled ||
			!CommitFormatter.has(
				Container.config.hovers.detailsMarkdownFormat,
				'pullRequest',
				'pullRequestAgo',
				'pullRequestAgoOrDate',
				'pullRequestDate',
				'pullRequestState',
			)
		) {
			Logger.debug(cc, `completed ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(start)} ms`);

			return undefined;
		}

		const remote = remotes.find(r => r.default && r.provider != null);
		if (!remote?.provider?.hasApi()) {
			Logger.debug(cc, `completed ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(start)} ms`);

			return undefined;
		}

		const { provider } = remote;
		const connected = provider.maybeConnected ?? (await provider.isConnected());
		if (!connected) {
			Logger.debug(cc, `completed ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(start)} ms`);

			return remote;
		}

		try {
			const pr = await Container.git.getPullRequestForCommit(ref, provider, { timeout: 250 });

			Logger.debug(cc, `completed ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(start)} ms`);

			return pr;
		} catch (ex) {
			if (ex instanceof Promises.CancellationError) {
				Logger.debug(cc, `timed out ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(start)} ms`);

				return ex;
			}

			Logger.error(ex, cc, `failed ${GlyphChars.Dot} ${Strings.getDurationMilliseconds(start)} ms`);

			return undefined;
		}
	}
}

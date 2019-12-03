'use strict';
import { MarkdownString } from 'vscode';
import { DiffWithCommand, ShowQuickCommitDetailsCommand } from '../commands';
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
	GitService,
	GitUri
} from '../git/gitService';
import { Promises } from '../system/promise';

export namespace Hovers {
	export async function changesMessage(
		commit: GitBlameCommit,
		uri: GitUri,
		editorLine: number
	): Promise<MarkdownString | undefined>;
	export async function changesMessage(
		commit: GitLogCommit,
		uri: GitUri,
		editorLine: number,
		hunkLine: GitDiffHunkLine
	): Promise<MarkdownString | undefined>;
	export async function changesMessage(
		commit: GitBlameCommit | GitLogCommit,
		uri: GitUri,
		editorLine: number,
		hunkLine?: GitDiffHunkLine
	): Promise<MarkdownString | undefined> {
		const documentRef = uri.sha;
		if (GitBlameCommit.is(commit)) {
			// TODO: Figure out how to optimize this
			let ref;
			if (commit.isUncommitted) {
				if (GitService.isUncommittedStaged(documentRef)) {
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
					GitService.uncommittedStagedSha,
					originalFileName
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

			message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs({
				lhs: {
					sha: diffUris.previous.sha || '',
					uri: diffUris.previous.documentUri()
				},
				rhs: {
					sha: diffUris.current.sha || '',
					uri: diffUris.current.documentUri()
				},
				repoPath: commit.repoPath,
				line: editorLine
			})} "Open Changes")`;

			previous =
				diffUris.previous.sha === undefined || diffUris.previous.isUncommitted
					? `_${GitService.shortenSha(diffUris.previous.sha, {
							strings: {
								working: 'Working Tree'
							}
					  })}_`
					: `[\`${GitService.shortenSha(
							diffUris.previous.sha || ''
					  )}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
							diffUris.previous.sha || ''
					  )} "Show Commit Details")`;

			current =
				diffUris.current.sha === undefined || diffUris.current.isUncommitted
					? `_${GitService.shortenSha(diffUris.current.sha, {
							strings: {
								working: 'Working Tree'
							}
					  })}_`
					: `[\`${GitService.shortenSha(
							diffUris.current.sha || ''
					  )}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
							diffUris.current.sha || ''
					  )} "Show Commit Details")`;
		} else {
			message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(commit, editorLine)} "Open Changes")`;

			previous = `[\`${commit.previousShortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
				commit.previousSha
			)} "Show Commit Details")`;

			current = `[\`${commit.shortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
				commit.sha
			)} "Show Commit Details")`;
		}

		message += ` &nbsp; ${GlyphChars.Dash} &nbsp; ${previous} &nbsp;${GlyphChars.ArrowLeftRightLong}&nbsp; ${current}\n${diff}`;

		const markdown = new MarkdownString(message);
		markdown.isTrusted = true;
		return markdown;
	}

	export async function detailsMessage(
		commit: GitCommit,
		uri: GitUri,
		editorLine: number,
		dateFormat: string | null,
		annotationType: FileAnnotationType | undefined
	): Promise<MarkdownString> {
		if (dateFormat === null) {
			dateFormat = 'MMMM Do, YYYY h:mma';
		}

		const remotes = await Container.git.getRemotes(commit.repoPath, { sort: true });

		const [previousLineDiffUris, autolinkedIssues, pr, presence] = await Promise.all([
			commit.isUncommitted ? commit.getPreviousLineDiffUris(uri, editorLine, uri.sha) : undefined,
			getAutoLinkedIssues(commit.message, remotes),
			getPullRequestForCommit(commit.ref, remotes),
			Container.vsls.maybeGetPresence(commit.email).catch(reason => undefined)
		]);

		const details = CommitFormatter.fromTemplate(Container.config.hovers.detailsMarkdownFormat, commit, {
			annotationType: annotationType,
			autolinkedIssues: autolinkedIssues,
			dateFormat: dateFormat,
			line: editorLine,
			markdown: true,
			pullRequestOrRemote: pr,
			presence: presence,
			previousLineDiffUris: previousLineDiffUris,
			remotes: remotes
		});

		const markdown = new MarkdownString(details);
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

	async function getAutoLinkedIssues(message: string, remotes: GitRemote[]) {
		if (
			!Container.config.hovers.autolinks.enabled ||
			!Container.config.hovers.autolinks.enhanced ||
			!CommitFormatter.has(Container.config.hovers.detailsMarkdownFormat, 'message')
		) {
			return undefined;
		}

		const remote = remotes.find(r => r.default && r.provider != null);
		if (remote === undefined) return undefined;

		try {
			return await Container.autolinks.getIssueLinks(message, remote, { timeout: 250 });
		} catch {
			return undefined;
		}
	}

	async function getPullRequestForCommit(ref: string, remotes: GitRemote[]) {
		if (
			!Container.config.hovers.pullRequests.enabled ||
			!CommitFormatter.has(
				Container.config.hovers.detailsMarkdownFormat,
				'pullRequest',
				'pullRequestAgo',
				'pullRequestAgoOrDate',
				'pullRequestDate',
				'pullRequestState'
			)
		) {
			return undefined;
		}

		const remote = remotes.find(r => r.default && r.provider != null);
		if (remote === undefined) return undefined;

		const provider = remote.provider;
		if (provider?.hasApi() && !(await provider.isConnected())) {
			return remote;
		}

		try {
			return await Container.git.getPullRequestForCommit(ref, remote, { timeout: 250 });
		} catch (ex) {
			if (ex instanceof Promises.CancellationError) {
				return ex;
			}
			return undefined;
		}
	}
}

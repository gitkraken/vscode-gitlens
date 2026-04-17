import type { CancellationToken, TextDocument } from 'vscode';
import { MarkdownString } from 'vscode';
import type { GitCommitLine } from '@gitlens/git/models/commit.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitLineDiff, ParsedGitDiffHunk } from '@gitlens/git/models/diff.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { deletedOrMissing, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { isUncommitted, isUncommittedStaged, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { escapeMarkdownCodeBlocks } from '@gitlens/utils/markdown.js';
import {
	getSettledValue,
	pauseOnCancelOrTimeout,
	pauseOnCancelOrTimeoutMapTuplePromise,
} from '@gitlens/utils/promise.js';
import type { EnrichedAutolink } from '../autolinks/models/autolinks.js';
import { DiffWithCommand } from '../commands/diffWith.js';
import { ShowQuickCommitCommand } from '../commands/showQuickCommit.js';
import type { GlCommands } from '../constants.commands.js';
import { GlyphChars } from '../constants.js';
import type { Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { CommitFormatter } from '../git/formatters/commitFormatter.js';
import { GitUri } from '../git/gitUri.js';
import {
	findCommitFile,
	getCommitAssociatedPullRequest,
	getCommitEnrichedAutolinks,
	getCommitPreviousComparisonUrisForRange,
	isCommitSigned,
} from '../git/utils/-webview/commit.utils.js';
import { isRemoteMaybeIntegrationConnected, remoteSupportsIntegration } from '../git/utils/-webview/remote.utils.js';
import { toAbortSignal } from '../system/-webview/cancellation.js';
import { configuration } from '../system/-webview/configuration.js';
import { editorLineToDiffRange } from '../system/-webview/vscode/range.js';

// Commands that are allowed to execute from markdown links in hovers
const trustedHoverCommands: (GlCommands | `gitlens.action.${string}`)[] = [
	'gitlens.action.hover.commands' satisfies GlCommands,
	'gitlens.action.openIssue' satisfies GlCommands,
	'gitlens.action.openPullRequest' satisfies GlCommands,
	'gitlens.ai.explainCommit:editor' satisfies GlCommands,
	'gitlens.ai.explainWip:editor' satisfies GlCommands,
	'gitlens.connectRemoteProvider' satisfies GlCommands,
	'gitlens.copyShaToClipboard' satisfies GlCommands,
	'gitlens.diffWith' satisfies GlCommands,
	'gitlens.inviteToLiveShare' satisfies GlCommands,
	'gitlens.openCommitOnRemote' satisfies GlCommands,
	'gitlens.openFileRevision' satisfies GlCommands,
	'gitlens.refreshHover' satisfies GlCommands,
	'gitlens.revealCommitInView' satisfies GlCommands,
	'gitlens.showCommitInView' satisfies GlCommands,
	'gitlens.showCommitsInView' satisfies GlCommands,
	'gitlens.showInCommitGraph' satisfies GlCommands,
	'gitlens.showQuickCommitDetails' satisfies GlCommands,
	'gitlens.showQuickCommitFileDetails' satisfies GlCommands,
];

export async function changesMessage(
	container: Container,
	commit: GitCommit,
	uri: GitUri,
	editorLine: number, // 0-based, Git is 1-based
	document: TextDocument,
	sourceName: Sources,
	blameLine?: GitCommitLine,
): Promise<MarkdownString | undefined> {
	const documentRev = uri.sha;

	let previousSha = null;

	async function getDiff() {
		if (commit.file == null) return undefined;

		const line = editorLine + 1;
		// Use the pre-resolved blame line when available (correctly remapped for dirty blame)
		const commitLine = blameLine ?? commit.lines.find(l => l.line === line) ?? commit.lines[0];

		// TODO: Figure out how to optimize this
		let ref;
		if (commit.isUncommitted) {
			if (isUncommittedStaged(documentRev)) {
				ref = documentRev;
			}
		} else {
			previousSha = commitLine.previousSha;
			ref = previousSha;
			if (ref == null) {
				return `\`\`\`diff\n+ ${escapeMarkdownCodeBlocks(document.lineAt(editorLine).text)}\n\`\`\``;
			}
		}

		editorLine = commitLine.line - 1;
		// TODO: Doesn't work with dirty files -- pass in editor? or contents?
		let lineDiff = await container.git.getDiffForLine(uri, editorLine, ref, documentRev);

		// If we didn't find a diff & ref is undefined (meaning uncommitted), check for a staged diff
		if (lineDiff == null && ref == null && documentRev !== uncommittedStaged) {
			lineDiff = await container.git.getDiffForLine(uri, editorLine, undefined, uncommittedStaged);
		}

		return lineDiff != null ? getDiffFromLine(lineDiff) : undefined;
	}

	const diff = await getDiff();
	if (diff == null) return undefined;

	const range = editorLineToDiffRange(editorLine);
	const telemetrySource = { source: sourceName } as const;

	let message;
	let previous;
	let current;
	if (commit.isUncommitted) {
		const compareUris = await getCommitPreviousComparisonUrisForRange(commit, range, documentRev);
		if (compareUris?.previous == null) return undefined;

		message = `[$(compare-changes)](${DiffWithCommand.createMarkdownCommandLink({
			lhs: { sha: compareUris.previous.sha ?? '', uri: compareUris.previous.uri },
			rhs: { sha: compareUris.current.sha ?? '', uri: compareUris.current.uri },
			repoPath: commit.repoPath,
			range: compareUris.range,
			source: telemetrySource,
		})} "Open Changes")`;

		previous =
			compareUris.previous.sha == null || isUncommitted(compareUris.previous.sha)
				? `  &nbsp;_${shortenRevision(compareUris.previous.sha, {
						strings: { working: 'Working Tree' },
					})}_ &nbsp;${GlyphChars.ArrowLeftRightLong}&nbsp; `
				: `  &nbsp;[$(git-commit) ${shortenRevision(
						compareUris.previous.sha || '',
					)}](${ShowQuickCommitCommand.createMarkdownCommandLink(compareUris.previous.sha || '', undefined, telemetrySource)} "Show Commit") &nbsp;${GlyphChars.ArrowLeftRightLong}&nbsp; `;

		current =
			compareUris.current.sha == null || isUncommitted(compareUris.current.sha)
				? `_${shortenRevision(compareUris.current.sha, { strings: { working: 'Working Tree' } })}_`
				: `[$(git-commit) ${shortenRevision(
						compareUris.current.sha || '',
					)}](${ShowQuickCommitCommand.createMarkdownCommandLink(compareUris.current.sha || '', undefined, telemetrySource)} "Show Commit")`;
	} else {
		message = `[$(compare-changes)](${DiffWithCommand.createMarkdownCommandLink(commit, range, telemetrySource)} "Open Changes")`;

		previousSha ??= await GitCommit.getPreviousSha(commit);
		if (previousSha && previousSha !== deletedOrMissing) {
			previous = `  &nbsp;[$(git-commit) ${shortenRevision(
				previousSha,
			)}](${ShowQuickCommitCommand.createMarkdownCommandLink(previousSha, undefined, telemetrySource)} "Show Commit") &nbsp;${
				GlyphChars.ArrowLeftRightLong
			}&nbsp;`;
		}

		current = `[$(git-commit) ${commit.shortSha}](${ShowQuickCommitCommand.createMarkdownCommandLink(
			commit.sha,
			undefined,
			telemetrySource,
		)} "Show Commit")`;
	}

	message = `${diff}\n---\n\nChanges${previous ?? ' added in '}${current} &nbsp;&nbsp;|&nbsp;&nbsp; ${message}`;

	const markdown = new MarkdownString(message, true);
	markdown.supportHtml = true;
	markdown.isTrusted = { enabledCommands: trustedHoverCommands };
	return markdown;
}

export async function localChangesMessage(
	fromCommit: GitCommit | undefined,
	uri: GitUri,
	editorLine: number, // 0-based, Git is 1-based
	hunk: ParsedGitDiffHunk,
	sourceName: Sources,
): Promise<MarkdownString | undefined> {
	const diff = getDiffFromHunk(hunk);

	let message;
	let previous;
	let current;
	if (fromCommit == null) {
		previous = '_Working Tree_';
		current = '_Unsaved_';
	} else {
		const file = await findCommitFile(fromCommit, uri);
		if (file == null) return undefined;

		const telemetrySource = { source: sourceName } as const;
		message = `[$(compare-changes)](${DiffWithCommand.createMarkdownCommandLink({
			lhs: {
				sha: fromCommit.sha,
				uri: GitUri.fromFile(file, uri.repoPath!, undefined, true).workingFileUri,
			},
			rhs: { sha: '', uri: uri.workingFileUri },
			repoPath: uri.repoPath!,
			range: editorLineToDiffRange(editorLine),
			source: telemetrySource,
		})} "Open Changes")`;

		previous = `[$(git-commit) ${fromCommit.shortSha}](${ShowQuickCommitCommand.createMarkdownCommandLink(
			fromCommit.sha,
			undefined,
			telemetrySource,
		)} "Show Commit")`;

		current = '_Working Tree_';
	}
	message = `${diff}\n---\n\nLocal Changes  &nbsp;${previous} &nbsp;${
		GlyphChars.ArrowLeftRightLong
	}&nbsp; ${current}${message == null ? '' : ` &nbsp;&nbsp;|&nbsp;&nbsp; ${message}`}`;

	const markdown = new MarkdownString(message, true);
	markdown.supportHtml = true;
	markdown.isTrusted = { enabledCommands: trustedHoverCommands };
	return markdown;
}

export async function detailsMessage(
	container: Container,
	commit: GitCommit,
	uri: GitUri,
	editorLine: number, // 0-based, Git is 1-based
	options: Readonly<{
		autolinks?: boolean;
		cancellation?: CancellationToken;
		dateFormat: string | null;
		enrichedAutolinks?: Promise<Map<string, EnrichedAutolink> | undefined> | undefined;
		format: string;
		getBranchAndTagTips?: (
			sha: string,
			options?: { compact?: boolean | undefined; icons?: boolean | undefined },
		) => string | undefined;
		pullRequest?: Promise<PullRequest | undefined> | PullRequest | undefined;
		pullRequests?: boolean;
		remotes?: GitRemote[];
		timeout?: number;
		sourceName: Sources;
	}>,
): Promise<MarkdownString | undefined> {
	const remotesResult = await pauseOnCancelOrTimeout(
		options?.remotes ?? container.git.getRepositoryService(commit.repoPath).remotes.getBestRemotesWithProviders(),
		toAbortSignal(options?.cancellation),
		options?.timeout,
	);

	let remotes: GitRemote[] | undefined;
	let remote: GitRemote | undefined;
	if (remotesResult.paused) {
		if (remotesResult.reason === 'cancelled') return undefined;
		// If we timed out, just continue without the remotes
	} else {
		remotes = remotesResult.value;
		[remote] = remotes;
	}

	const cfg = configuration.get('hovers');
	const enhancedAutolinks =
		options?.autolinks !== false &&
		(options?.autolinks || cfg.autolinks.enabled) &&
		cfg.autolinks.enhanced &&
		CommitFormatter.has(cfg.detailsMarkdownFormat, 'message');
	const prs =
		remote != null &&
		remoteSupportsIntegration(remote) &&
		isRemoteMaybeIntegrationConnected(remote) !== false &&
		(options?.pullRequests || (options?.pullRequests !== false && cfg.pullRequests.enabled)) &&
		CommitFormatter.has(
			options.format,
			'pullRequest',
			'pullRequestAgo',
			'pullRequestAgoOrDate',
			'pullRequestDate',
			'pullRequestState',
		);

	const showSignature =
		configuration.get('signing.showSignatureBadges') &&
		!commit.isUncommitted &&
		CommitFormatter.has(options.format, 'signature');

	const [
		enrichedAutolinksResult,
		prResult,
		presenceResult,
		previousLineComparisonUrisResult,
		_fullDetailsResult,
		signedResult,
	] = await Promise.allSettled([
		enhancedAutolinks
			? pauseOnCancelOrTimeoutMapTuplePromise(
					options?.enrichedAutolinks ??
						getCommitEnrichedAutolinks(commit.repoPath, commit.message, commit.summary, remote),
					toAbortSignal(options?.cancellation),
					options?.timeout,
				)
			: undefined,
		prs
			? pauseOnCancelOrTimeout(
					options?.pullRequest ?? getCommitAssociatedPullRequest(commit.repoPath, commit.sha, remote),
					toAbortSignal(options?.cancellation),
					options?.timeout,
				)
			: undefined,
		container.vsls.active
			? pauseOnCancelOrTimeout(
					container.vsls.getContactPresence(commit.author.email),
					toAbortSignal(options?.cancellation),
					Math.min(options?.timeout ?? 250, 250),
				)
			: undefined,
		commit.isUncommitted
			? getCommitPreviousComparisonUrisForRange(commit, editorLineToDiffRange(editorLine), uri.sha)
			: undefined,
		commit.message == null ? GitCommit.ensureFullDetails(commit) : undefined,
		showSignature ? isCommitSigned(commit.repoPath, commit.sha) : undefined,
	]);

	if (options?.cancellation?.isCancellationRequested) return undefined;

	const enrichedResult = getSettledValue(enrichedAutolinksResult);
	const pr = getSettledValue(prResult);
	const presence = getSettledValue(presenceResult);
	const previousLineComparisonUris = getSettledValue(previousLineComparisonUrisResult);
	const signed = getSettledValue(signedResult);

	const details = await CommitFormatter.fromTemplateAsync(
		options.format,
		commit,
		{ source: options.sourceName },
		{
			ai: { allowed: container.ai.allowed, enabled: container.ai.enabled },
			enrichedAutolinks:
				enrichedResult?.value != null && !enrichedResult.paused ? enrichedResult.value : undefined,
			dateFormat: options.dateFormat === null ? 'MMMM Do, YYYY h:mma' : options.dateFormat,
			editor: { line: editorLine, uri: uri },
			getBranchAndTagTips: options?.getBranchAndTagTips,
			messageAutolinks: options?.autolinks || (options?.autolinks !== false && cfg.autolinks.enabled),
			pullRequest: pr?.value,
			presence: presence?.value,
			previousLineComparisonUris: previousLineComparisonUris,
			outputFormat: 'markdown',
			remotes: remotes,
			signed: signed,
		},
	);

	const markdown = new MarkdownString(details, true);
	markdown.supportHtml = true;
	markdown.isTrusted = { enabledCommands: trustedHoverCommands };
	return markdown;
}

function getDiffFromHunk(hunk: ParsedGitDiffHunk): string {
	return `\`\`\`diff\n${escapeMarkdownCodeBlocks(hunk.content.trim())}\n\`\`\``;
}

function getDiffFromLine(lineDiff: GitLineDiff, diffStyle?: 'line' | 'hunk'): string {
	if (diffStyle === 'hunk' || (diffStyle == null && configuration.get('hovers.changesDiff') === 'hunk')) {
		return getDiffFromHunk(lineDiff.hunk);
	}

	return `\`\`\`diff${
		lineDiff.line.previous == null ? '' : `\n- ${escapeMarkdownCodeBlocks(lineDiff.line.previous.trim())}`
	}${lineDiff.line.current == null ? '' : `\n+ ${escapeMarkdownCodeBlocks(lineDiff.line.current.trim())}`}\n\`\`\``;
}

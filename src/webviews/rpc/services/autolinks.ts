/**
 * Autolinks service — shared commit autolink operations for webviews.
 *
 * Handles both basic autolink parsing and enriched autolink resolution
 * (issues/PRs via integration APIs). Returns serialized data + linkified
 * commit messages.
 *
 * Message formatting produces linkified HTML. Callers that need a headline
 * splitter token (e.g., Commit Details) pass it via `headlineSplitterToken`
 * so it's inserted into the plain-text message *before* linkification.
 * This is critical because post-processing linkified HTML with plain-text
 * assumptions (e.g., splitting on first `\n`) produces broken HTML.
 */

import type { Autolink, MaybeEnrichedAutolink } from '../../../autolinks/models/autolinks.js';
import { serializeAutolink } from '../../../autolinks/utils/-webview/autolinks.utils.js';
import type { Container } from '../../../container.js';
import { CommitFormatter } from '../../../git/formatters/commitFormatter.js';
import type { GitCommit } from '../../../git/models/commit.js';
import type { IssueOrPullRequest } from '../../../git/models/issueOrPullRequest.js';
import type { GitRemote } from '../../../git/models/remote.js';
import { serializeIssueOrPullRequest } from '../../../git/utils/issueOrPullRequest.utils.js';
import { filterMap, map } from '../../../system/iterable.js';
import { pauseOnCancelOrTimeoutMapTuplePromise } from '../../../system/promise.js';

// ============================================================
// Result Types
// ============================================================

/** Result of basic autolink parsing. */
export interface CommitAutolinksResult {
	autolinks: Autolink[];
	formattedMessage: string;
}

/** Result of enriched autolink resolution (issues/PRs from integration APIs). */
export interface EnrichedAutolinksResult {
	autolinkedIssues: IssueOrPullRequest[];
	formattedMessage: string;
}

// ============================================================
// Service
// ============================================================

export class AutolinksService {
	constructor(private readonly container: Container) {}

	/**
	 * Get basic autolinks parsed from a commit message.
	 * Resolves remote for URL patterns; does NOT call enrichment APIs.
	 * Returns parsed autolinks and the commit message linkified as HTML.
	 *
	 * @param headlineSplitterToken — If provided, inserted at the first newline in the
	 *   plain-text message *before* linkification so callers can split headline from body.
	 */
	async getCommitAutolinks(
		repoPath: string,
		sha: string,
		headlineSplitterToken?: string,
	): Promise<CommitAutolinksResult | undefined> {
		const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha);
		if (commit == null) return undefined;

		const remote = await this.container.git
			.getRepositoryService(commit.repoPath)
			.remotes.getBestRemoteWithIntegration({ includeDisconnected: true });

		const autolinks =
			commit.message != null ? await this.container.autolinks.getAutolinks(commit.message, remote) : undefined;

		return {
			autolinks: autolinks != null ? [...map(autolinks.values(), serializeAutolink)] : [],
			formattedMessage: linkifyMessage(this.container, commit, remote, undefined, headlineSplitterToken),
		};
	}

	/**
	 * Get enriched autolinks — resolved issues/PRs from commit message via integration APIs.
	 * Returns serialized issues and the commit message linkified with enriched data.
	 * Requires an active remote integration.
	 *
	 * @param headlineSplitterToken — If provided, inserted at the first newline in the
	 *   plain-text message *before* linkification so callers can split headline from body.
	 */
	async getEnrichedAutolinks(
		repoPath: string,
		sha: string,
		headlineSplitterToken?: string,
	): Promise<EnrichedAutolinksResult | undefined> {
		const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha);
		if (commit == null) return undefined;

		const remote = await this.container.git
			.getRepositoryService(commit.repoPath)
			.remotes.getBestRemoteWithIntegration({ includeDisconnected: true });
		if (remote?.provider == null) return undefined;

		const result = await pauseOnCancelOrTimeoutMapTuplePromise(commit.getEnrichedAutolinks(remote));
		const enrichedAutolinks = result?.value;

		const issues =
			enrichedAutolinks != null
				? [
						...filterMap(enrichedAutolinks.values(), ([issueOrPullRequest]) =>
							issueOrPullRequest?.value != null
								? serializeIssueOrPullRequest(issueOrPullRequest.value)
								: undefined,
						),
					]
				: [];

		return {
			autolinkedIssues: issues,
			formattedMessage: linkifyMessage(this.container, commit, remote, enrichedAutolinks, headlineSplitterToken),
		};
	}
}

// ============================================================
// Helpers
// ============================================================

/**
 * Linkify a commit message with autolink patterns as HTML.
 * If `headlineSplitterToken` is provided, it replaces the first newline in the
 * plain-text message before linkification so the token survives HTML processing.
 */
function linkifyMessage(
	container: Container,
	commit: GitCommit,
	remote: GitRemote | undefined,
	enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
	headlineSplitterToken?: string,
): string {
	let message = CommitFormatter.fromTemplate(`\${message}`, commit);
	if (headlineSplitterToken != null) {
		const index = message.indexOf('\n');
		if (index !== -1) {
			message = `${message.substring(0, index)}${headlineSplitterToken}${message.substring(index + 1)}`;
		}
	}
	return container.autolinks.linkify(message, 'html', remote != null ? [remote] : undefined, enrichedAutolinks);
}

/**
 * Autolinks service — shared commit autolink operations for webviews.
 *
 * Handles both basic autolink parsing and enriched autolink resolution
 * (issues/PRs via integration APIs). Returns serialized data + linkified
 * commit messages.
 *
 * Message formatting produces linkified markdown. Callers that need a headline
 * splitter token (e.g., Commit Details) pass it via `headlineSplitterToken`
 * so it's inserted into the plain-text message *before* linkification.
 * This is critical because post-processing linkified output with plain-text
 * assumptions (e.g., splitting on first `\n`) produces broken markup.
 */

import type { GitCommit } from '@gitlens/git/models/commit.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { serializeIssueOrPullRequest } from '@gitlens/git/utils/issueOrPullRequest.utils.js';
import { map } from '@gitlens/utils/iterable.js';
import { encodeHtmlWeak } from '@gitlens/utils/string.js';
import type { Autolink, EnrichedAutolink, MaybeEnrichedAutolink } from '../../../autolinks/models/autolinks.js';
import { serializeAutolink } from '../../../autolinks/utils/-webview/autolinks.utils.js';
import type { Container } from '../../../container.js';
import { CommitFormatter } from '../../../git/formatters/commitFormatter.js';
import { getBranchEnrichedAutolinks } from '../../../git/utils/-webview/branch.utils.js';
import { getCommitEnrichedAutolinks } from '../../../git/utils/-webview/commit.utils.js';
import { getBestRemoteWithIntegration } from '../../../git/utils/-webview/remote.utils.js';
import type { OverviewBranchIssue } from '../../shared/overviewBranches.js';
import { getAutolinkIssuesInfo } from '../../shared/overviewEnrichment.utils.js';

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

	private async getCommit(repoPath: string, sha: string, isStash?: boolean): Promise<GitCommit | undefined> {
		const svc = this.container.git.getRepositoryService(repoPath);
		if (isStash) {
			const stash = await svc.stash?.getStash();
			const commit = stash?.stashes.get(sha);
			if (commit != null) return commit;
		}
		return svc.commits.getCommit(sha);
	}

	/**
	 * Get basic autolinks parsed from a commit message.
	 * Resolves remote for URL patterns; does NOT call enrichment APIs.
	 * Returns parsed autolinks and the commit message linkified as markdown.
	 *
	 * @param headlineSplitterToken — If provided, inserted at the first newline in the
	 *   plain-text message *before* linkification so callers can split headline from body.
	 */
	async getCommitAutolinks(
		repoPath: string,
		sha: string,
		headlineSplitterToken?: string,
		isStash?: boolean,
	): Promise<CommitAutolinksResult | undefined> {
		const commit = await this.getCommit(repoPath, sha, isStash);
		if (commit == null) return undefined;

		const remote = await getBestRemoteWithIntegration(commit.repoPath, { includeDisconnected: true });

		const autolinks =
			commit.message != null ? await this.container.autolinks.getAutolinks(commit.message, remote) : undefined;

		return {
			autolinks: autolinks != null ? [...map(autolinks.values(), serializeAutolink)] : [],
			formattedMessage: linkifyMessage(this.container, commit, remote, undefined, headlineSplitterToken),
		};
	}

	/**
	 * Get basic autolinks parsed from multiple commits' messages in a single pass.
	 * Fetches each commit's message server-side, aggregates them, and parses autolinks once.
	 * Does NOT produce a formatted/linkified message — returns only the parsed autolinks.
	 */
	async getAutolinksForCommits(repoPath: string, shas: string[]): Promise<Autolink[]> {
		const svc = this.container.git.getRepositoryService(repoPath);
		const commits = await Promise.all(shas.map(sha => svc.commits.getCommit(sha)));
		const messages = commits.map(c => c?.message).filter(m => m != null);
		if (!messages.length) return [];

		const remote = await getBestRemoteWithIntegration(repoPath, { includeDisconnected: true });
		const autolinks = await this.container.autolinks.getAutolinks(messages.join('\n'), remote);
		return [...map(autolinks.values(), serializeAutolink)];
	}

	/**
	 * Enrich autolinks for multiple commits — resolve issues/PRs from integration APIs.
	 * Fetches each commit's message server-side, aggregates them, and resolves enriched data.
	 * Returns serialized issues/PRs found across all commits.
	 */
	async enrichAutolinksForCommits(repoPath: string, shas: string[]): Promise<IssueOrPullRequest[]> {
		const svc = this.container.git.getRepositoryService(repoPath);
		const commits = await Promise.all(shas.map(sha => svc.commits.getCommit(sha)));
		const messages = commits.map(c => c?.message).filter(m => m != null);
		if (!messages.length) return [];

		const remote = await getBestRemoteWithIntegration(repoPath);
		if (remote?.provider == null) return [];

		const enrichedAutolinks = await this.container.autolinks.getEnrichedAutolinks(messages.join('\n'), remote);
		if (enrichedAutolinks == null) return [];

		const issues: IssueOrPullRequest[] = [];
		for (const [promise] of enrichedAutolinks.values()) {
			const issueOrPullRequest = await promise;
			if (issueOrPullRequest != null) {
				issues.push(serializeIssueOrPullRequest(issueOrPullRequest));
			}
		}
		return issues;
	}

	/**
	 * Get enriched autolinks derived from a branch's name.
	 * Resolves each matched issue/PR via integration APIs and returns the
	 * serialized `OverviewBranchIssue[]` shape that webviews already consume.
	 */
	async getBranchAutolinks(repoPath: string, branchName: string): Promise<OverviewBranchIssue[]> {
		const svc = this.container.git.getRepositoryService(repoPath);
		const branch = await svc.branches.getBranch(branchName);
		if (branch == null) return [];

		const enriched = await getBranchEnrichedAutolinks(this.container, branch);
		return getAutolinkIssuesInfo(enriched);
	}

	/**
	 * Get enriched autolinks — resolved issues/PRs from commit message via integration APIs.
	 * Returns serialized issues and the commit message linkified as markdown with enriched data.
	 * Requires an active remote integration.
	 *
	 * @param headlineSplitterToken — If provided, inserted at the first newline in the
	 *   plain-text message *before* linkification so callers can split headline from body.
	 */
	async getEnrichedAutolinks(
		repoPath: string,
		sha: string,
		headlineSplitterToken?: string,
		isStash?: boolean,
	): Promise<EnrichedAutolinksResult | undefined> {
		const commit = await this.getCommit(repoPath, sha, isStash);
		if (commit == null) return undefined;

		const remote = await getBestRemoteWithIntegration(commit.repoPath, { includeDisconnected: true });
		if (remote?.provider == null) return undefined;

		const enrichedAutolinks = await getCommitEnrichedAutolinks(
			commit.repoPath,
			commit.message,
			commit.summary,
			remote,
		);

		// Resolve all the inner issue/PR promises from the enriched autolinks
		const issues: IssueOrPullRequest[] = [];
		if (enrichedAutolinks != null) {
			for (const [promise] of enrichedAutolinks.values()) {
				const issueOrPullRequest = await promise;
				if (issueOrPullRequest != null) {
					issues.push(serializeIssueOrPullRequest(issueOrPullRequest));
				}
			}
		}

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
 * Linkify a commit message with autolink patterns as markdown.
 * If `headlineSplitterToken` is provided, it replaces the first newline in the
 * plain-text message before linkification so the token survives markdown processing.
 */
function linkifyMessage(
	container: Container,
	commit: GitCommit,
	remote: GitRemote | undefined,
	enrichedAutolinks?: Map<string, EnrichedAutolink | MaybeEnrichedAutolink>,
	headlineSplitterToken?: string,
): string {
	let message = CommitFormatter.fromTemplate(`\${message}`, commit);
	// Encode HTML entities for safety before markdown linkification — prevents raw HTML
	// in commit messages from being rendered (e.g. <script>, <span onclick>).
	// The marked library won't double-encode existing entities.
	message = encodeHtmlWeak(message);
	if (headlineSplitterToken != null) {
		const index = message.indexOf('\n');
		if (index !== -1) {
			message = `${message.substring(0, index)}${headlineSplitterToken}${message.substring(index + 1)}`;
		}
	}
	return container.autolinks.linkify(
		message,
		'markdown',
		remote != null ? [remote] : undefined,
		enrichedAutolinks as Map<string, MaybeEnrichedAutolink> | undefined,
	);
}

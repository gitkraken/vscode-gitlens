/**
 * Shared commit-enrichment fan-out for webview panels (graph details + commit details).
 *
 * Both panels need to fire the same parallel quartet of RPC calls — basic autolinks,
 * enriched autolinks, pull request, signature — for a given (repoPath, sha). They differ
 * only in (a) signal-name conventions on each panel's state and (b) whether a per-SHA
 * resolved-value cache is in play. Caching is panel-local because cache shapes differ;
 * the orchestration of "fan out, guard against stale generations, honor abort signals,
 * suppress AbortError rejection" is the same.
 *
 * This module owns the shared orchestration. Each panel implements `CommitEnrichmentSink`
 * to wire the resolved values into its own state (and optionally its own cache) and passes
 * that sink in. State writes and cache writes stay panel-local.
 */
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { Autolink } from '../../../../autolinks/models/autolinks.js';
import type { CommitDetails, CommitSignatureShape } from '../../../commitDetails/protocol.js';
import { messageHeadlineSplitterToken } from '../../../commitDetails/protocol.js';
import type { CommitAvatarsShape } from '../../../rpc/services/types.js';
import type { Resource } from '../state/resource.js';
import { guardedEnrich } from './rpc.js';

/** Result shape returned by `services.autolinks.getCommitAutolinks`. */
export interface CommitAutolinksResult {
	autolinks: Autolink[];
	formattedMessage: string;
}

/** Result shape returned by `services.autolinks.getEnrichedAutolinks`. */
export interface EnrichedAutolinksResult {
	autolinkedIssues: IssueOrPullRequest[];
	formattedMessage: string;
}

/**
 * Subset of webview RPC services this module needs. Defined structurally so the module
 * doesn't depend on the concrete service classes — any object with these method shapes works.
 */
export interface CommitEnrichmentServices {
	autolinks: {
		getCommitAutolinks: (
			repoPath: string,
			sha: string,
			headlineSplitterToken?: string,
			isStash?: boolean,
			signal?: AbortSignal,
		) => Promise<CommitAutolinksResult | undefined>;
		getEnrichedAutolinks: (
			repoPath: string,
			sha: string,
			headlineSplitterToken?: string,
			isStash?: boolean,
			signal?: AbortSignal,
		) => Promise<EnrichedAutolinksResult | undefined>;
	};
	pullRequests: {
		getPullRequestForCommit: (
			repoPath: string,
			sha: string,
			signal?: AbortSignal,
		) => Promise<PullRequestShape | undefined>;
	};
	repository: {
		getCommitSignature: (
			repoPath: string,
			sha: string,
			signal?: AbortSignal,
		) => Promise<CommitSignatureShape | undefined>;
		getCommitAvatars: (
			repoPath: string,
			sha: string,
			authorEmail: string | undefined,
			committerEmail: string | undefined,
			signal?: AbortSignal,
		) => Promise<CommitAvatarsShape | undefined>;
		getReachableFromOtherWorktrees: (repoPath: string, sha: string, signal?: AbortSignal) => Promise<boolean>;
	};
}

/**
 * Panel-local sink that receives resolved enrichment values. Implementers are responsible
 * for writing them to whatever state signals and caches are appropriate for the panel —
 * those concerns are deliberately panel-local because shapes differ.
 *
 * Each method is called at most once per `fetchCommitEnrichment` invocation (the underlying
 * generation guard + signal abort drop late callbacks).
 *
 * `setBasicAutolinks` and `setEnrichedAutolinks` are split because they arrive from
 * different RPC calls. Both carry a `formattedMessage`; the enriched variant overrides
 * because it includes resolved issue titles in tooltips.
 */
export interface CommitEnrichmentSink {
	setBasicAutolinks(autolinks: Autolink[], formattedMessage: string): void;
	setEnrichedAutolinks(issues: IssueOrPullRequest[], formattedMessage: string): void;
	setPullRequest(value: PullRequestShape | undefined): void;
	setSignature(value: CommitSignatureShape | undefined): void;
	/** Provider-resolved avatars, upgrading the synchronous cached-or-gravatar ones in the core payload. */
	setAvatars(value: CommitAvatarsShape): void;
	setReachableFromOtherWorktrees(value: boolean): void;
}

/**
 * Carries the enriched fields — provider avatars and worktree reachability — forward from an already
 * enriched shell for the same sha onto a freshly-fetched core payload. The core payload is deliberately
 * un-enriched (a synchronous cached-or-gravatar avatar, no worktree flag), so without this a revisit
 * would visibly downgrade a commit we'd already enriched while the legs re-run and re-patch it.
 *
 * `knownReachable` wins over the cached value: it's derived from the *current* graph state, whereas the
 * cached flag could predate a worktree moving.
 */
export function withCachedEnrichment(
	commit: CommitDetails,
	cached: CommitDetails | undefined,
	knownReachable?: true,
): CommitDetails {
	const reachable = knownReachable ?? cached?.reachableFromOtherWorktrees;
	const authorAvatar = cached?.author.avatar ?? commit.author.avatar;
	const committerAvatar = cached?.committer.avatar ?? commit.committer.avatar;

	if (
		reachable === commit.reachableFromOtherWorktrees &&
		authorAvatar === commit.author.avatar &&
		committerAvatar === commit.committer.avatar
	) {
		return commit;
	}

	return {
		...commit,
		author: { ...commit.author, avatar: authorAvatar },
		committer: { ...commit.committer, avatar: committerAvatar },
		reachableFromOtherWorktrees: reachable,
	};
}

/**
 * Fire the chip-enrichment quartet for a commit in parallel. Each call:
 *   - Is guarded against the resource's generation changing (drops stale callbacks).
 *   - Honors the supplied `AbortSignal` (drops callbacks once the panel-level enrichment
 *     signal aborts; the host-side methods propagate the signal too, so abandoned work
 *     stops at the next `signal?.throwIfAborted()` boundary instead of running to completion).
 *   - Suppresses `AbortError` rejections silently via `noopUnlessReal`.
 *
 * Autolinks calls (basic + enriched) are gated on `args.autolinksEnabled`. PR and signature
 * always fire. Avatars and worktree reachability skip when they can't apply (see `args`).
 */
export function fetchCommitEnrichment(
	services: CommitEnrichmentServices,
	resource: Pick<Resource<unknown>, 'generationId'>,
	signal: AbortSignal,
	args: {
		repoPath: string;
		sha: string;
		isStash: boolean;
		isUncommitted: boolean;
		autolinksEnabled: boolean;
		avatarsEnabled: boolean;
		authorEmail: string | undefined;
		committerEmail: string | undefined;
		/** Set when the caller already knows the commit is reachable from a sibling worktree (the Graph
		 *  derives it for free from its reachability table), so the git-backed check can be skipped. */
		knownReachableFromOtherWorktrees?: boolean;
		/** Defaults to `messageHeadlineSplitterToken` from `commitDetails/protocol.ts`. */
		headlineSplitterToken?: string;
	},
	sink: CommitEnrichmentSink,
): void {
	const { repoPath, sha, isStash, isUncommitted, autolinksEnabled, avatarsEnabled } = args;
	const { authorEmail, committerEmail, knownReachableFromOtherWorktrees } = args;
	const headlineSplitterToken = args.headlineSplitterToken ?? messageHeadlineSplitterToken;
	const skipWhenAutolinksDisabled = () => !autolinksEnabled;

	guardedEnrich(
		resource,
		signal,
		() => services.autolinks.getCommitAutolinks(repoPath, sha, headlineSplitterToken, isStash, signal),
		r => {
			if (r == null) return;

			sink.setBasicAutolinks(r.autolinks, r.formattedMessage);
		},
		{ skipIf: skipWhenAutolinksDisabled },
	);

	guardedEnrich(
		resource,
		signal,
		() => services.autolinks.getEnrichedAutolinks(repoPath, sha, headlineSplitterToken, isStash, signal),
		r => {
			if (r == null) return;

			sink.setEnrichedAutolinks(r.autolinkedIssues, r.formattedMessage);
		},
		{ skipIf: skipWhenAutolinksDisabled },
	);

	guardedEnrich(
		resource,
		signal,
		() => services.pullRequests.getPullRequestForCommit(repoPath, sha, signal),
		pr => sink.setPullRequest(pr),
	);

	guardedEnrich(
		resource,
		signal,
		() => services.repository.getCommitSignature(repoPath, sha, signal),
		sig => sink.setSignature(sig),
	);

	guardedEnrich(
		resource,
		signal,
		() => services.repository.getCommitAvatars(repoPath, sha, authorEmail, committerEmail, signal),
		avatars => {
			if (avatars == null) return;

			sink.setAvatars(avatars);
		},
		// The uncommitted pseudo-commit's sha can't exist on a provider, so a lookup only burns retries
		// against the avatar cache entry — the core payload's synchronous avatar is what we'd end up with.
		{ skipIf: () => !avatarsEnabled || isUncommitted || !authorEmail },
	);

	guardedEnrich(
		resource,
		signal,
		() => services.repository.getReachableFromOtherWorktrees(repoPath, sha, signal),
		reachable => sink.setReachableFromOtherWorktrees(reachable),
		{ skipIf: () => isStash || isUncommitted || knownReachableFromOtherWorktrees === true },
	);
}

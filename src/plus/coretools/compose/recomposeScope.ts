import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import { getBranchMergeTargetName } from '../../../git/utils/-webview/branch.utils.js';
import { getBranchCommits } from '../../../webviews/plus/composer/utils/composer.utils.js';

export interface RecomposeScopeRequest {
	branchName?: string;
	/** Explicit range; `base` is EXCLUSIVE (parent of the first rewritten commit), `head` INCLUSIVE.
	 *  Mirrors ComposerCommandArgs.range. */
	range?: { base: string; head: string };
	/** Selected commits; expanded to the covering range ending at HEAD. */
	commitShas?: string[];
	/** Carry working-tree changes into the recompose (default false for recompose entries). */
	includeWip?: boolean;
}

export type ResolvedRecomposeScope =
	| {
			ok: true;
			branchName: string;
			headSha: string;
			/** Child-first (HEAD-first) covering commit range ending at HEAD; becomes scope.includeShas downstream. */
			shas: string[];
			includeWip: boolean;
			/** true when a commitShas sub-selection was widened to its covering range. */
			expandedFromSelection: boolean;
	  }
	| { ok: false; reason: 'detached' | 'not-checked-out' | 'not-contiguous' | 'empty' | 'not-found'; message: string };

/** Validate that every candidate lies within `rangeShas` (a child-first log of `base..HEAD`), and
 *  return the whole log as the covering range — commits between and above candidates are folded in. */
export function coverRangeFromHead(
	rangeShas: readonly string[],
	candidates: ReadonlySet<string>,
): { ok: true; shas: string[]; expanded: boolean } | { ok: false; reason: 'empty' | 'not-contiguous' } {
	if (candidates.size === 0) return { ok: false, reason: 'empty' };

	let covered = 0;
	for (const sha of rangeShas) {
		if (candidates.has(sha)) {
			covered++;
		}
	}
	// A candidate missing from the range log is not reachable from HEAD above the range base
	// (e.g. a commit on an unrelated branch).
	if (covered !== candidates.size) return { ok: false, reason: 'not-contiguous' };

	return { ok: true, shas: [...rangeShas], expanded: rangeShas.length > candidates.size };
}

export type CoveredRangeFromHead =
	| { ok: true; shas: string[]; expanded: boolean; baseParentSha: string | undefined }
	| { ok: false; reason: 'empty' | 'not-contiguous' | 'not-found'; message: string };

/** Expand `candidates` to the covering commit range ending at HEAD (child-first). Candidates may
 *  sit anywhere in the DAG (e.g. merge side-branch commits); the covering range is
 *  `parent(base)..HEAD` for a base candidate whose log contains every candidate. */
export async function coverRangeEndingAtHead(
	svc: GitRepositoryService,
	headSha: string,
	candidates: ReadonlySet<string>,
): Promise<CoveredRangeFromHead> {
	if (candidates.size === 0) return { ok: false, reason: 'empty', message: 'No commits to recompose' };

	// Normalize to canonical shas and capture first parents to identify base candidates.
	const firstParents = new Map<string, string | undefined>();
	for (const sha of candidates) {
		const commit = await svc.commits.getCommit(sha);
		if (commit == null) return { ok: false, reason: 'not-found', message: `Commit '${sha}' was not found` };
		firstParents.set(commit.sha, commit.parents[0]);
	}

	// A base candidate is a selected commit whose first parent is outside the selection; the
	// range is valid when one base's parent-exclusive log from HEAD covers every candidate.
	const normalized = new Set(firstParents.keys());
	for (const [, parentSha] of firstParents) {
		if (parentSha != null && normalized.has(parentSha)) continue;

		const log = await svc.commits.getLog(parentSha != null ? `${parentSha}..${headSha}` : headSha, {
			limit: 0,
		});
		const covered = coverRangeFromHead([...(log?.commits.keys() ?? [])], normalized);
		if (covered.ok) return { ...covered, baseParentSha: parentSha };
	}

	return {
		ok: false,
		reason: 'not-contiguous',
		message: 'Selected commits do not form a commit range ending at HEAD',
	};
}

/** Turn a caller's recompose request into a validated covering commit range ending at HEAD. */
export async function resolveRecomposeScope(
	container: Container,
	svc: GitRepositoryService,
	request: RecomposeScopeRequest,
): Promise<ResolvedRecomposeScope> {
	const branch = await svc.branches.getBranch();
	if (branch == null || branch.detached || branch.remote) {
		return { ok: false, reason: 'detached', message: 'Recompose requires a local checked-out branch' };
	}

	const headCommit = await svc.commits.getCommit('HEAD');
	if (headCommit == null) {
		return { ok: false, reason: 'not-found', message: 'Unable to resolve HEAD' };
	}

	const headSha = headCommit.sha;

	if (request.branchName != null && request.branchName !== branch.name) {
		return {
			ok: false,
			reason: 'not-checked-out',
			message: `Recompose ranges must end at the checked-out branch '${branch.name}', not '${request.branchName}'`,
		};
	}

	if (request.range != null) {
		if (request.range.head !== headSha) {
			return {
				ok: false,
				reason: 'not-checked-out',
				message: 'Recompose range must end at HEAD of the checked-out branch',
			};
		}

		// An explicit range is already HEAD-anchored — its log IS the covering range.
		const log = await svc.commits.getLog(`${request.range.base}..${request.range.head}`, { limit: 0 });
		const shas = [...(log?.commits.keys() ?? [])];
		if (shas.length === 0) {
			return { ok: false, reason: 'empty', message: 'No commits to recompose' };
		}

		return {
			ok: true,
			branchName: branch.name,
			headSha: headSha,
			shas: shas,
			includeWip: request.includeWip ?? false,
			expandedFromSelection: false,
		};
	}

	let candidates: ReadonlySet<string>;
	if (request.commitShas?.length) {
		candidates = new Set(request.commitShas);
	} else {
		const repo = svc.getRepository();
		if (repo == null) {
			return { ok: false, reason: 'not-found', message: 'Unable to resolve repository for recompose' };
		}

		// Single-level merge-target resolution (v1); composerWebview's recursive walk is a later enhancement.
		const mergeTargetResult = await getBranchMergeTargetName(container, branch);
		const mergeTargetName = !mergeTargetResult.paused ? mergeTargetResult.value : undefined;
		const branchData = await getBranchCommits(container, repo, branch.name, mergeTargetName);
		if (!branchData?.commits.length) {
			return {
				ok: false,
				reason: 'empty',
				message: `Could not identify unique commits for branch '${branch.name}'`,
			};
		}

		candidates = new Set(branchData.commits.map(c => c.sha));
	}

	const covered = await coverRangeEndingAtHead(svc, headSha, candidates);
	if (!covered.ok) {
		return { ok: false, reason: covered.reason, message: covered.message };
	}

	return {
		ok: true,
		branchName: branch.name,
		headSha: headSha,
		shas: covered.shas,
		includeWip: request.includeWip ?? false,
		expandedFromSelection: covered.expanded,
	};
}

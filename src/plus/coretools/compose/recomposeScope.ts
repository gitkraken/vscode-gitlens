import type { GitCommit } from '@gitlens/git/models/commit.js';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import { getBranchMergeTargetName } from '../../../git/utils/-webview/branch.utils.js';
import { getBranchCommits } from '../../../webviews/plus/composer/utils/composer.utils.js';

export interface RecomposeScopeRequest {
	branchName?: string;
	/** Explicit range; `base` is EXCLUSIVE (parent of the first rewritten commit), `head` INCLUSIVE.
	 *  Mirrors ComposerCommandArgs.range. */
	range?: { base: string; head: string };
	/** Selected commits; expanded to the covering contiguous range oldest→HEAD. */
	commitShas?: string[];
	/** Carry working-tree changes into the recompose (default false for recompose entries). */
	includeWip?: boolean;
}

export type ResolvedRecomposeScope =
	| {
			ok: true;
			branchName: string;
			headSha: string;
			/** Child-first (HEAD-first) contiguous first-parent range; becomes scope.includeShas downstream. */
			shas: string[];
			includeWip: boolean;
			/** true when a commitShas sub-selection was widened to its covering range. */
			expandedFromSelection: boolean;
	  }
	| { ok: false; reason: 'detached' | 'not-checked-out' | 'not-contiguous' | 'empty' | 'not-found'; message: string };

/** Validate that `candidates` all lie on the first-parent chain from HEAD, and return the covering
 *  range HEAD→oldest-candidate (child-first). `firstParentChain` is the first-parent walk from HEAD
 *  (index 0 = HEAD) extended at least as far as the oldest candidate. */
export function coverContiguousFromHead(
	firstParentChain: readonly string[],
	candidates: ReadonlySet<string>,
): { ok: true; shas: string[]; expanded: boolean } | { ok: false; reason: 'empty' | 'not-contiguous' } {
	if (candidates.size === 0) return { ok: false, reason: 'empty' };

	// Greatest chain index covered by a candidate, plus a count to verify every candidate is on the chain.
	let maxIndex = -1;
	let onChain = 0;
	for (let i = 0; i < firstParentChain.length; i++) {
		if (candidates.has(firstParentChain[i])) {
			maxIndex = i;
			onChain++;
		}
	}
	// A candidate missing from the chain is off the first-parent line (e.g. a merge side-branch commit).
	if (onChain !== candidates.size) return { ok: false, reason: 'not-contiguous' };

	// Fill any gaps within the covered prefix — that's the "covering range" semantics.
	const shas = firstParentChain.slice(0, maxIndex + 1);
	return { ok: true, shas: shas, expanded: shas.length > candidates.size };
}

/** Turn a caller's recompose request into a validated, contiguous first-parent sha set ending at HEAD. */
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

	let candidates: Set<string>;
	let fromRange = false;

	if (request.range != null) {
		fromRange = true;
		if (request.range.head !== headSha) {
			return {
				ok: false,
				reason: 'not-checked-out',
				message: 'Recompose range must end at HEAD of the checked-out branch',
			};
		}

		const log = await svc.commits.getLog(`${request.range.base}..${request.range.head}`, { limit: 0 });
		candidates = new Set(log?.commits.keys() ?? []);
	} else if (request.commitShas?.length) {
		// Resolve each selected sha so we can normalize to its canonical form and detect not-found entries.
		const resolved: string[] = [];
		for (const sha of request.commitShas) {
			const commit = await svc.commits.getCommit(sha);
			if (commit == null) {
				return { ok: false, reason: 'not-found', message: `Commit '${sha}' was not found` };
			}

			resolved.push(commit.sha);
		}
		candidates = new Set(resolved);
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

	// Walk first-parent from HEAD (child-first), stopping once every candidate has been seen or root is reached.
	const remaining = new Set(candidates);
	const firstParentChain: string[] = [];
	let cursor: GitCommit | undefined = headCommit;
	while (cursor != null) {
		firstParentChain.push(cursor.sha);
		remaining.delete(cursor.sha);
		if (remaining.size === 0) break;

		const parentSha: string | undefined = cursor.parents[0];
		if (parentSha == null) break;

		cursor = await svc.commits.getCommit(parentSha);
	}

	const covered = coverContiguousFromHead(firstParentChain, candidates);
	if (!covered.ok) {
		const message =
			covered.reason === 'empty'
				? 'No commits to recompose'
				: 'Selected commits are not a contiguous first-parent range from HEAD';
		return { ok: false, reason: covered.reason, message: message };
	}

	return {
		ok: true,
		branchName: branch.name,
		headSha: headSha,
		shas: covered.shas,
		includeWip: request.includeWip ?? false,
		expandedFromSelection: fromRange ? false : covered.expanded,
	};
}

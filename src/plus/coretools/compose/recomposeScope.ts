import type { GitCommit } from '@gitlens/git/models/commit.js';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { getBranchMergeTargetName } from '../../../git/utils/-webview/branch.utils.js';

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
			/** Covering commit range ending at HEAD, child-first (HEAD-first) with the range-base
			 *  boundary commit last; becomes scope.includeShas downstream. */
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
	| { ok: true; shas: string[]; expanded: boolean; baseSha: string; baseParentSha: string | undefined }
	| { ok: false; reason: 'empty' | 'not-contiguous' | 'not-found'; message: string };

/** Expand `candidates` to the covering commit range ending at HEAD. Candidates may sit anywhere in
 *  the DAG (e.g. merge side-branch commits); the covering range is `parent(baseSha)..HEAD` for the
 *  base candidate producing the smallest covering log — deterministic and minimal, so a wider
 *  boundary commit (e.g. a side branch forked below the range base) can't silently pull older
 *  history into the rewrite. `shas` are child-first with `baseSha` guaranteed last, so
 *  order-sensitive consumers can anchor the rewrite base at `shas.at(-1)`. */
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

	// A base candidate is a selected commit whose first parent is outside the selection; the range
	// is valid when a base's parent-exclusive log from HEAD covers every candidate. Multiple
	// candidates can cover (merge side branches forked below the range base), so evaluate all and
	// keep the minimal covering log. `topo` ordering keeps the log child-before-parent even when
	// commit dates are skewed.
	const normalized = new Set(firstParents.keys());
	let best: { shas: string[]; baseSha: string; baseParentSha: string | undefined } | undefined;
	for (const [sha, parentSha] of firstParents) {
		if (parentSha != null && normalized.has(parentSha)) continue;

		const log = await svc.commits.getLog(parentSha != null ? `${parentSha}..${headSha}` : headSha, {
			limit: 0,
			ordering: 'topo',
		});
		const covered = coverRangeFromHead([...(log?.commits.keys() ?? [])], normalized);
		if (!covered.ok) continue;

		if (
			best == null ||
			covered.shas.length < best.shas.length ||
			(covered.shas.length === best.shas.length && sha < best.baseSha)
		) {
			best = { shas: covered.shas, baseSha: sha, baseParentSha: parentSha };
		}
	}

	if (best == null) {
		return {
			ok: false,
			reason: 'not-contiguous',
			message: 'Selected commits do not form a commit range ending at HEAD',
		};
	}

	const shas = best.shas.filter(sha => sha !== best.baseSha);
	shas.push(best.baseSha);
	return {
		ok: true,
		shas: shas,
		expanded: best.shas.length > normalized.size,
		baseSha: best.baseSha,
		baseParentSha: best.baseParentSha,
	};
}

/** Gets commits unique to `branchName` — the merge base with its target through the branch head. */
async function getBranchCommits(
	repo: GlRepository,
	branchName: string,
	mergeTargetName?: string,
): Promise<{ commits: GitCommit[]; baseCommit: { sha: string; message: string }; headCommitSha: string } | undefined> {
	try {
		const branch = await repo.git.branches.getBranch(branchName);
		if (!branch) return undefined;

		const baseBranch = mergeTargetName ? await repo.git.branches.getBranch(mergeTargetName) : undefined;
		if (!baseBranch) return undefined;

		const mergeBase = await repo.git.refs.getMergeBase(branch.ref, baseBranch.ref);
		if (!mergeBase) return undefined;

		const baseCommit = await repo.git.commits.getCommit(mergeBase);
		if (!baseCommit) return undefined;

		const log = await repo.git.commits.getLog(`${baseBranch.ref}..${branch.ref}`, { limit: 0 });
		if (!log?.commits?.size) return undefined;

		// Reverse the newest-first log to oldest-first for processing
		const commits = [...log.commits.values()].reverse();
		const headCommit = commits.at(-1)!;

		return {
			commits: commits,
			baseCommit: {
				sha: baseCommit.sha,
				message: baseCommit.message ?? '',
			},
			headCommitSha: headCommit?.sha ?? branch.sha,
		};
	} catch {
		return undefined;
	}
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
		const log = await svc.commits.getLog(`${request.range.base}..${request.range.head}`, {
			limit: 0,
			ordering: 'topo',
		});
		const commits = [...(log?.commits.values() ?? [])];
		if (commits.length === 0) {
			return { ok: false, reason: 'empty', message: 'No commits to recompose' };
		}

		// Keep the boundary commit anchored on the requested base last, matching
		// coverRangeEndingAtHead's contract for order-sensitive consumers.
		const shas = commits.map(c => c.sha);
		const baseCommitSha = (await svc.commits.getCommit(request.range.base))?.sha ?? request.range.base;
		const baseIndex = commits.findIndex(c => c.parents[0] === baseCommitSha);
		if (baseIndex >= 0 && baseIndex !== shas.length - 1) {
			const [boundarySha] = shas.splice(baseIndex, 1);
			shas.push(boundarySha);
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
		const branchData = await getBranchCommits(repo, branch.name, mergeTargetName);
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

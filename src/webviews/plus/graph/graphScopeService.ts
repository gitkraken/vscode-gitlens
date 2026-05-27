import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import { rootSha } from '@gitlens/git/models/revision.js';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import type { ScopeSelection } from './graphService.js';

/**
 * Resolves the file list for a given {@link ScopeSelection}.
 *
 * - `commit` — files changed by that commit vs. its parent (or vs. the empty tree for root commits).
 * - `compare` — explicit `includeShas` overrides the compare range to `parent(oldest)..newest`;
 *   `[]` narrows to zero; `undefined` falls back to the full `fromSha..toSha` range.
 * - `wip` — combined diff over the selected unpushed commit range with rename detection, with
 *   WIP files layered on top; rename chains spanning WIP + committed collapse to one entry.
 */
export async function getScopeFiles(
	container: Container,
	repoPath: string,
	scope: ScopeSelection,
	signal?: AbortSignal,
): Promise<GitFileChangeShape[]> {
	signal?.throwIfAborted();
	const svc = container.git.getRepositoryService(repoPath);

	const toShape = (f: { path: string; status: GitFileStatus; originalPath?: string }): GitFileChangeShape => ({
		repoPath: repoPath,
		path: f.path,
		status: f.status,
		originalPath: f.originalPath,
		staged: false,
	});

	if (scope.type === 'commit') {
		const files = await getCommitFiles(svc, scope.sha, signal);
		return files.map(toShape);
	}

	if (scope.type === 'compare') {
		if (scope.includeShas != null) {
			if (scope.includeShas.length === 0) return [];

			const files = await collectCommittedRangeFiles(svc, scope.includeShas, signal);
			return files.map(toShape);
		}

		const status = await svc.diff.getDiffStatus(`${scope.fromSha}..${scope.toSha}`);
		signal?.throwIfAborted();
		return (status ?? []).map(toShape);
	}

	const wipEntries: GitFileChangeShape[] = [];
	if (scope.includeStaged || scope.includeUnstaged) {
		const wipStatus = await svc.status.getStatus(undefined, signal);
		signal?.throwIfAborted();
		for (const f of wipStatus?.files ?? []) {
			const hasStaged = f.indexStatus != null;
			const hasUnstaged = f.workingTreeStatus != null;
			const includeAsStaged = hasStaged && scope.includeStaged;
			const includeAsUnstaged = hasUnstaged && scope.includeUnstaged;
			if (!includeAsStaged && !includeAsUnstaged) continue;

			// Unstaged > staged matches the `anchorRank` ordering in graphWebview.ts, so right-click
			// actions land on the topmost editable layer.
			wipEntries.push({
				repoPath: repoPath,
				path: f.path,
				status: f.status,
				originalPath: f.originalPath,
				staged: includeAsStaged && !includeAsUnstaged,
			});
		}
	}

	const committedEntries =
		scope.includeShas.length === 0 ? [] : await collectCommittedRangeFiles(svc, scope.includeShas, signal);
	const committedShapes = committedEntries.map(toShape);
	const committedByNewPath = new Map(committedShapes.map(e => [e.path, e]));

	const merged = new Map<string, GitFileChangeShape>();
	for (const wip of wipEntries) {
		// Collapse chains where WIP renamed/modified what the committed range already renamed:
		//   - WIP rename `B → C` on top of committed `A → B` → one entry `A → C`.
		//   - WIP modify of a file the committed range renamed → inherit the rename's origin so
		//     the row stays `R` (not a fresh `M` that drops the rename arrow).
		let originalPath = wip.originalPath;
		let status: GitFileStatus = wip.status;
		const committedAtSamePath = committedByNewPath.get(wip.path);
		const committedAtWipOrigin = wip.originalPath != null ? committedByNewPath.get(wip.originalPath) : undefined;

		if (committedAtWipOrigin?.originalPath != null) {
			originalPath = committedAtWipOrigin.originalPath;
			committedByNewPath.delete(committedAtWipOrigin.path);
		} else if (committedAtSamePath?.originalPath != null && wip.originalPath == null) {
			originalPath = committedAtSamePath.originalPath;
			status = 'R';
			committedByNewPath.delete(committedAtSamePath.path);
		} else if (committedAtSamePath != null) {
			committedByNewPath.delete(committedAtSamePath.path);
		}

		merged.set(wip.path, { ...wip, originalPath: originalPath, status: status });
	}

	for (const e of committedByNewPath.values()) {
		if (!merged.has(e.path)) {
			merged.set(e.path, e);
		}
	}

	return [...merged.values()];
}

/**
 * Files changed by a single commit. Falls back to the empty-tree root for root commits (no parent).
 */
async function getCommitFiles(
	svc: GitRepositoryService,
	sha: string,
	signal?: AbortSignal,
): Promise<{ path: string; status: GitFileStatus; originalPath?: string }[]> {
	try {
		const files = await svc.diff.getDiffStatus(`${sha}^..${sha}`);
		signal?.throwIfAborted();
		return files ?? [];
	} catch {
		signal?.throwIfAborted();
		const files = await svc.diff.getDiffStatus(rootSha, sha);
		signal?.throwIfAborted();
		return files ?? [];
	}
}

/**
 * Combined `parent(oldest)..newest` diff with rename detection. Relies on the picker producing
 * a contiguous newest-first range; multi-hop renames inside the range collapse to one entry.
 *
 * Falls back to the empty-tree root for ranges anchored at the initial commit.
 */
async function collectCommittedRangeFiles(
	svc: GitRepositoryService,
	includeShas: readonly string[],
	signal?: AbortSignal,
): Promise<{ path: string; status: GitFileStatus; originalPath?: string }[]> {
	if (includeShas.length === 0) return [];

	const newest = includeShas[0];
	const oldest = includeShas.at(-1);
	if (oldest == null) return [];

	try {
		const files = await svc.diff.getDiffStatus(`${oldest}^..${newest}`, undefined, { similarityThreshold: 50 });
		signal?.throwIfAborted();
		return files ?? [];
	} catch {
		signal?.throwIfAborted();
		const files = await svc.diff.getDiffStatus(rootSha, newest, { similarityThreshold: 50 });
		signal?.throwIfAborted();
		return files ?? [];
	}
}

import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import { rootSha } from '@gitlens/git/models/revision.js';
import type { Container } from '../../../container.js';
import type { ScopeSelection } from './graphService.js';

/**
 * Resolves the file list for a given {@link ScopeSelection}.
 *
 * - `commit` — the files changed by that commit vs. its parent (or vs. the empty tree
 *   for root commits).
 * - `compare` — explicit `includeShas` overrides the compare range to the union of
 *   those commits' files. `[]` means "narrow to zero" (empty result). `undefined` means
 *   "no narrowing" — fall back to the full `fromSha..toSha` range.
 * - `wip` — union of WIP files (indexStatus/workingTreeStatus-driven, not inferred
 *   from the coalesced `status` letter) and selected unpushed commit files.
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

	// Resolve a single commit's file diff, falling back to the empty-tree root for root commits.
	const getCommitFiles = async (sha: string): Promise<GitFile[] | undefined> => {
		try {
			const files = await svc.diff.getDiffStatus(`${sha}^..${sha}`);
			signal?.throwIfAborted();
			return files;
		} catch {
			signal?.throwIfAborted();
			const files = await svc.diff.getDiffStatus(rootSha, sha);
			signal?.throwIfAborted();
			return files;
		}
	};

	const mergeCommitFiles = async (
		shas: readonly string[],
		byPath: Map<string, GitFileChangeShape>,
	): Promise<void> => {
		const results = await Promise.all(shas.map(s => getCommitFiles(s)));
		signal?.throwIfAborted();
		for (const files of results) {
			if (!files) continue;
			for (const f of files) {
				if (!byPath.has(f.path)) {
					byPath.set(f.path, toShape(f));
				}
			}
		}
	};

	if (scope.type === 'commit') {
		const files = await getCommitFiles(scope.sha);
		return (files ?? []).map(toShape);
	}

	if (scope.type === 'compare') {
		// Empty `includeShas` (explicit narrowing to zero) means an empty file list.
		// `undefined` means no narrowing — fall back to the full compare range.
		if (scope.includeShas != null) {
			if (scope.includeShas.length === 0) return [];
			const byPath = new Map<string, GitFileChangeShape>();
			await mergeCommitFiles(scope.includeShas, byPath);
			return [...byPath.values()];
		}

		const status = await svc.diff.getDiffStatus(`${scope.fromSha}..${scope.toSha}`);
		signal?.throwIfAborted();
		return (status ?? []).map(toShape);
	}

	// WIP scope
	const byPath = new Map<string, GitFileChangeShape>();

	if (scope.includeStaged || scope.includeUnstaged) {
		const wipStatus = await svc.status.getStatus(signal);
		signal?.throwIfAborted();
		for (const f of wipStatus?.files ?? []) {
			const hasStaged = f.indexStatus != null;
			const hasUnstaged = f.workingTreeStatus != null;
			const includeAsStaged = hasStaged && scope.includeStaged;
			const includeAsUnstaged = hasUnstaged && scope.includeUnstaged;
			if (!includeAsStaged && !includeAsUnstaged) continue;

			if (byPath.has(f.path)) continue;
			// Staged layer takes precedence when both layers are in scope so the entry
			// accurately carries `staged: true`; the coalesced `f.status` still reflects
			// the index status when present (see statusFile.ts `status` getter).
			byPath.set(f.path, {
				repoPath: repoPath,
				path: f.path,
				status: f.status,
				originalPath: f.originalPath,
				staged: includeAsStaged,
			});
		}
	}

	if (scope.includeShas.length) {
		await mergeCommitFiles(scope.includeShas, byPath);
	}

	return [...byPath.values()];
}

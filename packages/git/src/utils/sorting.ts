import { sortCompare } from '@gitlens/utils/string.js';
import { compareByVersionDescending } from '@gitlens/utils/version.js';
import type { GitBranch } from '../models/branch.js';
import type { GitContributor } from '../models/contributor.js';
import type { GitRemote } from '../models/remote.js';
import type { GitTag } from '../models/tag.js';
import type { GitWorktree } from '../models/worktree.js';
import type { GitCommitReachability } from '../providers/commits.js';

export type BranchSorting = 'date:desc' | 'date:asc' | 'name:asc' | 'name:desc';
export type TagSorting = 'date:desc' | 'date:asc' | 'name:asc' | 'name:desc';
export type ContributorSorting =
	| 'count:desc'
	| 'count:asc'
	| 'date:desc'
	| 'date:asc'
	| 'name:asc'
	| 'name:desc'
	| 'score:desc'
	| 'score:asc';

export interface BranchSortOptions {
	current?: boolean;
	groupByType?: boolean;
	missingUpstream?: boolean;
	orderBy?: BranchSorting;
	openedWorktreesByBranch?: Set<string>;
}

/**
 * Comparator for sorting reachable refs to match `git for-each-ref` ordering: current first,
 * local before remote, tags by version descending. Use with `.sort()` or `.toSorted()`.
 */
export function compareReachableRefs(
	a: GitCommitReachability['refs'][number],
	b: GitCommitReachability['refs'][number],
): number {
	if (a.current && !b.current) return -1;
	if (!a.current && b.current) return 1;
	if (a.refType === 'branch' && b.refType === 'branch') {
		if (a.remote !== b.remote) return a.remote ? 1 : -1;
	}
	if (a.refType === 'tag' && b.refType === 'tag') {
		return compareByVersionDescending(a.name, b.name);
	}
	return 0;
}

export function sortBranches(branches: GitBranch[], options?: BranchSortOptions): GitBranch[] {
	options = { current: true, groupByType: true, orderBy: 'date:desc', ...options };

	switch (options.orderBy) {
		case 'date:asc':
			return branches.sort(
				(a, b) =>
					(options.missingUpstream ? (a.upstream?.missing ? -1 : 1) - (b.upstream?.missing ? -1 : 1) : 0) ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(options.openedWorktreesByBranch
						? (options.openedWorktreesByBranch.has(a.id) ? -1 : 1) -
							(options.openedWorktreesByBranch.has(b.id) ? -1 : 1)
						: 0) ||
					(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
					(options.groupByType ? (b.remote ? -1 : 1) - (a.remote ? -1 : 1) : 0) ||
					(a.date == null ? -1 : a.date.getTime()) - (b.date == null ? -1 : b.date.getTime()) ||
					sortCompare(a.name, b.name),
			);
		case 'name:asc':
			return branches.sort(
				(a, b) =>
					(options.missingUpstream ? (a.upstream?.missing ? -1 : 1) - (b.upstream?.missing ? -1 : 1) : 0) ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(options.openedWorktreesByBranch
						? (options.openedWorktreesByBranch.has(a.id) ? -1 : 1) -
							(options.openedWorktreesByBranch.has(b.id) ? -1 : 1)
						: 0) ||
					(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
					(a.name === 'main' ? -1 : 1) - (b.name === 'main' ? -1 : 1) ||
					(a.name === 'master' ? -1 : 1) - (b.name === 'master' ? -1 : 1) ||
					(a.name === 'develop' ? -1 : 1) - (b.name === 'develop' ? -1 : 1) ||
					(options.groupByType ? (b.remote ? -1 : 1) - (a.remote ? -1 : 1) : 0) ||
					sortCompare(a.name, b.name),
			);
		case 'name:desc':
			return branches.sort(
				(a, b) =>
					(options.missingUpstream ? (a.upstream?.missing ? -1 : 1) - (b.upstream?.missing ? -1 : 1) : 0) ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(options.openedWorktreesByBranch
						? (options.openedWorktreesByBranch.has(a.id) ? -1 : 1) -
							(options.openedWorktreesByBranch.has(b.id) ? -1 : 1)
						: 0) ||
					(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
					(a.name === 'main' ? -1 : 1) - (b.name === 'main' ? -1 : 1) ||
					(a.name === 'master' ? -1 : 1) - (b.name === 'master' ? -1 : 1) ||
					(a.name === 'develop' ? -1 : 1) - (b.name === 'develop' ? -1 : 1) ||
					(options.groupByType ? (b.remote ? -1 : 1) - (a.remote ? -1 : 1) : 0) ||
					sortCompare(b.name, a.name),
			);
		case 'date:desc':
		default:
			return branches.sort(
				(a, b) =>
					(options.missingUpstream ? (a.upstream?.missing ? -1 : 1) - (b.upstream?.missing ? -1 : 1) : 0) ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(options.openedWorktreesByBranch
						? (options.openedWorktreesByBranch.has(a.id) ? -1 : 1) -
							(options.openedWorktreesByBranch.has(b.id) ? -1 : 1)
						: 0) ||
					(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
					(options.groupByType ? (b.remote ? -1 : 1) - (a.remote ? -1 : 1) : 0) ||
					(b.date == null ? -1 : b.date.getTime()) - (a.date == null ? -1 : a.date.getTime()) ||
					sortCompare(b.name, a.name),
			);
	}
}

export interface ContributorSortOptions<T = GitContributor> {
	current?: true;
	orderBy?: ContributorSorting;
	accessor?: (item: T) => GitContributor;
	preCompare?: (a: T, b: T) => number;
}

export function sortContributors<T = GitContributor>(contributors: T[], options?: ContributorSortOptions<T>): T[] {
	const { accessor, preCompare, ...rest } = { current: true as const, orderBy: 'count:desc' as const, ...options };
	const get = accessor ?? ((item: T) => item as unknown as GitContributor);
	const pre = preCompare ?? (() => 0);

	switch (rest.orderBy) {
		case 'count:asc':
			return contributors.sort((a, b) => {
				const ca = get(a);
				const cb = get(b);
				return (
					pre(a, b) ||
					(rest.current ? (ca.current ? -1 : 1) - (cb.current ? -1 : 1) : 0) ||
					ca.contributionCount - cb.contributionCount ||
					(ca.latestCommitDate?.getTime() ?? 0) - (cb.latestCommitDate?.getTime() ?? 0)
				);
			});
		case 'date:desc':
			return contributors.sort((a, b) => {
				const ca = get(a);
				const cb = get(b);
				return (
					pre(a, b) ||
					(rest.current ? (ca.current ? -1 : 1) - (cb.current ? -1 : 1) : 0) ||
					(cb.latestCommitDate?.getTime() ?? 0) - (ca.latestCommitDate?.getTime() ?? 0) ||
					cb.contributionCount - ca.contributionCount
				);
			});
		case 'date:asc':
			return contributors.sort((a, b) => {
				const ca = get(a);
				const cb = get(b);
				return (
					pre(a, b) ||
					(rest.current ? (ca.current ? -1 : 1) - (cb.current ? -1 : 1) : 0) ||
					(ca.latestCommitDate?.getTime() ?? 0) - (cb.latestCommitDate?.getTime() ?? 0) ||
					cb.contributionCount - ca.contributionCount
				);
			});
		case 'name:asc':
			return contributors.sort((a, b) => {
				const ca = get(a);
				const cb = get(b);
				return (
					pre(a, b) ||
					(rest.current ? (ca.current ? -1 : 1) - (cb.current ? -1 : 1) : 0) ||
					sortCompare(ca.name ?? ca.username!, cb.name ?? cb.username!)
				);
			});
		case 'name:desc':
			return contributors.sort((a, b) => {
				const ca = get(a);
				const cb = get(b);
				return (
					pre(a, b) ||
					(rest.current ? (ca.current ? -1 : 1) - (cb.current ? -1 : 1) : 0) ||
					sortCompare(cb.name ?? cb.username!, ca.name ?? ca.username!)
				);
			});
		case 'score:desc':
			return contributors.sort((a, b) => {
				const ca = get(a);
				const cb = get(b);
				return (
					pre(a, b) ||
					(rest.current ? (ca.current ? -1 : 1) - (cb.current ? -1 : 1) : 0) ||
					(cb.stats?.contributionScore ?? 0) - (ca.stats?.contributionScore ?? 0) ||
					cb.contributionCount - ca.contributionCount ||
					(cb.latestCommitDate?.getTime() ?? 0) - (ca.latestCommitDate?.getTime() ?? 0)
				);
			});
		case 'score:asc':
			return contributors.sort((a, b) => {
				const ca = get(a);
				const cb = get(b);
				return (
					pre(a, b) ||
					(rest.current ? (ca.current ? -1 : 1) - (cb.current ? -1 : 1) : 0) ||
					(ca.stats?.contributionScore ?? 0) - (cb.stats?.contributionScore ?? 0) ||
					ca.contributionCount - cb.contributionCount ||
					(ca.latestCommitDate?.getTime() ?? 0) - (cb.latestCommitDate?.getTime() ?? 0)
				);
			});
		case 'count:desc':
		default:
			return contributors.sort((a, b) => {
				const ca = get(a);
				const cb = get(b);
				return (
					pre(a, b) ||
					(rest.current ? (ca.current ? -1 : 1) - (cb.current ? -1 : 1) : 0) ||
					cb.contributionCount - ca.contributionCount ||
					(cb.latestCommitDate?.getTime() ?? 0) - (ca.latestCommitDate?.getTime() ?? 0)
				);
			});
	}
}

export function sortRemotes<T extends GitRemote>(remotes: T[]): T[] {
	return remotes.sort(
		(a, b) =>
			(a.default ? -1 : 1) - (b.default ? -1 : 1) ||
			(a.name === 'origin' ? -1 : 1) - (b.name === 'origin' ? -1 : 1) ||
			(a.name === 'upstream' ? -1 : 1) - (b.name === 'upstream' ? -1 : 1) ||
			sortCompare(a.name, b.name),
	);
}

export interface TagSortOptions {
	orderBy?: TagSorting;
}

export function sortTags(tags: GitTag[], options?: TagSortOptions): GitTag[] {
	options = { orderBy: 'date:desc', ...options };

	switch (options.orderBy) {
		case 'date:asc':
			return tags.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
		case 'name:asc':
			return tags.sort((a, b) => sortCompare(a.name, b.name));
		case 'name:desc':
			return tags.sort((a, b) => sortCompare(b.name, a.name));
		case 'date:desc':
		default:
			return tags.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
	}
}

export interface WorktreeSortOptions<T = GitWorktree> {
	orderBy?: BranchSorting;
	accessor?: (item: T) => GitWorktree;
}

export function sortWorktrees<T = GitWorktree>(worktrees: T[], options?: WorktreeSortOptions<T>): T[] {
	const { accessor, ...rest } = { orderBy: 'date:desc' as const, ...options };
	const get = accessor ?? ((item: T) => item as unknown as GitWorktree);

	switch (rest.orderBy) {
		case 'date:asc':
			return worktrees.sort((a, b) => {
				const wa = get(a);
				const wb = get(b);
				return (
					(wa.opened ? -1 : 1) - (wb.opened ? -1 : 1) ||
					(wa.isDefault ? -1 : 1) - (wb.isDefault ? -1 : 1) ||
					(wa.date == null ? -1 : wa.date.getTime()) - (wb.date == null ? -1 : wb.date.getTime()) ||
					sortCompare(wa.name, wb.name)
				);
			});
		case 'name:asc':
			return worktrees.sort((a, b) => {
				const wa = get(a);
				const wb = get(b);
				return (
					(wa.opened ? -1 : 1) - (wb.opened ? -1 : 1) ||
					(wa.isDefault ? -1 : 1) - (wb.isDefault ? -1 : 1) ||
					(wa.name === 'main' ? -1 : 1) - (wb.name === 'main' ? -1 : 1) ||
					(wa.name === 'master' ? -1 : 1) - (wb.name === 'master' ? -1 : 1) ||
					(wa.name === 'develop' ? -1 : 1) - (wb.name === 'develop' ? -1 : 1) ||
					sortCompare(wa.name, wb.name)
				);
			});
		case 'name:desc':
			return worktrees.sort((a, b) => {
				const wa = get(a);
				const wb = get(b);
				return (
					(wa.opened ? -1 : 1) - (wb.opened ? -1 : 1) ||
					(wa.isDefault ? -1 : 1) - (wb.isDefault ? -1 : 1) ||
					(wa.name === 'main' ? -1 : 1) - (wb.name === 'main' ? -1 : 1) ||
					(wa.name === 'master' ? -1 : 1) - (wb.name === 'master' ? -1 : 1) ||
					(wa.name === 'develop' ? -1 : 1) - (wb.name === 'develop' ? -1 : 1) ||
					sortCompare(wb.name, wa.name)
				);
			});
		case 'date:desc':
		default:
			return worktrees.sort((a, b) => {
				const wa = get(a);
				const wb = get(b);
				return (
					(wa.opened ? -1 : 1) - (wb.opened ? -1 : 1) ||
					(wa.isDefault ? -1 : 1) - (wb.isDefault ? -1 : 1) ||
					(wb.date == null ? -1 : wb.date.getTime()) - (wa.date == null ? -1 : wa.date.getTime()) ||
					sortCompare(wb.name, wa.name)
				);
			});
	}
}

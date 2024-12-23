import type { BranchSorting, ContributorSorting, RepositoriesSorting, TagSorting } from '../../config';
import { sortCompare } from '../../system/string';
import { configuration } from '../../system/vscode/configuration';
import type { GitBranch } from '../models/branch';
import type { GitContributor } from '../models/contributor';
import { isContributor } from '../models/contributor';
import type { ContributorQuickPickItem } from '../models/contributor.quickpick';
import type { Repository } from '../models/repository';
import type { GitTag } from '../models/tag';
import type { GitWorktree } from '../models/worktree';
import { isWorktree } from '../models/worktree';
import type { WorktreeQuickPickItem } from '../models/worktree.quickpick';

export interface BranchSortOptions {
	current?: boolean;
	groupByType?: boolean;
	missingUpstream?: boolean;
	orderBy?: BranchSorting;
	openedWorktreesByBranch?: Set<string>;
}

export function sortBranches(branches: GitBranch[], options?: BranchSortOptions) {
	options = { current: true, groupByType: true, orderBy: configuration.get('sortBranchesBy'), ...options };

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

export interface ContributorSortOptions {
	current?: true;
	orderBy?: ContributorSorting;
}

export interface ContributorQuickPickSortOptions extends ContributorSortOptions {
	picked?: boolean;
}

export function sortContributors(contributors: GitContributor[], options?: ContributorSortOptions): GitContributor[];
export function sortContributors(
	contributors: ContributorQuickPickItem[],
	options?: ContributorQuickPickSortOptions,
): ContributorQuickPickItem[];
export function sortContributors(
	contributors: GitContributor[] | ContributorQuickPickItem[],
	options?: (ContributorSortOptions & { picked?: never }) | ContributorQuickPickSortOptions,
) {
	options = { picked: true, current: true, orderBy: configuration.get('sortContributorsBy'), ...options };

	const getContributor = (contributor: GitContributor | ContributorQuickPickItem): GitContributor => {
		return isContributor(contributor) ? contributor : contributor.item;
	};

	const comparePicked = (
		a: GitContributor | ContributorQuickPickItem,
		b: GitContributor | ContributorQuickPickItem,
	): number => {
		if (!options.picked || isContributor(a) || isContributor(b)) return 0;
		return (a.picked ? -1 : 1) - (b.picked ? -1 : 1);
	};

	switch (options.orderBy) {
		case 'count:asc':
			return contributors.sort((a, b) => {
				const pickedCompare = comparePicked(a, b);
				a = getContributor(a);
				b = getContributor(b);

				return (
					pickedCompare ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					a.commits - b.commits ||
					(a.latestCommitDate?.getTime() ?? 0) - (b.latestCommitDate?.getTime() ?? 0)
				);
			});
		case 'date:desc':
			return contributors.sort((a, b) => {
				const pickedCompare = comparePicked(a, b);
				a = getContributor(a);
				b = getContributor(b);

				return (
					pickedCompare ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(b.latestCommitDate?.getTime() ?? 0) - (a.latestCommitDate?.getTime() ?? 0) ||
					b.commits - a.commits
				);
			});
		case 'date:asc':
			return contributors.sort((a, b) => {
				const pickedCompare = comparePicked(a, b);
				a = getContributor(a);
				b = getContributor(b);

				return (
					pickedCompare ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(a.latestCommitDate?.getTime() ?? 0) - (b.latestCommitDate?.getTime() ?? 0) ||
					b.commits - a.commits
				);
			});
		case 'name:asc':
			return contributors.sort((a, b) => {
				const pickedCompare = comparePicked(a, b);
				a = getContributor(a);
				b = getContributor(b);

				return (
					pickedCompare ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					sortCompare(a.name ?? a.username!, b.name ?? b.username!)
				);
			});
		case 'name:desc':
			return contributors.sort((a, b) => {
				const pickedCompare = comparePicked(a, b);
				a = getContributor(a);
				b = getContributor(b);

				return (
					pickedCompare ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					sortCompare(b.name ?? b.username!, a.name ?? a.username!)
				);
			});
		case 'score:desc':
			return contributors.sort((a, b) => {
				const pickedCompare = comparePicked(a, b);
				a = getContributor(a);
				b = getContributor(b);

				return (
					pickedCompare ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(b.stats?.contributionScore ?? 0) - (a.stats?.contributionScore ?? 0) ||
					b.commits - a.commits ||
					(b.latestCommitDate?.getTime() ?? 0) - (a.latestCommitDate?.getTime() ?? 0)
				);
			});
		case 'score:asc':
			return contributors.sort((a, b) => {
				const pickedCompare = comparePicked(a, b);
				a = getContributor(a);
				b = getContributor(b);

				return (
					pickedCompare ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(a.stats?.contributionScore ?? 0) - (b.stats?.contributionScore ?? 0) ||
					a.commits - b.commits ||
					(a.latestCommitDate?.getTime() ?? 0) - (b.latestCommitDate?.getTime() ?? 0)
				);
			});
		case 'count:desc':
		default:
			return contributors.sort((a, b) => {
				const pickedCompare = comparePicked(a, b);
				a = getContributor(a);
				b = getContributor(b);

				return (
					pickedCompare ||
					(options.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					b.commits - a.commits ||
					(b.latestCommitDate?.getTime() ?? 0) - (a.latestCommitDate?.getTime() ?? 0)
				);
			});
	}
}

export interface RepositoriesSortOptions {
	orderBy?: RepositoriesSorting;
}

export function sortRepositories(repositories: Repository[], options?: RepositoriesSortOptions) {
	options = { orderBy: configuration.get('sortRepositoriesBy'), ...options };

	switch (options.orderBy) {
		case 'name:asc':
			return repositories.sort(
				(a, b) => (a.starred ? -1 : 1) - (b.starred ? -1 : 1) || sortCompare(a.name, b.name),
			);
		case 'name:desc':
			return repositories.sort(
				(a, b) => (a.starred ? -1 : 1) - (b.starred ? -1 : 1) || sortCompare(b.name, a.name),
			);
		case 'lastFetched:asc':
			return repositories.sort(
				(a, b) =>
					(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
					(a.lastFetchedCached ?? 0) - (b.lastFetchedCached ?? 0),
			);
		case 'lastFetched:desc':
			return repositories.sort(
				(a, b) =>
					(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
					(b.lastFetchedCached ?? 0) - (a.lastFetchedCached ?? 0),
			);
		case 'discovered':
		default:
			return repositories;
	}
}

export interface TagSortOptions {
	current?: boolean;
	orderBy?: TagSorting;
}

export function sortTags(tags: GitTag[], options?: TagSortOptions) {
	options = { orderBy: configuration.get('sortTagsBy'), ...options };

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

export interface WorktreeSortOptions {
	orderBy?: BranchSorting;
}

export function sortWorktrees(worktrees: GitWorktree[], options?: WorktreeSortOptions): GitWorktree[];
export function sortWorktrees(
	worktrees: WorktreeQuickPickItem[],
	options?: WorktreeSortOptions,
): WorktreeQuickPickItem[];
export function sortWorktrees(worktrees: GitWorktree[] | WorktreeQuickPickItem[], options?: WorktreeSortOptions) {
	options = { orderBy: configuration.get('sortBranchesBy'), ...options };

	const getWorktree = (worktree: GitWorktree | WorktreeQuickPickItem): GitWorktree => {
		return isWorktree(worktree) ? worktree : worktree.item;
	};

	switch (options.orderBy) {
		case 'date:asc':
			return worktrees.sort((a, b) => {
				a = getWorktree(a);
				b = getWorktree(b);

				return (
					(a.opened ? -1 : 1) - (b.opened ? -1 : 1) ||
					(a.hasChanges === null ? 0 : a.hasChanges ? -1 : 1) -
						(b.hasChanges === null ? 0 : b.hasChanges ? -1 : 1) ||
					(a.date == null ? -1 : a.date.getTime()) - (b.date == null ? -1 : b.date.getTime()) ||
					sortCompare(a.name, b.name)
				);
			});
		case 'name:asc':
			return worktrees.sort((a, b) => {
				a = getWorktree(a);
				b = getWorktree(b);

				return (
					(a.opened ? -1 : 1) - (b.opened ? -1 : 1) ||
					(a.hasChanges === null ? 0 : a.hasChanges ? -1 : 1) -
						(b.hasChanges === null ? 0 : b.hasChanges ? -1 : 1) ||
					(a.name === 'main' ? -1 : 1) - (b.name === 'main' ? -1 : 1) ||
					(a.name === 'master' ? -1 : 1) - (b.name === 'master' ? -1 : 1) ||
					(a.name === 'develop' ? -1 : 1) - (b.name === 'develop' ? -1 : 1) ||
					sortCompare(a.name, b.name)
				);
			});
		case 'name:desc':
			return worktrees.sort((a, b) => {
				a = getWorktree(a);
				b = getWorktree(b);

				return (
					(a.opened ? -1 : 1) - (b.opened ? -1 : 1) ||
					(a.hasChanges === null ? 0 : a.hasChanges ? -1 : 1) -
						(b.hasChanges === null ? 0 : b.hasChanges ? -1 : 1) ||
					(a.name === 'main' ? -1 : 1) - (b.name === 'main' ? -1 : 1) ||
					(a.name === 'master' ? -1 : 1) - (b.name === 'master' ? -1 : 1) ||
					(a.name === 'develop' ? -1 : 1) - (b.name === 'develop' ? -1 : 1) ||
					sortCompare(b.name, a.name)
				);
			});
		case 'date:desc':
		default:
			return worktrees.sort((a, b) => {
				a = getWorktree(a);
				b = getWorktree(b);

				return (
					(a.opened ? -1 : 1) - (b.opened ? -1 : 1) ||
					(b.date == null ? -1 : b.date.getTime()) - (a.date == null ? -1 : a.date.getTime()) ||
					(a.hasChanges === null ? 0 : a.hasChanges ? -1 : 1) -
						(b.hasChanges === null ? 0 : b.hasChanges ? -1 : 1) ||
					sortCompare(b.name, a.name)
				);
			});
	}
}

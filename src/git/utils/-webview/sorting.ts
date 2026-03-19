import { GitContributor } from '@gitlens/git/models/contributor.js';
import { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { WorktreeSortOptions } from '@gitlens/git/utils/sorting.js';
import { sortContributors as _sortContributors, sortWorktrees as _sortWorktrees } from '@gitlens/git/utils/sorting.js';
import { sortCompare } from '@gitlens/utils/string.js';
import type { ContributorSorting, RepositoriesSorting } from '../../../config.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { GlRepository } from '../../models/repository.js';
import type { ContributorQuickPickItem } from './contributor.quickpick.js';
import type { WorktreeQuickPickItem } from './worktree.quickpick.js';

export type { ContributorSortOptions, WorktreeSortOptions } from '@gitlens/git/utils/sorting.js';

export interface ContributorQuickPickSortOptions {
	current?: true;
	orderBy?: ContributorSorting;
	picked?: boolean;
}

export function sortContributors(
	contributors: GitContributor[],
	options?: ContributorQuickPickSortOptions,
): GitContributor[];
export function sortContributors(
	contributors: ContributorQuickPickItem[],
	options?: ContributorQuickPickSortOptions,
): ContributorQuickPickItem[];
export function sortContributors(
	contributors: (GitContributor | ContributorQuickPickItem)[],
	options?: ContributorQuickPickSortOptions,
): (GitContributor | ContributorQuickPickItem)[] {
	const picked = options?.picked ?? true;
	return _sortContributors(contributors, {
		current: true,
		orderBy: configuration.get('sortContributorsBy'),
		...options,
		accessor: (item: GitContributor | ContributorQuickPickItem) => (GitContributor.is(item) ? item : item.item),
		preCompare: (a: GitContributor | ContributorQuickPickItem, b: GitContributor | ContributorQuickPickItem) => {
			if (!picked || GitContributor.is(a) || GitContributor.is(b)) return 0;
			return (a.picked ? -1 : 1) - (b.picked ? -1 : 1);
		},
	});
}

export interface RepositoriesSortOptions {
	orderBy?: RepositoriesSorting;
}

export function sortRepositories(repositories: GlRepository[], options?: RepositoriesSortOptions): GlRepository[] {
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

export function sortRepositoriesGrouped(grouped: Map<GlRepository, Map<string, GlRepository>>): GlRepository[] {
	const sorted = new Set<GlRepository>();

	const repos = sortRepositories([...grouped.keys()]);
	for (const repo of repos) {
		sorted.add(repo);

		// Get worktrees for this main repo and sort them
		const worktrees = grouped.get(repo);
		if (worktrees?.size) {
			const sortedWorktrees = sortRepositories([...worktrees.values()]);
			for (const worktree of sortedWorktrees) {
				sorted.add(worktree);
			}
		}
	}

	return [...sorted];
}

export function sortWorktrees(worktrees: GitWorktree[], options?: WorktreeSortOptions): GitWorktree[];
export function sortWorktrees(
	worktrees: WorktreeQuickPickItem[],
	options?: WorktreeSortOptions,
): WorktreeQuickPickItem[];
export function sortWorktrees(
	worktrees: (GitWorktree | WorktreeQuickPickItem)[],
	options?: WorktreeSortOptions,
): (GitWorktree | WorktreeQuickPickItem)[] {
	return _sortWorktrees(worktrees, {
		orderBy: configuration.get('sortWorktreesBy'),
		...options,
		accessor: (item: GitWorktree | WorktreeQuickPickItem) => (GitWorktree.is(item) ? item : item.item),
	});
}

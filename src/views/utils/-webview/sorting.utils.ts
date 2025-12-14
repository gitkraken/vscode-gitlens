import type {
	BranchSorting,
	ContributorSorting,
	RepositoriesSorting,
	TagSorting,
	WorktreeSorting,
} from '../../../config';
import { configuration } from '../../../system/-webview/configuration';

// Map config keys to their full sorting types (for extracting directions from specific sort types)
type SortingByConfig = {
	sortBranchesBy: BranchSorting;
	sortContributorsBy: ContributorSorting;
	sortRepositoriesBy: RepositoriesSorting;
	sortTagsBy: TagSorting;
	sortWorktreesBy: WorktreeSorting;
};

type ExtractSortType<T extends string> = T extends `${infer Type}:${string}` ? Type : T;

// Map config keys to their valid sort types (all types including directionless)
type SortKeyByConfig = {
	sortBranchesBy: ExtractSortType<BranchSorting>;
	sortContributorsBy: ExtractSortType<ContributorSorting>;
	sortRepositoriesBy: ExtractSortType<RepositoriesSorting>;
	sortTagsBy: ExtractSortType<TagSorting>;
	sortWorktreesBy: ExtractSortType<WorktreeSorting>;
};

type ExtractDirection<T extends string> = T extends `${string}:${infer Direction}` ? Direction : never;

type DirectionForSortKey<TKey extends keyof SortingByConfig, TSortType extends SortKeyByConfig[TKey]> =
	ExtractDirection<Extract<SortingByConfig[TKey], `${TSortType}:${string}`>> extends never
		? undefined
		: ExtractDirection<SortingByConfig[TKey]>;

/**
 * Updates a sorting configuration by changing the sort type while preserving the direction
 * If the current sort type doesn't have a direction (e.g., 'discovered'), uses the provided default direction
 * @param configKey - The configuration key to update (e.g., 'sortBranchesBy')
 * @param sortKey - The new sort type to switch to (e.g., 'date', 'name', 'lastFetched')
 * @param defaultDirection - The default direction to use if current sort has no direction (only valid directions for the specified sort type are allowed)
 * @returns Promise from configuration.updateEffective
 */
export function updateSorting<TConfigKey extends keyof SortingByConfig, TSortKey extends SortKeyByConfig[TConfigKey]>(
	configKey: TConfigKey,
	sortKey: TSortKey,
	defaultDirection: DirectionForSortKey<TConfigKey, TSortKey>,
): Thenable<void> {
	const current = configuration.get(configKey);

	let sort: SortingByConfig[TConfigKey];
	// If current doesn't have a direction, use the default direction
	if (!current.includes(':')) {
		sort = `${sortKey}:${defaultDirection ?? 'desc'}` as SortingByConfig[TConfigKey];
	} else if (defaultDirection != null) {
		// Otherwise preserve the current direction
		sort = current.replace(/^[^:]+/, sortKey) as SortingByConfig[TConfigKey];
	} else {
		sort = sortKey as unknown as SortingByConfig[TConfigKey];
	}
	return configuration.updateEffective(configKey, sort as any);
}

/**
 * Updates a sorting configuration by changing the direction while preserving the sort type
 * @param configKey - The configuration key to update (e.g., 'sortBranchesBy')
 * @param direction - The new direction to switch to (only valid directions for this config key are allowed)
 * @returns Promise from configuration.updateEffective
 */
export function updateSortingDirection<TKey extends keyof SortingByConfig>(
	configKey: TKey,
	direction: DirectionForSortKey<TKey, SortKeyByConfig[TKey]>,
): Thenable<void> {
	const current = configuration.get(configKey);
	const oppositeDirection = direction === 'asc' ? 'desc' : 'asc';
	const sort = current.replace(new RegExp(`:${oppositeDirection}$`), `:${direction}`) as SortingByConfig[TKey];
	return configuration.updateEffective(configKey, sort as any);
}

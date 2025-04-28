import type { GitCommitStats } from '../models/commit';
import type { GitContributionTiers, GitContributor, GitContributorsStats } from '../models/contributor';
import type { GitUser } from '../models/user';

export interface ContributorScoreOptions {
	// Thresholds
	recentThresholdInDays: number;
	maxScoreNormalization: number;

	// Time-based weights
	recentWeight: number;

	// Impact weights
	additionsWeight: number;
	deletionsWeight: number;
}

export const defaultContributorScoreOptions: ContributorScoreOptions = {
	recentThresholdInDays: 30,
	recentWeight: 1.5,
	additionsWeight: 0.8,
	deletionsWeight: 1.2,
	maxScoreNormalization: 1000,
};

export function calculateContributionScore(
	stats: GitCommitStats | undefined,
	timestamp: number,
	options: ContributorScoreOptions = defaultContributorScoreOptions,
): number {
	if (stats == null) return 0;

	const now = Date.now();
	const ageInDays = (now - timestamp) / (24 * 3600 * 1000);

	// Time decay factor (exponential decay)
	const recencyScore = Math.exp(-ageInDays / options.recentThresholdInDays);

	// Impact score with weighted components
	const impactScore = stats.additions * options.additionsWeight + stats.deletions * options.deletionsWeight;

	return Math.min(impactScore * (1 + recencyScore * options.recentWeight), options.maxScoreNormalization);
}

export function calculateDistribution<T extends string>(
	stats: GitContributorsStats | undefined,
	prefix: T,
): Record<`${typeof prefix}${GitContributionTiers}`, number> {
	if (stats == null) return {} as unknown as Record<`${typeof prefix}${GitContributionTiers}`, number>;

	const distribution: Record<`${string}${GitContributionTiers}`, number> = {
		[`${prefix}[1]`]: 0,
		[`${prefix}[2-5]`]: 0,
		[`${prefix}[6-10]`]: 0,
		[`${prefix}[11-50]`]: 0,
		[`${prefix}[51-100]`]: 0,
		[`${prefix}[101+]`]: 0,
	};

	for (const c of stats.contributions) {
		if (c === 1) {
			distribution[`${prefix}[1]`]++;
		} else if (c <= 5) {
			distribution[`${prefix}[2-5]`]++;
		} else if (c <= 10) {
			distribution[`${prefix}[6-10]`]++;
		} else if (c <= 50) {
			distribution[`${prefix}[11-50]`]++;
		} else if (c <= 100) {
			distribution[`${prefix}[51-100]`]++;
		} else {
			distribution[`${prefix}[101+]`]++;
		}
	}

	return distribution;
}
export function matchContributor(c: GitContributor, user: GitUser): boolean {
	return c.name === user.name && c.email === user.email && c.username === user.username;
}

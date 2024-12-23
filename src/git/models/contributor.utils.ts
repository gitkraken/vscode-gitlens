import type { GitCommitStats } from './commit';

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
	stats: GitCommitStats<number> | undefined,
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

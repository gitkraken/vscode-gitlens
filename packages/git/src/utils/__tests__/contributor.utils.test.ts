import * as assert from 'assert';
import type { GitContributorsStats } from '../../models/contributor.js';
import type { ContributorScoreOptions } from '../contributor.utils.js';
import {
	calculateContributionScore,
	calculateDistribution,
	defaultContributorScoreOptions,
} from '../contributor.utils.js';

suite('Contributor Utils Test Suite', () => {
	suite('calculateContributionScore', () => {
		test('returns 0 when stats is undefined', () => {
			const score = calculateContributionScore(undefined, Date.now());
			assert.strictEqual(score, 0);
		});

		test('returns a high score for very recent activity', () => {
			const now = Date.now();
			const score = calculateContributionScore(
				{ files: 1, additions: 100, deletions: 50 },
				now, // ageInDays ~0
			);
			// recencyScore = exp(0) = 1
			// impactScore = 100*0.8 + 50*1.2 = 80 + 60 = 140
			// result = min(140 * (1 + 1*1.5), 1000) = min(140 * 2.5, 1000) = min(350, 1000) = 350
			assert.strictEqual(score, 350);
		});

		test('returns a lower score for older activity', () => {
			const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;
			const score = calculateContributionScore({ files: 1, additions: 100, deletions: 50 }, thirtyDaysAgo);
			// ageInDays = 30, recencyScore = exp(-30/30) = exp(-1) ≈ 0.3679
			// impactScore = 140
			// result = 140 * (1 + 0.3679 * 1.5) = 140 * 1.5518 ≈ 217.25
			assert.ok(score > 200 && score < 230, `Expected score between 200 and 230, got ${score}`);
		});

		test('returns near-zero recency boost for very old activity', () => {
			const yearAgo = Date.now() - 365 * 24 * 3600 * 1000;
			const score = calculateContributionScore({ files: 1, additions: 100, deletions: 50 }, yearAgo);
			// ageInDays = 365, recencyScore = exp(-365/30) ≈ 0.000005
			// impactScore = 140
			// result ≈ 140 * (1 + ~0) ≈ 140
			assert.ok(score >= 140 && score < 141, `Expected score near 140, got ${score}`);
		});

		test('score is capped at maxScoreNormalization', () => {
			const now = Date.now();
			const score = calculateContributionScore({ files: 1, additions: 5000, deletions: 5000 }, now);
			assert.strictEqual(score, defaultContributorScoreOptions.maxScoreNormalization);
		});

		test('score is always between 0 and maxScoreNormalization', () => {
			const timestamps = [
				Date.now(),
				Date.now() - 7 * 24 * 3600 * 1000,
				Date.now() - 90 * 24 * 3600 * 1000,
				Date.now() - 365 * 24 * 3600 * 1000,
			];
			for (const ts of timestamps) {
				const score = calculateContributionScore({ files: 5, additions: 200, deletions: 100 }, ts);
				assert.ok(score >= 0, `Score should be >= 0, got ${score}`);
				assert.ok(
					score <= defaultContributorScoreOptions.maxScoreNormalization,
					`Score should be <= ${defaultContributorScoreOptions.maxScoreNormalization}, got ${score}`,
				);
			}
		});

		test('handles negative ageInDays (future timestamp)', () => {
			const futureTimestamp = Date.now() + 10 * 24 * 3600 * 1000;
			const score = calculateContributionScore({ files: 1, additions: 100, deletions: 50 }, futureTimestamp);
			// ageInDays negative => recencyScore = exp(positive) > 1
			// This boosts the score beyond the "present" case but is still capped at max
			assert.ok(score > 0, `Expected positive score, got ${score}`);
			assert.ok(
				score <= defaultContributorScoreOptions.maxScoreNormalization,
				`Score should be capped, got ${score}`,
			);
		});

		test('additions and deletions contribute differently based on weights', () => {
			const now = Date.now();
			const additionsOnly = calculateContributionScore({ files: 1, additions: 100, deletions: 0 }, now);
			const deletionsOnly = calculateContributionScore({ files: 1, additions: 0, deletions: 100 }, now);
			// additions: 100 * 0.8 = 80; deletions: 100 * 1.2 = 120
			// Both get same recency multiplier (2.5 for ageInDays≈0)
			assert.ok(deletionsOnly > additionsOnly, 'Deletions should weigh more than additions');
			assert.strictEqual(additionsOnly, 200); // 80 * 2.5
			assert.strictEqual(deletionsOnly, 300); // 120 * 2.5
		});

		test('zero additions and zero deletions produce zero score', () => {
			const score = calculateContributionScore({ files: 1, additions: 0, deletions: 0 }, Date.now());
			assert.strictEqual(score, 0);
		});

		test('respects custom options', () => {
			const now = Date.now();
			const customOptions: ContributorScoreOptions = {
				recentThresholdInDays: 60,
				recentWeight: 2.0,
				additionsWeight: 1.0,
				deletionsWeight: 1.0,
				maxScoreNormalization: 500,
			};
			const score = calculateContributionScore({ files: 1, additions: 100, deletions: 100 }, now, customOptions);
			// impactScore = 100*1.0 + 100*1.0 = 200
			// recencyScore = exp(0) = 1
			// result = min(200 * (1 + 1*2.0), 500) = min(200 * 3, 500) = 500 (capped)
			assert.strictEqual(score, 500);
		});

		test('score decreases monotonically with age', () => {
			const stats = { files: 3, additions: 50, deletions: 30 };
			const now = Date.now();
			let previousScore = Infinity;
			for (const daysAgo of [0, 1, 7, 30, 90, 180, 365]) {
				const ts = now - daysAgo * 24 * 3600 * 1000;
				const score = calculateContributionScore(stats, ts);
				assert.ok(
					score <= previousScore,
					`Score should decrease with age: ${score} > ${previousScore} at ${daysAgo} days`,
				);
				previousScore = score;
			}
		});
	});

	suite('calculateDistribution', () => {
		test('returns all zeros for undefined stats', () => {
			const result = calculateDistribution(undefined, 'commits.');
			// When stats is undefined, returns an empty object cast
			assert.deepStrictEqual(result, {});
		});

		test('returns all zeros for empty contributions array', () => {
			const stats: GitContributorsStats = { count: 0, contributions: [] };
			const result = calculateDistribution(stats, 'c.');
			assert.deepStrictEqual(result, {
				'c.[1]': 0,
				'c.[2-5]': 0,
				'c.[6-10]': 0,
				'c.[11-50]': 0,
				'c.[51-100]': 0,
				'c.[101+]': 0,
			});
		});

		test('bins exact boundary value 1 into [1]', () => {
			const stats: GitContributorsStats = { count: 1, contributions: [1] };
			const result = calculateDistribution(stats, 'x.');
			assert.strictEqual(result['x.[1]'], 1);
			assert.strictEqual(result['x.[2-5]'], 0);
		});

		test('bins value 2 into [2-5]', () => {
			const stats: GitContributorsStats = { count: 1, contributions: [2] };
			const result = calculateDistribution(stats, 'x.');
			assert.strictEqual(result['x.[1]'], 0);
			assert.strictEqual(result['x.[2-5]'], 1);
		});

		test('bins value 5 into [2-5] (upper boundary)', () => {
			const stats: GitContributorsStats = { count: 1, contributions: [5] };
			const result = calculateDistribution(stats, 'x.');
			assert.strictEqual(result['x.[2-5]'], 1);
			assert.strictEqual(result['x.[6-10]'], 0);
		});

		test('bins value 6 into [6-10] (lower boundary)', () => {
			const stats: GitContributorsStats = { count: 1, contributions: [6] };
			const result = calculateDistribution(stats, 'x.');
			assert.strictEqual(result['x.[2-5]'], 0);
			assert.strictEqual(result['x.[6-10]'], 1);
		});

		test('bins value 10 into [6-10] (upper boundary)', () => {
			const stats: GitContributorsStats = { count: 1, contributions: [10] };
			const result = calculateDistribution(stats, 'x.');
			assert.strictEqual(result['x.[6-10]'], 1);
			assert.strictEqual(result['x.[11-50]'], 0);
		});

		test('bins value 11 into [11-50] (lower boundary)', () => {
			const stats: GitContributorsStats = { count: 1, contributions: [11] };
			const result = calculateDistribution(stats, 'x.');
			assert.strictEqual(result['x.[6-10]'], 0);
			assert.strictEqual(result['x.[11-50]'], 1);
		});

		test('bins value 50 into [11-50] (upper boundary)', () => {
			const stats: GitContributorsStats = { count: 1, contributions: [50] };
			const result = calculateDistribution(stats, 'x.');
			assert.strictEqual(result['x.[11-50]'], 1);
			assert.strictEqual(result['x.[51-100]'], 0);
		});

		test('bins value 51 into [51-100] (lower boundary)', () => {
			const stats: GitContributorsStats = { count: 1, contributions: [51] };
			const result = calculateDistribution(stats, 'x.');
			assert.strictEqual(result['x.[11-50]'], 0);
			assert.strictEqual(result['x.[51-100]'], 1);
		});

		test('bins value 100 into [51-100] (upper boundary)', () => {
			const stats: GitContributorsStats = { count: 1, contributions: [100] };
			const result = calculateDistribution(stats, 'x.');
			assert.strictEqual(result['x.[51-100]'], 1);
			assert.strictEqual(result['x.[101+]'], 0);
		});

		test('bins value 101 into [101+] (lower boundary)', () => {
			const stats: GitContributorsStats = { count: 1, contributions: [101] };
			const result = calculateDistribution(stats, 'x.');
			assert.strictEqual(result['x.[51-100]'], 0);
			assert.strictEqual(result['x.[101+]'], 1);
		});

		test('bins multiple contributions across all tiers', () => {
			const stats: GitContributorsStats = {
				count: 7,
				contributions: [1, 3, 8, 25, 75, 150, 1],
			};
			const result = calculateDistribution(stats, 'p.');
			assert.strictEqual(result['p.[1]'], 2);
			assert.strictEqual(result['p.[2-5]'], 1);
			assert.strictEqual(result['p.[6-10]'], 1);
			assert.strictEqual(result['p.[11-50]'], 1);
			assert.strictEqual(result['p.[51-100]'], 1);
			assert.strictEqual(result['p.[101+]'], 1);
		});

		test('uses the provided prefix in all keys', () => {
			const stats: GitContributorsStats = { count: 1, contributions: [42] };
			const result = calculateDistribution(stats, 'myPrefix.');
			const keys = Object.keys(result);
			assert.ok(
				keys.every(k => k.startsWith('myPrefix.')),
				`All keys should start with prefix: ${keys.join(', ')}`,
			);
			assert.strictEqual(keys.length, 6);
		});
	});
});

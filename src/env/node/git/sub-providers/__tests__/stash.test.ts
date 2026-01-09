import * as assert from 'assert';
import type { GitStashCommit, GitStashParentInfo } from '../../../../../git/models/commit.js';
import { findOldestStashTimestamp } from '../stash.js';

suite('findOldestStashTimestamp Test Suite', () => {
	function createMockStashCommit(date: Date, parentTimestamps?: GitStashParentInfo[]): Partial<GitStashCommit> {
		return {
			date: date,
			parentTimestamps: parentTimestamps,
		};
	}

	test('should return Infinity for empty stashes collection', () => {
		const result = findOldestStashTimestamp([]);
		assert.strictEqual(result, Infinity);
	});

	test('should return stash date when no parent timestamps exist', () => {
		const stashDate = new Date('2022-01-02T12:00:00Z');
		const stashes = [createMockStashCommit(stashDate)] as GitStashCommit[];

		const result = findOldestStashTimestamp(stashes);
		assert.strictEqual(result, stashDate.getTime());
	});

	test('should return stash date when parent timestamps are empty', () => {
		const stashDate = new Date('2022-01-02T12:00:00Z');
		const stashes = [createMockStashCommit(stashDate, [])] as GitStashCommit[];

		const result = findOldestStashTimestamp(stashes);
		assert.strictEqual(result, stashDate.getTime());
	});

	test('should return oldest parent timestamp when parent is older than stash', () => {
		const stashDate = new Date('2022-01-02T12:00:00Z');
		const oldest = 1640995200; // 2022-01-01 00:00:00 UTC
		const parentTimestamps: GitStashParentInfo[] = [
			{
				sha: 'parent1',
				authorDate: oldest,
				committerDate: 1640995260,
			},
		];
		const stashes = [createMockStashCommit(stashDate, parentTimestamps)] as GitStashCommit[];

		const result = findOldestStashTimestamp(stashes);
		const expectedOldest = oldest * 1000; // Convert to milliseconds
		assert.strictEqual(result, expectedOldest);
	});

	test('should return stash date when stash is older than parents', () => {
		const stashDate = new Date('2022-01-01T00:00:00Z'); // Older
		const parentTimestamps: GitStashParentInfo[] = [
			{
				sha: 'parent1',
				authorDate: 1641081600, // 2022-01-02 00:00:00 UTC (newer)
				committerDate: 1641081660,
			},
		];
		const stashes = [createMockStashCommit(stashDate, parentTimestamps)] as GitStashCommit[];

		const result = findOldestStashTimestamp(stashes);
		assert.strictEqual(result, stashDate.getTime());
	});

	test('should handle multiple stashes and find the globally oldest timestamp', () => {
		const stash1Date = new Date('2022-01-03T00:00:00Z');
		const oldest = 1640995200; // 2022-01-01 00:00:00 UTC (oldest overall)
		const stash1Parents: GitStashParentInfo[] = [
			{
				sha: 'parent1',
				authorDate: oldest,
				committerDate: 1640995260,
			},
		];

		const stash2Date = new Date('2022-01-02T00:00:00Z');
		const stash2Parents: GitStashParentInfo[] = [
			{
				sha: 'parent2',
				authorDate: 1641081600, // 2022-01-02 00:00:00 UTC
				committerDate: 1641081660,
			},
		];

		const stashes = [
			createMockStashCommit(stash1Date, stash1Parents),
			createMockStashCommit(stash2Date, stash2Parents),
		] as GitStashCommit[];

		const result = findOldestStashTimestamp(stashes);
		const expectedOldest = oldest * 1000; // parent1's authorDate
		assert.strictEqual(result, expectedOldest);
	});

	test('should consider both authorDate and committerDate of parents', () => {
		const stashDate = new Date('2022-01-02T00:00:00Z');
		const oldest = 1640995200; // 2022-01-01 00:00:00 UTC (older)
		const parentTimestamps: GitStashParentInfo[] = [
			{
				sha: 'parent1',
				authorDate: 1641081600, // 2022-01-02 00:00:00 UTC
				committerDate: oldest,
			},
		];
		const stashes = [createMockStashCommit(stashDate, parentTimestamps)] as GitStashCommit[];

		const result = findOldestStashTimestamp(stashes);
		const expectedOldest = oldest * 1000; // committerDate is older
		assert.strictEqual(result, expectedOldest);
	});

	test('should handle null/undefined parent timestamps gracefully', () => {
		const stashDate = new Date('2022-01-02T00:00:00Z');
		const oldest = 1640995200; // 2022-01-01 00:00:00 UTC
		const parentTimestamps: GitStashParentInfo[] = [
			{
				sha: 'parent1',
				authorDate: undefined,
				committerDate: null as any,
			},
			{
				sha: 'parent2',
				authorDate: oldest,
				committerDate: undefined,
			},
		];
		const stashes = [createMockStashCommit(stashDate, parentTimestamps)] as GitStashCommit[];

		const result = findOldestStashTimestamp(stashes);
		const expectedOldest = oldest * 1000; // Only valid timestamp
		assert.strictEqual(result, expectedOldest);
	});

	test('should handle multiple parents per stash', () => {
		const stashDate = new Date('2022-01-03T00:00:00Z');
		const oldest = 1640995200; // 2022-01-01 00:00:00 UTC (oldest)
		const parentTimestamps: GitStashParentInfo[] = [
			{
				sha: 'parent1',
				authorDate: 1641081600, // 2022-01-02 00:00:00 UTC
				committerDate: 1641081660,
			},
			{
				sha: 'parent2',
				authorDate: oldest,
				committerDate: 1640995260,
			},
			{
				sha: 'parent3',
				authorDate: 1641168000, // 2022-01-03 00:00:00 UTC
				committerDate: 1641168060,
			},
		];
		const stashes = [createMockStashCommit(stashDate, parentTimestamps)] as GitStashCommit[];

		const result = findOldestStashTimestamp(stashes);
		const expectedOldest = oldest * 1000; // parent2's authorDate
		assert.strictEqual(result, expectedOldest);
	});

	test('should work with Map.values() as used in production code', () => {
		const stashMap = new Map<string, GitStashCommit>();
		const oldest = 1640995200; // 2022-01-01 00:00:00 UTC (oldest)

		const stash1Date = new Date('2022-01-02T00:00:00Z');
		const stash1Parents: GitStashParentInfo[] = [
			{
				sha: 'parent1',
				authorDate: oldest,
				committerDate: 1640995260,
			},
		];

		stashMap.set('stash1', createMockStashCommit(stash1Date, stash1Parents) as GitStashCommit);

		const result = findOldestStashTimestamp(stashMap.values());
		const expectedOldest = oldest * 1000;
		assert.strictEqual(result, expectedOldest);
	});

	test('should handle edge case with only null parent timestamps', () => {
		const stashDate = new Date('2022-01-02T00:00:00Z');
		const parentTimestamps: GitStashParentInfo[] = [
			{
				sha: 'parent1',
				authorDate: null as any,
				committerDate: undefined,
			},
		];
		const stashes = [createMockStashCommit(stashDate, parentTimestamps)] as GitStashCommit[];

		const result = findOldestStashTimestamp(stashes);
		assert.strictEqual(result, stashDate.getTime()); // Falls back to stash date
	});

	test('should handle very large collections efficiently', () => {
		const stashes: GitStashCommit[] = [];
		const baseTime = new Date('2022-01-01T00:00:00Z').getTime();

		// Create 1000 stashes with various timestamps
		for (let i = 0; i < 1000; i++) {
			const stashDate = new Date(baseTime + i * 60000); // Each stash 1 minute apart
			const parentTimestamps: GitStashParentInfo[] = [
				{
					sha: `parent${i}`,
					authorDate: Math.floor((baseTime + i * 30000) / 1000), // 30 seconds apart
					committerDate: Math.floor((baseTime + i * 45000) / 1000), // 45 seconds apart
				},
			];
			stashes.push(createMockStashCommit(stashDate, parentTimestamps) as GitStashCommit);
		}

		const result = findOldestStashTimestamp(stashes);
		assert.strictEqual(result, baseTime); // Should be the first parent's authorDate
	});
});

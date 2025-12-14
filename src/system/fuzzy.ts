/**
 * Result of a fuzzy match operation
 */
export interface FuzzyMatchResult {
	/** Whether the pattern matches the target */
	matches: boolean;
	/** Score of the match (higher is better, 0-1 range) */
	score: number;
	/** Indices of matched characters in the target string */
	matchedIndices: number[];
}

/**
 * Options for fuzzy matching
 */
export interface FuzzyMatchOptions {
	/** Whether to perform case-sensitive matching (default: false) */
	caseSensitive?: boolean;
	/** Bonus for consecutive character matches (default: 0.15) */
	consecutiveBonus?: number;
	/** Bonus for matches at the start of the string (default: 0.2) */
	prefixBonus?: number;
	/** Penalty for each unmatched character (default: 0.05) */
	unmatchedPenalty?: number;
}

const defaultOptions: Required<FuzzyMatchOptions> = {
	caseSensitive: false,
	consecutiveBonus: 0.15,
	prefixBonus: 0.2,
	unmatchedPenalty: 0.05,
};

/**
 * Performs fuzzy matching of a pattern against a target string with scoring.
 *
 * The algorithm:
 * 1. Checks if all characters in the pattern exist in the target (in order)
 * 2. Calculates a score based on:
 *    - Exact prefix matches (highest priority)
 *    - Consecutive character matches
 *    - Position of matches (earlier is better)
 *    - Unmatched characters (penalty)
 *
 * @param pattern The search pattern
 * @param target The string to match against
 * @param options Matching options
 * @returns Match result with score and matched indices
 *
 * @example
 * fuzzyMatch('mes', 'message:') // { matches: true, score: 0.95, matchedIndices: [0, 1, 2] }
 * fuzzyMatch('aut', 'author:')  // { matches: true, score: 0.93, matchedIndices: [0, 1, 2] }
 * fuzzyMatch('msg', 'message:') // { matches: true, score: 0.65, matchedIndices: [0, 2, 3] }
 */
export function fuzzyMatch(pattern: string, target: string, options?: FuzzyMatchOptions): FuzzyMatchResult {
	const opts = { ...defaultOptions, ...options };

	if (!pattern) {
		return { matches: true, score: 1, matchedIndices: [] };
	}

	if (!target) {
		return { matches: false, score: 0, matchedIndices: [] };
	}

	const patternStr = opts.caseSensitive ? pattern : pattern.toLowerCase();
	const targetStr = opts.caseSensitive ? target : target.toLowerCase();

	// Check for exact match first
	if (patternStr === targetStr) {
		return {
			matches: true,
			score: 1,
			matchedIndices: Array.from({ length: target.length }, (_, i) => i),
		};
	}

	// Check if pattern is a prefix of target
	if (targetStr.startsWith(patternStr)) {
		return {
			matches: true,
			score: 0.9 + (patternStr.length / targetStr.length) * 0.1,
			matchedIndices: Array.from({ length: pattern.length }, (_, i) => i),
		};
	}

	// Perform fuzzy matching
	const matchedIndices: number[] = [];
	let patternIdx = 0;
	let targetIdx = 0;
	let consecutiveMatches = 0;
	let score = 0;

	while (patternIdx < patternStr.length && targetIdx < targetStr.length) {
		if (patternStr[patternIdx] === targetStr[targetIdx]) {
			matchedIndices.push(targetIdx);

			// Base score for each match
			score += 1;

			// Bonus for consecutive matches
			if (
				matchedIndices.length > 1 &&
				matchedIndices[matchedIndices.length - 1] === matchedIndices[matchedIndices.length - 2] + 1
			) {
				consecutiveMatches++;
				score += opts.consecutiveBonus * consecutiveMatches;
			} else {
				consecutiveMatches = 0;
			}

			// Bonus for matches at the start
			if (targetIdx === patternIdx) {
				score += opts.prefixBonus;
			}

			patternIdx++;
		}
		targetIdx++;
	}

	// Check if all pattern characters were matched
	if (patternIdx < patternStr.length) {
		return { matches: false, score: 0, matchedIndices: [] };
	}

	// Apply penalty for unmatched characters
	const unmatchedCount = targetStr.length - matchedIndices.length;
	score -= unmatchedCount * opts.unmatchedPenalty;

	// Normalize score to 0-1 range
	// Maximum possible score is pattern.length + bonuses
	const maxScore = patternStr.length * (1 + opts.consecutiveBonus + opts.prefixBonus);
	const normalizedScore = Math.max(0, Math.min(1, score / maxScore));

	return {
		matches: true,
		score: normalizedScore,
		matchedIndices: matchedIndices,
	};
}

/**
 * Filters and sorts an array of items by fuzzy matching against a pattern.
 *
 * @param pattern The search pattern
 * @param items The items to filter and sort
 * @param getText Function to extract searchable text from each item
 * @param options Matching options
 * @returns Filtered and sorted items with their match results
 *
 * @example
 * const operators = [
 *   { name: 'message:', desc: 'Search messages' },
 *   { name: 'author:', desc: 'Search authors' }
 * ];
 * fuzzyFilter('mes', operators, op => op.name)
 * // Returns [{ item: { name: 'message:', ... }, match: { score: 0.95, ... } }]
 */
export function fuzzyFilter<T>(
	pattern: string,
	items: T[],
	getText: (item: T) => string,
	options?: FuzzyMatchOptions,
): Array<{ item: T; match: FuzzyMatchResult }> {
	if (!pattern) {
		return items.map(item => ({
			item: item,
			match: { matches: true, score: 1, matchedIndices: [] },
		}));
	}

	const results: Array<{ item: T; match: FuzzyMatchResult }> = [];

	for (const item of items) {
		const text = getText(item);
		const match = fuzzyMatch(pattern, text, options);

		if (match.matches) {
			results.push({ item: item, match: match });
		}
	}

	// Sort by score (descending)
	results.sort((a, b) => b.match.score - a.match.score);

	return results;
}

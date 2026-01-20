import type { ParsedGitDiffFile } from '../../../../git/models/diff.js';
import {
	countDiffInsertionsAndDeletions,
	countDiffLines,
	filterDiffFiles,
	parseGitDiff,
} from '../../../../git/parsers/diffParser.js';
import { extname } from '../../../../system/path.js';
import type { PromptTemplateContext, TruncationHandler } from '../../models/promptTemplates.js';

/**
 * Truncates prompt context by removing complete entries from the end of the changelog JSON array.
 */
export const truncatePromptWithChangelog: TruncationHandler<'generate-changelog'> = (
	context,
	_currentCharacters,
	targetCharacters,
	getCharacters,
) => {
	const data = context.data;
	if (!data) return Promise.resolve(undefined);

	let changes: unknown[];
	try {
		changes = JSON.parse(data) as unknown[];
	} catch {
		return Promise.resolve(undefined);
	}

	if (!Array.isArray(changes) || changes.length === 0) return Promise.resolve(undefined);

	// Try removing entries from the end until we fit
	while (changes.length > 0) {
		const truncatedData = JSON.stringify(changes);
		const newContext: PromptTemplateContext<'generate-changelog'> = { ...context, data: truncatedData };

		if (getCharacters(newContext) <= targetCharacters) {
			return Promise.resolve(newContext);
		}

		// Remove last entry and try again
		changes.pop();
	}

	// Couldn't fit even with minimum content
	return Promise.resolve(undefined);
};

type DiffTemplateType =
	| 'generate-commitMessage'
	| 'generate-stashMessage'
	| 'generate-create-cloudPatch'
	| 'generate-create-codeSuggestion'
	| 'generate-create-pullRequest'
	| 'explain-changes';

/** File type base scores (0-100, higher = more important) */
const fileTypeScores: Record<string, number> = {
	// Source code - HIGH priority (80-90)
	'.ts': 85,
	'.tsx': 85,
	'.js': 85,
	'.jsx': 85,
	'.py': 85,
	'.rb': 85,
	'.go': 85,
	'.rs': 85,
	'.java': 85,
	'.kt': 85,
	'.cs': 85,
	'.cpp': 85,
	'.c': 85,
	'.h': 85,
	'.swift': 85,
	'.scala': 85,
	'.php': 85,
	'.vue': 85,
	'.svelte': 85,

	// Config files - MEDIUM-HIGH priority (60-75)
	'.json': 65,
	'.yaml': 70,
	'.yml': 70,
	'.toml': 70,
	'.xml': 60,

	// Documentation - MEDIUM priority (40-55)
	'.md': 45,
	'.txt': 40,
	'.rst': 45,

	// Styles - MEDIUM-LOW priority (45-55)
	'.css': 50,
	'.scss': 50,
	'.less': 50,
	'.sass': 50,

	// HTML/Templates - MEDIUM priority (50-60)
	'.html': 50,
	'.htm': 50,
	'.hbs': 55,
	'.ejs': 55,

	// Assets - LOW priority (20-30)
	'.svg': 25,
};

/** High priority patterns with score multipliers (boost important files) */
const highPriorityPatterns: Array<{ pattern: RegExp; multiplier: number }> = [
	// Schema/migration files (often critical for understanding changes)
	{ pattern: /(^|\/)(migrations?|schema)\//i, multiplier: 1.3 },
	{ pattern: /schema\.(ts|js|json|graphql|prisma)$/i, multiplier: 1.3 },

	// API definitions
	{ pattern: /openapi\.(yaml|yml|json)$/i, multiplier: 1.3 },
	{ pattern: /swagger\.(yaml|yml|json)$/i, multiplier: 1.3 },

	// Package manifests (important for dependency changes)
	{ pattern: /package\.json$/, multiplier: 1.2 },
	{ pattern: /pyproject\.toml$/, multiplier: 1.2 },
	{ pattern: /go\.mod$/, multiplier: 1.2 },
	{ pattern: /Cargo\.toml$/, multiplier: 1.2 },
	{ pattern: /Gemfile$/, multiplier: 1.2 },
];

/** Low priority patterns with score multipliers */
const lowPriorityPatterns: Array<{ pattern: RegExp; multiplier: number }> = [
	// Lockfiles and vendored dependencies (almost never useful for summaries)
	{ pattern: /package-lock\.json$/, multiplier: 0.05 },
	{ pattern: /pnpm-lock\.yaml$/, multiplier: 0.05 },
	{ pattern: /yarn\.lock$/, multiplier: 0.05 },
	{ pattern: /Cargo\.lock$/, multiplier: 0.05 },
	{ pattern: /go\.sum$/, multiplier: 0.05 },
	{ pattern: /composer\.lock$/, multiplier: 0.05 },
	{ pattern: /(^|\/)vendor\//, multiplier: 0.1 },
	{ pattern: /(^|\/)node_modules\//, multiplier: 0.05 },
	{ pattern: /(^|\/)(dist|build|out|coverage)\//, multiplier: 0.1 },

	// Generated files
	{ pattern: /\.generated\.\w+$/, multiplier: 0.1 },
	{ pattern: /\.g\.(ts|cs|dart)$/, multiplier: 0.1 },
	{ pattern: /\.map$/, multiplier: 0.1 },
	{ pattern: /\.compiled\.\w+$/, multiplier: 0.1 },
	{ pattern: /\.d\.ts$/, multiplier: 0.3 },

	// Minified/bundled files
	{ pattern: /\.min\.(js|css)$/, multiplier: 0.1 },
	{ pattern: /\.bundle\.(js|css)$/, multiplier: 0.1 },

	// Test files (lower priority than source but not as low as generated)
	{ pattern: /\.(test|spec)\.(ts|js|tsx|jsx)$/, multiplier: 0.6 },
	{ pattern: /__tests__\//, multiplier: 0.6 },
];

interface ScoredFile {
	path: string;
	score: number;
}

/**
 * Calculates a priority score for a diff file (0-100, higher = more important).
 */
function calculateFileScore(file: ParsedGitDiffFile): number {
	const path = file.path;
	const filename = path.split('/').pop() ?? path;

	// Get extension (pattern multipliers handle compound extensions like .test.ts)
	const extension = extname(filename).toLowerCase();

	// Start with base score from extension, default to 50
	let score = fileTypeScores[extension] ?? 50;

	// Apply high-priority pattern multipliers (boosts)
	for (const { pattern, multiplier } of highPriorityPatterns) {
		if (pattern.test(path) || pattern.test(filename)) {
			score *= multiplier;
			break; // Only apply one pattern
		}
	}

	// Apply low-priority pattern multipliers (penalties)
	for (const { pattern, multiplier } of lowPriorityPatterns) {
		if (pattern.test(path) || pattern.test(filename)) {
			score *= multiplier;
			break; // Only apply one pattern
		}
	}

	// Apply content-based modifiers
	score = applyContentModifiers(score, file);

	return Math.max(0, Math.min(100, score));
}

/**
 * Applies content-based modifiers to the score.
 */
function applyContentModifiers(baseScore: number, file: ParsedGitDiffFile): number {
	let score = baseScore;

	// Binary files - reduce significantly
	if (file.metadata.binary) {
		score *= 0.1;
	}

	// Count approximate lines in the diff
	const lineCount = countDiffLines(file);

	// Very large diffs are often auto-generated or less valuable per-line
	if (lineCount > 500) {
		score *= 0.5;
	} else if (lineCount > 200) {
		score *= 0.7;
	}

	// Small, focused changes are more valuable
	if (lineCount > 0 && lineCount < 50) {
		score *= 1.2;
	}

	return score;
}

/**
 * Creates a minimal fallback diff summary when no files can fit.
 * Returns a list of changed files with their change types.
 */
function createFallbackDiffSummary(files: ParsedGitDiffFile[]): string {
	const lines = ['# Files changed (diff truncated due to size):'];
	for (const file of files) {
		const { insertions, deletions } = countDiffInsertionsAndDeletions(file);
		const stats = `+${insertions}/-${deletions}`;
		lines.push(`- ${file.path} (${stats})`);
	}
	return lines.join('\n');
}

/**
 * Truncates prompt context by intelligently removing lower-priority files from the diff.
 * Files are scored based on type, content characteristics, and size.
 */
export const truncatePromptWithDiff: TruncationHandler<DiffTemplateType> = async (
	context,
	_currentCharacters,
	targetCharacters,
	getCharacters,
) => {
	const diff = context.diff;
	if (typeof diff !== 'string' || !diff) return undefined;

	// Parse diff to score files
	const parsed = parseGitDiff(diff);
	if (!parsed.files.length) return undefined;

	// Score each file and sort by score (highest first)
	const scoredFiles: ScoredFile[] = parsed.files
		.map(file => ({ path: file.path, score: calculateFileScore(file) }))
		.sort((a, b) => b.score - a.score);

	const includedPaths = scoredFiles.map(f => f.path);

	// Binary search for the maximum number of files that fit
	let low = 0;
	let high = includedPaths.length;
	let bestContext: PromptTemplateContext<DiffTemplateType> | undefined;

	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		const pathsToInclude = includedPaths.slice(0, mid);
		const truncatedDiff = await filterDiffFiles(diff, () => pathsToInclude);
		const newContext: PromptTemplateContext<DiffTemplateType> = { ...context, diff: truncatedDiff };

		if (getCharacters(newContext) <= targetCharacters) {
			bestContext = newContext;
			low = mid; // Try to include more files
		} else {
			high = mid - 1; // Need fewer files
		}
	}

	if (bestContext) {
		return bestContext;
	}

	// Fallback: provide at least a summary of changed files
	const fallbackSummary = createFallbackDiffSummary(parsed.files);
	const fallbackContext: PromptTemplateContext<DiffTemplateType> = { ...context, diff: fallbackSummary };

	if (getCharacters(fallbackContext) <= targetCharacters) {
		return fallbackContext;
	}

	// Even fallback doesn't fit - return undefined
	return undefined;
};

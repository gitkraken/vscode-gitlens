import { fnv1aHash } from '@gitlens/utils/hash.js';
import type { GitBlame, GitBlameAuthor } from '../models/blame.js';
import type { GitCommit, GitCommitLine } from '../models/commit.js';
import { uncommitted } from '../models/revision.js';
import type { DiffRange } from '../providers/types.js';

/**
 * Filters a {@link GitBlame} object to only include lines within the given range.
 * This is a pure data transform — no I/O or provider access needed.
 *
 * @param blame - The full blame to filter
 * @param range - 1-based line range (inclusive)
 */
export function getBlameRange(blame: GitBlame, range: DiffRange): GitBlame | undefined {
	if (blame.lines.length === 0) return blame;

	// DiffRange is 1-based; lines array is 0-indexed
	const startIdx = range.startLine - 1;
	const endIdx = range.endLine; // endLine is inclusive, slice is exclusive

	if (startIdx === 0 && endIdx >= blame.lines.length) return blame;

	const lines = blame.lines.slice(startIdx, endIdx);
	const shas = new Set(lines.map(l => l.sha));

	const authors = new Map<string, GitBlameAuthor>();
	const commits = new Map<string, GitCommit>();
	for (const c of blame.commits.values()) {
		if (!shas.has(c.sha)) continue;

		const commit = c.with({
			lines: c.lines.filter(l => l.line >= range.startLine && l.line <= range.endLine),
		});
		commits.set(c.sha, commit);

		let author = authors.get(commit.author.name);
		if (author == null) {
			author = {
				name: commit.author.name,
				lineCount: 0,
				current: commit.author.current,
			};
			authors.set(author.name, author);
		}

		author.lineCount += commit.lines.length;
	}

	const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

	return {
		repoPath: blame.repoPath,
		authors: sortedAuthors,
		commits: commits,
		lines: lines,
	};
}

/** Result of a line-level diff between baseline and dirty content */
export interface LineMappingResult {
	/** Number of matching lines at the start */
	readonly prefixLen: number;
	/** Number of matching lines at the end */
	readonly suffixLen: number;
	/** Start of changed region in baseline (0-based) */
	readonly baseMiddleStart: number;
	/** End of changed region in baseline (exclusive) */
	readonly baseMiddleEnd: number;
	/** Start of changed region in dirty (0-based) */
	readonly dirtyMiddleStart: number;
	/** End of changed region in dirty (exclusive) */
	readonly dirtyMiddleEnd: number;
	/**
	 * For lines in the dirty middle section, maps dirty offset → baseline offset.
	 * Undefined means the line is new/modified (uncommitted).
	 * Indices are relative to the middle section starts.
	 */
	readonly middleMapping: (number | undefined)[];
}

/**
 * Line-level diff optimized for "mostly unchanged" content.
 *
 * Strategy:
 * 1. Strip common prefix (hash + string comparison)
 * 2. Strip common suffix (hash + string comparison)
 * 3. For the small middle section, use hash-map matching with string verification
 *
 * Performance: < 0.1ms for typical edits on files up to 5000 lines.
 */
export function diffLineMapping(
	baselineHashes: Uint32Array,
	baselineLines: readonly string[],
	dirtyLines: readonly string[],
	dirtyHashes?: Uint32Array,
): LineMappingResult {
	if (dirtyHashes == null) {
		dirtyHashes = new Uint32Array(dirtyLines.length);
		for (let i = 0; i < dirtyLines.length; i++) {
			dirtyHashes[i] = fnv1aHash(dirtyLines[i]);
		}
	}

	const baseLen = baselineHashes.length;
	const dirtyLen = dirtyHashes.length;
	const minLen = Math.min(baseLen, dirtyLen);

	// Common prefix scan — hash + string verification to avoid silent collision misattribution
	let prefixLen = 0;
	while (
		prefixLen < minLen &&
		baselineHashes[prefixLen] === dirtyHashes[prefixLen] &&
		baselineLines[prefixLen] === dirtyLines[prefixLen]
	) {
		prefixLen++;
	}

	// Common suffix scan — hash + string verification
	let suffixLen = 0;
	const maxSuffix = minLen - prefixLen;
	while (
		suffixLen < maxSuffix &&
		baselineHashes[baseLen - 1 - suffixLen] === dirtyHashes[dirtyLen - 1 - suffixLen] &&
		baselineLines[baseLen - 1 - suffixLen] === dirtyLines[dirtyLen - 1 - suffixLen]
	) {
		suffixLen++;
	}

	const baseMiddleStart = prefixLen;
	const baseMiddleEnd = baseLen - suffixLen;
	const dirtyMiddleStart = prefixLen;
	const dirtyMiddleEnd = dirtyLen - suffixLen;

	const baseMiddleLen = baseMiddleEnd - baseMiddleStart;
	const dirtyMiddleLen = dirtyMiddleEnd - dirtyMiddleStart;

	const middleMapping: (number | undefined)[] = new Array(dirtyMiddleLen).fill(undefined);

	if (baseMiddleLen > 0 && dirtyMiddleLen > 0) {
		// Build a map from hash → list of baseline middle indices
		const hashToBaseIndices = new Map<number, number[]>();
		for (let i = 0; i < baseMiddleLen; i++) {
			const h = baselineHashes[baseMiddleStart + i];
			let indices = hashToBaseIndices.get(h);
			if (indices == null) {
				indices = [];
				hashToBaseIndices.set(h, indices);
			}
			indices.push(i);
		}

		// For each dirty middle line, find a matching baseline line.
		// Prefer same relative position first (handles identical lines like "}" or blank
		// lines staying in place), then fall back to first available hash-map match.
		const usedBaseIndices = new Set<number>();
		for (let di = 0; di < dirtyMiddleLen; di++) {
			const dh = dirtyHashes[dirtyMiddleStart + di];

			// Positional bias: check same relative position first
			if (
				di < baseMiddleLen &&
				!usedBaseIndices.has(di) &&
				baselineHashes[baseMiddleStart + di] === dh &&
				baselineLines[baseMiddleStart + di] === dirtyLines[dirtyMiddleStart + di]
			) {
				middleMapping[di] = di;
				usedBaseIndices.add(di);
				continue;
			}

			// Fall back to first available match from hash-map candidates
			const candidates = hashToBaseIndices.get(dh);
			if (candidates == null) continue;

			for (const bi of candidates) {
				if (usedBaseIndices.has(bi)) continue;

				// Verify with string comparison (in case of hash collision)
				if (baselineLines[baseMiddleStart + bi] === dirtyLines[dirtyMiddleStart + di]) {
					middleMapping[di] = bi;
					usedBaseIndices.add(bi);
					break;
				}
			}
		}
	}

	return {
		prefixLen: prefixLen,
		suffixLen: suffixLen,
		baseMiddleStart: baseMiddleStart,
		baseMiddleEnd: baseMiddleEnd,
		dirtyMiddleStart: dirtyMiddleStart,
		dirtyMiddleEnd: dirtyMiddleEnd,
		middleMapping: middleMapping,
	};
}

/**
 * Build a dirty blame result from a clean blame and a line mapping.
 */
export function buildDirtyBlame(cleanBlame: GitBlame, mapping: LineMappingResult, dirtyLineCount: number): GitBlame {
	const dirtyBlameLines: GitCommitLine[] = new Array(dirtyLineCount);
	const commits = new Map(cleanBlame.commits);

	// Prefix lines — direct mapping
	for (let i = 0; i < mapping.prefixLen; i++) {
		const cleanLine = cleanBlame.lines[i];
		if (cleanLine != null) {
			dirtyBlameLines[i] = { ...cleanLine, line: i + 1 };
		} else {
			dirtyBlameLines[i] = makeUncommittedLine(i);
		}
	}

	// Middle section — use the mapping
	const dirtyMiddleLen = mapping.dirtyMiddleEnd - mapping.dirtyMiddleStart;
	for (let di = 0; di < dirtyMiddleLen; di++) {
		const dirtyIdx = mapping.dirtyMiddleStart + di;
		const baseOffset = mapping.middleMapping[di];

		if (baseOffset != null) {
			const baseIdx = mapping.baseMiddleStart + baseOffset;
			const cleanLine = cleanBlame.lines[baseIdx];
			if (cleanLine != null) {
				dirtyBlameLines[dirtyIdx] = { ...cleanLine, line: dirtyIdx + 1 };
			} else {
				dirtyBlameLines[dirtyIdx] = makeUncommittedLine(dirtyIdx);
			}
		} else {
			dirtyBlameLines[dirtyIdx] = makeUncommittedLine(dirtyIdx);
		}
	}

	// Suffix lines — direct mapping from end
	const baseLen = cleanBlame.lines.length;
	for (let si = 0; si < mapping.suffixLen; si++) {
		const dirtyIdx = dirtyLineCount - mapping.suffixLen + si;
		const baseIdx = baseLen - mapping.suffixLen + si;
		const cleanLine = cleanBlame.lines[baseIdx];
		if (cleanLine != null) {
			dirtyBlameLines[dirtyIdx] = { ...cleanLine, line: dirtyIdx + 1 };
		} else {
			dirtyBlameLines[dirtyIdx] = makeUncommittedLine(dirtyIdx);
		}
	}

	// Recompute line counts per sha and authors
	const lineCountsBySha = new Map<string, number>();
	for (const blameLine of dirtyBlameLines) {
		if (blameLine == null) continue;
		lineCountsBySha.set(blameLine.sha, (lineCountsBySha.get(blameLine.sha) ?? 0) + 1);
	}

	const authors = new Map<string, GitBlameAuthor>();
	for (const [sha, lineCount] of lineCountsBySha) {
		if (sha === uncommitted) {
			const uncommittedCommit = commits.get(uncommitted);
			const userName = uncommittedCommit?.author.name ?? '';
			authors.set(userName, { name: userName, lineCount: lineCount, current: true });
			continue;
		}

		const c = commits.get(sha);
		if (!c?.author.name) continue;

		const existing = authors.get(c.author.name);
		if (existing != null) {
			existing.lineCount += lineCount;
		} else {
			authors.set(c.author.name, { name: c.author.name, lineCount: lineCount, current: c.author.current });
		}
	}

	// Include authors from commits that have no lines in the dirty blame (zero lineCount)
	for (const [, c] of commits) {
		if (!c.author.name) continue;
		if (authors.has(c.author.name)) continue;
		authors.set(c.author.name, { name: c.author.name, lineCount: 0, current: c.author.current });
	}

	return {
		repoPath: cleanBlame.repoPath,
		authors: authors,
		commits: commits,
		lines: dirtyBlameLines,
	};
}

function makeUncommittedLine(dirtyIndex: number): GitCommitLine {
	return {
		sha: uncommitted,
		line: dirtyIndex + 1,
		originalLine: 0,
	};
}

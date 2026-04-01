import type { TextDocumentContentChangeEvent } from 'vscode';
import type { GitBlame } from '@gitlens/git/models/blame.js';
import type { GitCommitLine } from '@gitlens/git/models/commit.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { buildDirtyBlame, diffLineMapping } from '@gitlens/git/utils/blame.utils.js';
import { fnv1aHash } from '@gitlens/utils/hash.js';

/** Lightweight record of a document edit, captured from TextDocumentContentChangeEvent */
export interface EditRecord {
	/** 0-based start line of the edit in the document (in at-time-of-edit coordinates) */
	readonly startLine: number;
	/** Number of newlines removed by the edit (range.end.line - range.start.line) */
	readonly linesRemoved: number;
	/** Number of newlines inserted by the edit (count of \n in replacement text) */
	readonly linesInserted: number;
}

/** Split text into lines, stripping trailing \r for CRLF compatibility */
function splitLines(text: string): string[] {
	const lines = text.split('\n');
	// Strip trailing \r so lines match VS Code's lineAt().text (which excludes line endings)
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].endsWith('\r')) {
			lines[i] = lines[i].slice(0, -1);
		}
	}
	return lines;
}

/** Compute FNV-1a hashes for an array of lines */
function hashLines(lines: readonly string[]): Uint32Array {
	const hashes = new Uint32Array(lines.length);
	for (let i = 0; i < lines.length; i++) {
		hashes[i] = fnv1aHash(lines[i]);
	}
	return hashes;
}

/**
 * Captures the baseline state from a clean blame result.
 * Created once when a clean blame is obtained and reused across edits to serve
 * dirty blame from memory without spawning git processes.
 *
 * The public `blame` field is always working-tree-indexed and safe for consumers.
 * An optional HEAD-anchored baseline is stored privately for dirty-blame computation
 * to enable restored-line attribution.
 */
export class BlameSnapshot {
	/** When edit records exceed this threshold, Tier 3 is skipped (forces Tier 4) */
	private static readonly maxEditRecords = 50;

	/** Working-tree-indexed blame — always safe for consumers to use directly */
	readonly blame: GitBlame;
	/** Working-tree text lines (used for Tier 3 content verification when no HEAD baseline) */
	readonly lines: readonly string[];
	/** Working-tree line hashes (used for Tier 4 diff when no HEAD baseline) */
	readonly hashes: Uint32Array;

	/** Optional HEAD-anchored baseline for dirty-blame computation (restored-line attribution) */
	private _headBlame: GitBlame | undefined;
	private _headLines: readonly string[] | undefined;
	private _headHashes: Uint32Array | undefined;

	private _editRecords: EditRecord[] = [];
	private _createdAt: number = Date.now();
	private _initialMappedCount: number = 0;
	private _cachedDirtyBlame:
		| { version: number; blame: GitBlame; lines: readonly string[]; hashes: Uint32Array }
		| undefined;

	/** Max age before forcing a reset regardless of drift (safety net) */
	private static readonly maxAge = 5 * 60 * 1000;
	/** Drift threshold — reset when this fraction of originally-mapped lines are lost */
	private static readonly maxDrift = 0.2;

	get editRecordCount(): number {
		return this._editRecords.length;
	}

	constructor(blame: GitBlame, documentText: string);
	constructor(blame: GitBlame, lines: readonly string[], hashes: Uint32Array);
	constructor(blame: GitBlame, textOrLines: string | readonly string[], hashes?: Uint32Array) {
		this.blame = blame;
		if (typeof textOrLines === 'string') {
			this.lines = splitLines(textOrLines);
			this.hashes = hashLines(this.lines);
		} else {
			this.lines = textOrLines;
			this.hashes = hashes!;
		}
		this._initialMappedCount = countMappedLines(blame);
	}

	/**
	 * Create a snapshot with a HEAD-anchored baseline for dirty-blame computation.
	 * The public `blame` remains the working-tree-indexed blame (safe for consumers).
	 * The HEAD-anchored data is stored privately and used when computing dirty blame
	 * so that lines edited back to their committed content get the original commit.
	 */
	static fromHead(workingTreeBlame: GitBlame, workingTreeText: string, headContent: string): BlameSnapshot {
		const headLines = splitLines(headContent);
		const wtLines = splitLines(workingTreeText);

		const headHashes = hashLines(headLines);
		const wtHashes = hashLines(wtLines);

		// Diff HEAD (baseline) vs working tree (dirty) to establish line mapping
		const mapping = diffLineMapping(headHashes, headLines, wtLines);

		// Invert: HEAD middle offset → working tree middle offset
		const headMiddleLen = mapping.baseMiddleEnd - mapping.baseMiddleStart;
		const inverseMiddle: (number | undefined)[] = new Array(headMiddleLen).fill(undefined);
		for (let di = 0; di < mapping.middleMapping.length; di++) {
			const hi = mapping.middleMapping[di];
			if (hi != null) {
				inverseMiddle[hi] = di;
			}
		}

		// Build HEAD-indexed blame lines from working tree blame
		const headBlameLines: GitCommitLine[] = new Array(headLines.length);

		// Prefix: HEAD line i → working tree line i (1:1)
		for (let i = 0; i < mapping.prefixLen; i++) {
			const wtLine = workingTreeBlame.lines[i];
			if (wtLine != null) {
				headBlameLines[i] = { ...wtLine, line: i + 1 };
			}
		}

		// Middle: use inverse mapping to find corresponding working tree line
		for (let hi = 0; hi < headMiddleLen; hi++) {
			const headIdx = mapping.baseMiddleStart + hi;
			const wtMiddleOffset = inverseMiddle[hi];
			if (wtMiddleOffset != null) {
				const wtIdx = mapping.dirtyMiddleStart + wtMiddleOffset;
				const wtLine = workingTreeBlame.lines[wtIdx];
				if (wtLine != null) {
					headBlameLines[headIdx] = { ...wtLine, line: headIdx + 1 };
				}
			}
		}

		// Suffix: HEAD line from end → working tree line from end (1:1)
		const wtLen = wtLines.length;
		for (let si = 0; si < mapping.suffixLen; si++) {
			const headIdx = headLines.length - mapping.suffixLen + si;
			const wtIdx = wtLen - mapping.suffixLen + si;
			const wtLine = workingTreeBlame.lines[wtIdx];
			if (wtLine != null) {
				headBlameLines[headIdx] = { ...wtLine, line: headIdx + 1 };
			}
		}

		const headBlame: GitBlame = {
			repoPath: workingTreeBlame.repoPath,
			authors: workingTreeBlame.authors,
			commits: workingTreeBlame.commits,
			lines: headBlameLines,
		};

		// Public blame stays working-tree-indexed; HEAD data is private baseline
		const snapshot = new BlameSnapshot(workingTreeBlame, wtLines, wtHashes);
		snapshot._headBlame = headBlame;
		snapshot._headLines = headLines;
		snapshot._headHashes = headHashes;
		return snapshot;
	}

	/** The effective baseline blame for dirty-blame computation (HEAD-anchored if available) */
	private get baselineBlame(): GitBlame {
		return this._headBlame ?? this.blame;
	}

	/** The effective baseline lines for dirty-blame computation */
	private get baselineLines(): readonly string[] {
		return this._headLines ?? this.lines;
	}

	/** The effective baseline hashes for dirty-blame computation */
	private get baselineHashes(): Uint32Array {
		return this._headHashes ?? this.hashes;
	}

	/**
	 * Record an edit from a TextDocumentContentChangeEvent.
	 * O(1) per call — just pushes a lightweight record.
	 */
	recordEdit(change: TextDocumentContentChangeEvent): void {
		const startLine = change.range.start.line;
		const linesRemoved = change.range.end.line - change.range.start.line;

		let linesInserted = 0;
		const text = change.text;
		for (let i = 0; i < text.length; i++) {
			if (text.charCodeAt(i) === 0x0a /* \n */) {
				linesInserted++;
			}
		}

		// Only record edits that change line counts — same-line character edits
		// can't affect line mapping and would waste slots toward the cap
		if (linesRemoved !== 0 || linesInserted !== 0) {
			this._editRecords.push({
				startLine: startLine,
				linesRemoved: linesRemoved,
				linesInserted: linesInserted,
			});
		}
		// Always invalidate Tier 4 cache — content changed even if line count didn't
		this._cachedDirtyBlame = undefined;
	}

	/**
	 * Record content changes from a TextDocumentContentChangeEvent array.
	 * Sorts by position to handle multi-cursor edits safely.
	 */
	recordContentChanges(contentChanges: readonly TextDocumentContentChangeEvent[]): void {
		if (contentChanges.length === 1) {
			this.recordEdit(contentChanges[0]);
			return;
		}

		// Sort by start position to ensure correct "at-time-of-edit" coordinate tracking.
		// VS Code doesn't guarantee ordering for multi-cursor edits.
		const sorted = contentChanges.toSorted(
			(a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character,
		);
		for (const change of sorted) {
			this.recordEdit(change);
		}
	}

	/**
	 * Tier 3: Map a dirty document line back to its baseline line index.
	 * Reverse-walks edit records to undo each edit's effect.
	 * O(E) where E = number of edit records (typically 1-5).
	 */
	private mapLineToBaseline(dirtyLine: number): number {
		if (this._editRecords.length > BlameSnapshot.maxEditRecords) {
			return -1;
		}

		let line = dirtyLine;

		for (let i = this._editRecords.length - 1; i >= 0; i--) {
			const edit = this._editRecords[i];
			const editEndInDoc = edit.startLine + edit.linesInserted;

			if (line >= editEndInDoc) {
				// Line is after this edit — undo the edit's line count change
				line = line - edit.linesInserted + edit.linesRemoved;
			} else if (line >= edit.startLine) {
				// Line is inside this edit's inserted region — no baseline mapping
				return -1;
			}
			// line < edit.startLine — line is before this edit, unaffected
		}

		return line;
	}

	/**
	 * Tier 3: Get blame for a single dirty line.
	 * Maps the dirty line to a baseline line via incremental edit tracking,
	 * then verifies by content comparison.
	 */
	getBlameForDirtyLine(dirtyLine: number, dirtyLineText: string): GitCommitLine | undefined {
		// MUST use this.blame and this.lines, because edit records track coordinates
		// relative to the snapshot's public working tree state, NOT the hidden HEAD baseline.
		const baseline = this.blame;
		const baseLines = this.lines;
		const baselineIndex = this.mapLineToBaseline(dirtyLine);

		if (baselineIndex < 0 || baselineIndex >= baseline.lines.length) {
			return undefined;
		}

		// Content verification: confirm the mapping is correct
		if (baseLines[baselineIndex] === dirtyLineText) {
			const cleanLine = baseline.lines[baselineIndex];
			if (cleanLine != null) {
				return { ...cleanLine, line: dirtyLine + 1 };
			}
		}

		// Content mismatch — mapping drifted or line was edited
		return undefined;
	}

	/**
	 * Tier 4: Compute full dirty blame via line-level diff.
	 * Uses FNV-1a hash comparison with string verification for speed.
	 * Results are cached by document version.
	 */
	computeDirtyBlame(dirtyText: string, documentVersion: number): GitBlame {
		if (this._cachedDirtyBlame?.version === documentVersion) {
			return this._cachedDirtyBlame.blame;
		}

		const dirtyLines = splitLines(dirtyText);
		const dirtyHashes = hashLines(dirtyLines);

		const baseHashes = this.baselineHashes;
		const baseLines = this.baselineLines;
		const baseBlame = this.baselineBlame;

		const mapping = diffLineMapping(baseHashes, baseLines, dirtyLines, dirtyHashes);
		const dirtyBlame = buildDirtyBlame(baseBlame, mapping, dirtyLines.length);

		this._cachedDirtyBlame = {
			version: documentVersion,
			blame: dirtyBlame,
			lines: dirtyLines,
			hashes: dirtyHashes,
		};

		return dirtyBlame;
	}

	/**
	 * Returns whether this snapshot should be discarded in favor of a fresh git blame.
	 * Considers both drift (lost line mappings) and staleness (time since original blame).
	 * @param minInterval — minimum ms between resets (typically the last blame duration)
	 */
	shouldReset(minInterval: number): boolean {
		const elapsed = Date.now() - this._createdAt;

		// Throttle: never refresh faster than the last blame took
		if (elapsed < minInterval) return false;

		// Drift: check if we've lost too many originally-mapped lines
		const currentMapped = countMappedLines(this.blame);
		const reference = Math.max(Math.min(this._initialMappedCount, this.blame.lines.length), 1);
		const driftRatio = 1 - currentMapped / reference;
		if (driftRatio > BlameSnapshot.maxDrift) return true;

		// Safety net: force reset after max age regardless of drift
		if (elapsed > BlameSnapshot.maxAge) return true;

		return false;
	}

	/**
	 * Create a new snapshot updated to the current dirty state.
	 * Reuses cached dirty lines/hashes to avoid redundant split+hash.
	 */
	update(dirtyText: string, documentVersion: number): BlameSnapshot {
		const dirtyBlame = this.computeDirtyBlame(dirtyText, documentVersion);
		const cached = this._cachedDirtyBlame;
		let snapshot: BlameSnapshot;
		if (cached != null) {
			snapshot = new BlameSnapshot(dirtyBlame, cached.lines, cached.hashes);
		} else {
			snapshot = new BlameSnapshot(dirtyBlame, dirtyText);
		}
		// Preserve original blame metadata across updates
		snapshot._createdAt = this._createdAt;
		snapshot._initialMappedCount = this._initialMappedCount;

		// Propagate the original baseline (HEAD or the very first clean blame)
		// so continuous typing/saving doesn't accumulate diff drift.
		snapshot._headBlame = this.baselineBlame;
		snapshot._headLines = this.baselineLines;
		snapshot._headHashes = this.baselineHashes;
		return snapshot;
	}
}

function countMappedLines(blame: GitBlame): number {
	let count = 0;
	for (const line of blame.lines) {
		if (line != null && line.sha !== uncommitted) {
			count++;
		}
	}
	return count;
}

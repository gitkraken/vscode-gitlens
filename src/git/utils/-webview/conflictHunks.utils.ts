const startMarker = /^<<<<<<<($|[ \t])/;
const baseMarker = /^\|\|\|\|\|\|\|($|[ \t])/;
const separatorMarker = /^=======($|[ \t])/;
const endMarker = /^>>>>>>>($|[ \t])/;

export interface ConflictRegion {
	/** 0-based line index of the first content line (inclusive). */
	startLine: number;
	/** 0-based line index of the marker line that ends the region (exclusive). */
	endLine: number;
	/** Content lines of the region (no line endings). */
	lines: string[];
}

export interface ConflictHunk {
	/** Sequential index within the file (0-based). */
	index: number;
	/** 0-based line index of the `<<<<<<<` marker. */
	startLine: number;
	/** 0-based line index of the `>>>>>>>` marker. */
	endLine: number;
	/** Label after the `<<<<<<<` marker (typically `HEAD` or branch name). */
	currentLabel: string;
	/** Label after the `>>>>>>>` marker (typically the incoming branch/ref). */
	incomingLabel: string;
	/** Label after the `|||||||` marker — present only for diff3-style conflicts. */
	baseLabel?: string;
	/** Current/ours side content. */
	current: ConflictRegion;
	/** Incoming/theirs side content. */
	incoming: ConflictRegion;
	/** Base side content — present only for diff3-style conflicts (`merge.conflictstyle=diff3`). */
	base?: ConflictRegion;
}

export interface ParsedConflicts {
	/** Source split into lines, without line endings. */
	lines: string[];
	/** Detected line-ending style for the file. */
	eol: '\n' | '\r\n';
	/** All well-formed conflict hunks discovered in source order. */
	hunks: ConflictHunk[];
	/** True when at least one hunk carried a `|||||||` base section. */
	hasDiff3: boolean;
	/** True when an opened hunk was abandoned because of malformed markers. */
	unbalanced: boolean;
}

export function parseConflictHunks(text: string): ParsedConflicts {
	const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(/\r?\n/);
	if (lines.length > 0 && lines.at(-1) === '') {
		lines.pop();
	}

	const hunks: ConflictHunk[] = [];
	let hasDiff3 = false;
	let unbalanced = false;

	let i = 0;
	while (i < lines.length) {
		if (!startMarker.test(lines[i])) {
			i++;
			continue;
		}

		const hunkStart = i;
		const currentLabel = labelFor(lines[i]);
		i++;
		const currentStartLine = i;

		let currentEndLine = -1;
		let baseStartLine = -1;
		let baseEndLine = -1;
		let baseLabel: string | undefined;
		let incomingStartLine = -1;
		let incomingEndLine = -1;
		let incomingLabel = '';
		let hunkEndLine = -1;

		while (i < lines.length) {
			if (baseMarker.test(lines[i])) {
				currentEndLine = i;
				baseLabel = labelFor(lines[i]);
				i++;
				baseStartLine = i;
				hasDiff3 = true;
				break;
			}
			if (separatorMarker.test(lines[i])) {
				currentEndLine = i;
				i++;
				incomingStartLine = i;
				break;
			}
			if (startMarker.test(lines[i]) || endMarker.test(lines[i])) {
				unbalanced = true;
				break;
			}

			i++;
		}
		if (currentEndLine === -1) {
			unbalanced = true;
			break;
		}

		if (baseStartLine !== -1) {
			while (i < lines.length) {
				if (separatorMarker.test(lines[i])) {
					baseEndLine = i;
					i++;
					incomingStartLine = i;
					break;
				}
				if (startMarker.test(lines[i]) || baseMarker.test(lines[i]) || endMarker.test(lines[i])) {
					unbalanced = true;
					break;
				}

				i++;
			}
			if (baseEndLine === -1) {
				unbalanced = true;
				break;
			}
		}

		while (i < lines.length) {
			if (endMarker.test(lines[i])) {
				incomingEndLine = i;
				incomingLabel = labelFor(lines[i]);
				hunkEndLine = i;
				i++;
				break;
			}
			if (startMarker.test(lines[i]) || baseMarker.test(lines[i]) || separatorMarker.test(lines[i])) {
				unbalanced = true;
				break;
			}

			i++;
		}
		if (hunkEndLine === -1) {
			unbalanced = true;
			break;
		}

		hunks.push({
			index: hunks.length,
			startLine: hunkStart,
			endLine: hunkEndLine,
			currentLabel: currentLabel,
			incomingLabel: incomingLabel,
			baseLabel: baseLabel,
			current: {
				startLine: currentStartLine,
				endLine: currentEndLine,
				lines: lines.slice(currentStartLine, currentEndLine),
			},
			incoming: {
				startLine: incomingStartLine,
				endLine: incomingEndLine,
				lines: lines.slice(incomingStartLine, incomingEndLine),
			},
			base:
				baseStartLine !== -1
					? {
							startLine: baseStartLine,
							endLine: baseEndLine,
							lines: lines.slice(baseStartLine, baseEndLine),
						}
					: undefined,
		});
	}

	return { lines: lines, eol: eol, hunks: hunks, hasDiff3: hasDiff3, unbalanced: unbalanced };
}

function labelFor(line: string): string {
	return line.slice(7).trim();
}

/**
 * Rewrites a parsed conflict file by replacing each hunk with a caller-supplied resolution.
 *
 * Resolutions are keyed by `hunk.index`. Hunks without a resolution are left as-is — useful for
 * partial saves where some conflicts remain unresolved. Returns the rewritten text with the
 * file's original line endings preserved.
 */
export function applyResolutions(parsed: ParsedConflicts, resolutions: ReadonlyMap<number, readonly string[]>): string {
	const out: string[] = [];
	let cursor = 0;
	for (const hunk of parsed.hunks) {
		while (cursor < hunk.startLine) {
			out.push(parsed.lines[cursor++]);
		}
		const resolution = resolutions.get(hunk.index);
		if (resolution != null) {
			for (const l of resolution) {
				out.push(l);
			}
		} else {
			// No resolution provided — preserve the original conflict markers and content.
			while (cursor <= hunk.endLine) {
				out.push(parsed.lines[cursor++]);
			}
			continue;
		}
		cursor = hunk.endLine + 1;
	}
	while (cursor < parsed.lines.length) {
		out.push(parsed.lines[cursor++]);
	}
	return out.join(parsed.eol);
}

/** Per-substitution input for {@link applyResolutionsWithSources}: lines + per-line source tag. */
export interface HunkSubstitution<Source extends string> {
	lines: readonly string[];
	sources: readonly Source[];
}

/** Same shape as {@link applyResolutions}, but also returns the per-line origin so consumers can
 *  decorate the output (e.g., green-check gutter for picked lines). Lines outside any hunk get
 *  the caller's `contextSource`. */
export function applyResolutionsWithSources<Source extends string>(
	parsed: ParsedConflicts,
	substitutions: ReadonlyMap<number, HunkSubstitution<Source>>,
	contextSource: Source,
): { text: string; sources: Source[] } {
	const outLines: string[] = [];
	const outSources: Source[] = [];
	let cursor = 0;
	for (const hunk of parsed.hunks) {
		while (cursor < hunk.startLine) {
			outLines.push(parsed.lines[cursor++]);
			outSources.push(contextSource);
		}
		const sub = substitutions.get(hunk.index);
		if (sub != null) {
			for (let i = 0; i < sub.lines.length; i++) {
				outLines.push(sub.lines[i]);
				outSources.push(sub.sources[i] ?? contextSource);
			}
			cursor = hunk.endLine + 1;
		} else {
			while (cursor <= hunk.endLine) {
				outLines.push(parsed.lines[cursor++]);
				outSources.push(contextSource);
			}
		}
	}
	while (cursor < parsed.lines.length) {
		outLines.push(parsed.lines[cursor++]);
		outSources.push(contextSource);
	}
	return { text: outLines.join(parsed.eol), sources: outSources };
}

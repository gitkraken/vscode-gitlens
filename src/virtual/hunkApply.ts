/**
 * Minimal in-house unified-diff hunk applier. Takes a base file's bytes and an ordered list of
 * hunks (same shape as `ComposerHunk`), returns the post-apply bytes. No git process spawn, no
 * object-store writes — pure in-memory transformation.
 *
 * Hunk line numbers must be relative to `base` and hunks must be ordered ascending by `oldStart`;
 * context and deleted lines are verified against `base`, so a violation throws rather than silently
 * splicing. There is deliberately no `git apply`-style offset search.
 *
 * Scope: text content. Binary and intent-to-add hunks are passed through as no-ops
 * (caller should detect binary mode upstream). Pure renames (no content change) return the base
 * unchanged. "\ No newline at end of file" markers are honored when present at hunk boundaries.
 */

/** Minimal shape required for {@link applyHunks}. `ComposerHunk` satisfies this structurally. */
export interface ApplyableHunk {
	/** Unified-diff hunk header, e.g. `@@ -12,7 +12,9 @@` or `@@ -12 +12 @@`. */
	readonly hunkHeader: string;
	/** Hunk body: one line per entry with leading ` `/`+`/`-`, separated by `\n`. */
	readonly content: string;
	/** When true, the hunk is purely a rename header; no content change. */
	readonly isRename?: boolean;
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });
const textEncoder = new TextEncoder();

interface HunkRange {
	readonly oldStart: number;
	readonly oldCount: number;
	readonly newStart: number;
	readonly newCount: number;
}

const hunkHeaderRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

function parseHunkHeader(header: string): HunkRange | undefined {
	const m = header.match(hunkHeaderRegex);
	if (m == null) return undefined;
	return {
		oldStart: Number(m[1]),
		oldCount: m[2] != null ? Number(m[2]) : 1,
		newStart: Number(m[3]),
		newCount: m[4] != null ? Number(m[4]) : 1,
	};
}

/**
 * Apply `hunks` in order on top of `base`. Returns the resulting bytes.
 *
 * Empty/undefined base is treated as "new file" — typically only `+` lines will appear in hunks.
 *
 * @throws when a hunk header is malformed, or when a context/deleted line doesn't match the base at
 * the position the header points at.
 */
export function applyHunks(base: Uint8Array | undefined, hunks: readonly ApplyableHunk[]): Uint8Array {
	// Pure-rename commits change metadata, not content.
	if (hunks.length === 0 || hunks.every(h => h.isRename === true)) {
		return base ?? new Uint8Array(0);
	}

	const baseText = base != null && base.byteLength > 0 ? textDecoder.decode(base) : '';
	const { eol, endsWithEol } = detectLineTerminator(baseText);

	// Split base into lines without their terminators — we add eol back on join.
	const baseLines = baseText.length === 0 ? [] : baseText.split(/\r\n|\n/);
	// `split` on a trailing EOL produces a final empty element — drop it so the line count reflects
	// content lines, matching unified-diff semantics.
	if (endsWithEol && baseLines.length > 0 && baseLines.at(-1) === '') {
		baseLines.pop();
	}

	const out: string[] = [];
	let cursor = 0; // 0-based index into baseLines
	let trailingEolSuppressed = false;

	for (const hunk of hunks) {
		if (hunk.isRename === true) continue;

		const range = parseHunkHeader(hunk.hunkHeader);
		if (range == null) {
			throw new Error(`applyHunks: malformed hunk header: '${hunk.hunkHeader}'`);
		}

		// Copy unchanged base lines up to the hunk's start. Diff line numbers are 1-based; a
		// header of `-N` aligns with base index `N-1` for the first consumed line.
		const targetIdx = Math.max(0, range.oldStart - 1);
		if (targetIdx < cursor) {
			throw new Error(
				`applyHunks: hunk '${hunk.hunkHeader}' starts before the previous hunk ended (base line ${String(cursor + 1)}) — hunks must be ordered ascending by old-side start`,
			);
		}

		// A diff taken against this base can't point past its end, so an out-of-range start means the
		// hunks belong to some other content. Additions-only bodies have no line to verify, so without
		// this they would collapse onto EOF and append silently. `targetIdx === baseLines.length` is
		// the legitimate append-at-EOF case.
		if (targetIdx > baseLines.length) {
			throw new Error(
				`applyHunks: hunk '${hunk.hunkHeader}' starts past the end of the base (${String(baseLines.length)} lines) — these hunks don't belong to this base`,
			);
		}

		while (cursor < targetIdx && cursor < baseLines.length) {
			out.push(baseLines[cursor]);
			cursor++;
		}

		// Walk hunk body lines. Split on \n only — unified diff uses LF between hunk lines.
		const body = hunk.content.endsWith('\n') ? hunk.content.slice(0, -1) : hunk.content;
		const bodyLines = body.length === 0 ? [] : body.split('\n');
		let prevMarker = '';
		for (const bodyLine of bodyLines) {
			if (bodyLine.length === 0) {
				// Rare but legal: an empty line in the body corresponds to a context line that was
				// itself empty. Treat as a context match.
				out.push(matchBaseLine(baseLines, cursor, '', hunk.hunkHeader));
				cursor++;
				prevMarker = ' ';
				continue;
			}

			const marker = bodyLine[0];
			const text = bodyLine.slice(1);
			switch (marker) {
				case ' ':
					out.push(matchBaseLine(baseLines, cursor, text, hunk.hunkHeader));
					cursor++;
					break;
				case '-':
					matchBaseLine(baseLines, cursor, text, hunk.hunkHeader);
					cursor++;
					break;
				case '+':
					// With no base line to check against, go by the base's own terminator: when it
					// isn't CRLF a trailing CR is real content rather than a terminator artifact.
					out.push(eol === '\r\n' && text.endsWith('\r') ? text.slice(0, -1) : text);
					break;
				case '\\':
					// "\ No newline at end of file" describes the line above it, so after a deletion it
					// is the old side that was unterminated — which says nothing about the result.
					if (prevMarker !== '-') {
						trailingEolSuppressed = true;
					}
					break;
				default:
					// Unknown marker — treat as context (defensive; permissive parsing matches git behavior).
					out.push(bodyLine);
					cursor++;
					break;
			}

			prevMarker = marker;
		}
	}

	// A "\ No newline at end of file" marker only appears where the diff reaches EOF, so it decides
	// the result's ending only when a hunk consumed through the last base line. When the hunks
	// stopped short, the untouched tail carries the base's own ending forward.
	const hunksReachedEof = cursor >= baseLines.length;

	// Copy any remaining unchanged tail.
	while (cursor < baseLines.length) {
		out.push(baseLines[cursor]);
		cursor++;
	}

	const terminated = hunksReachedEof ? !trailingEolSuppressed : endsWithEol;
	const joined = out.join(eol);
	return textEncoder.encode(terminated && out.length > 0 ? `${joined}${eol}` : joined);
}

/**
 * Resolve a context/deleted hunk line against the base line it claims to consume, returning the
 * base's own text. A CRLF base's diff carries that CR inside each body line while `baseLines` was
 * split on the full terminator, so a trailing CR is tolerated only when dropping it is what makes
 * the two agree; a line that still disagrees after that is a genuine mismatch.
 */
function matchBaseLine(baseLines: readonly string[], cursor: number, text: string, hunkHeader: string): string {
	const actual = baseLines[cursor];
	if (actual === text) return actual;
	if (text.endsWith('\r') && actual === text.slice(0, -1)) return actual;

	throw new Error(
		`applyHunks: hunk '${hunkHeader}' does not match the base at line ${String(cursor + 1)}: expected '${text}', found ${actual == null ? 'end of file' : `'${actual}'`}`,
	);
}

/** Detect the dominant line terminator in `text` and whether the text ends with one. */
function detectLineTerminator(text: string): { eol: string; endsWithEol: boolean } {
	if (text.length === 0) return { eol: '\n', endsWithEol: false };

	// Count occurrences; CRLF wins only if it's the majority (avoids classifying mixed-LF files as CRLF).
	let crlf = 0;
	let lf = 0;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10 /* \n */) {
			if (i > 0 && text.charCodeAt(i - 1) === 13 /* \r */) {
				crlf++;
			} else {
				lf++;
			}
		}
	}
	const eol = crlf > lf ? '\r\n' : '\n';
	const last = text.charCodeAt(text.length - 1);
	const endsWithEol = last === 10; /* \n */
	return { eol: eol, endsWithEol: endsWithEol };
}

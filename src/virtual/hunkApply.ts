/**
 * Minimal in-house unified-diff hunk applier. Takes a base file's bytes and an ordered list of
 * hunks (same shape as `ComposerHunk`), returns the post-apply bytes. No git process spawn, no
 * object-store writes — pure in-memory transformation.
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
		while (cursor < targetIdx && cursor < baseLines.length) {
			out.push(baseLines[cursor]);
			cursor++;
		}

		// Walk hunk body lines. Split on \n only — unified diff uses LF between hunk lines.
		const body = hunk.content.endsWith('\n') ? hunk.content.slice(0, -1) : hunk.content;
		const bodyLines = body.length === 0 ? [] : body.split('\n');
		for (const line of bodyLines) {
			if (line.length === 0) {
				// Rare but legal: an empty line in the body corresponds to a context line that was
				// itself empty. Treat as a context match.
				out.push('');
				cursor++;
				continue;
			}
			const marker = line[0];
			const text = line.slice(1);
			switch (marker) {
				case ' ':
					out.push(text);
					cursor++;
					break;
				case '-':
					cursor++;
					break;
				case '+':
					out.push(text);
					break;
				case '\\':
					// "\ No newline at end of file". The preceding line (added or context) should not
					// gain a trailing EOL when we rejoin.
					trailingEolSuppressed = true;
					break;
				default:
					// Unknown marker — treat as context (defensive; permissive parsing matches git behavior).
					out.push(line);
					cursor++;
					break;
			}
		}
	}

	// Copy any remaining unchanged tail.
	while (cursor < baseLines.length) {
		out.push(baseLines[cursor]);
		cursor++;
	}

	const joined = out.join(eol);
	const final = !trailingEolSuppressed && (endsWithEol || out.length > 0) ? `${joined}${eol}` : joined;
	return textEncoder.encode(final);
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

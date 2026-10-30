// Annotates diff to make is easier for agentic reference to line number.
// Brackets sit AFTER the line-type marker so file-level diff parsers
// (e.g. `filterDiffFiles`) that key off `diff --git` / `+++` / `---` headers still work.
export function annotateDiffWithNewLineNumbers(diff: string): string {
	if (!diff) return diff;

	const lines = diff.split('\n');
	const out: string[] = new Array(lines.length);
	let newLine = 0;
	let inHunk = false;
	// What the hunk header says is left of the hunk on each side. Inside a counted hunk every line is
	// content — a removed `-- comment` reads as `--- comment`, an added `++x` as `+++x` — so the header
	// check below applies only once the counts run out (or when a header had none to read)
	let oldLeft = 0;
	let newLeft = 0;
	let counted = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (inHunk && counted) {
			if (oldLeft > 0 || newLeft > 0) {
				const marker = line[0];
				if (marker === '\\') {
					out[i] = line;
					continue;
				}

				if (marker === '-' && oldLeft > 0) {
					oldLeft--;
					out[i] = `-[     ]${line.slice(1)}`;
					continue;
				}

				if (marker === '+' && newLeft > 0) {
					newLeft--;
					out[i] = `+[${String(newLine).padStart(5, ' ')}]${line.slice(1)}`;
					newLine++;
					continue;
				}

				// An empty context line can lose its leading space to an editor or a copy
				if ((marker === ' ' || line === '') && oldLeft > 0 && newLeft > 0) {
					oldLeft--;
					newLeft--;
					out[i] = ` [${String(newLine).padStart(5, ' ')}]${line.slice(1)}`;
					newLine++;
					continue;
				}
			}

			inHunk = false;
		}

		if (line.startsWith('@@')) {
			const match = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
			counted = match != null;
			if (match != null) {
				oldLeft = match[1] != null ? parseInt(match[1], 10) : 1;
				newLine = parseInt(match[2], 10);
				newLeft = match[3] != null ? parseInt(match[3], 10) : 1;
			} else {
				const start = /\+(\d+)(?:,\d+)?\s/.exec(line);
				newLine = start != null ? parseInt(start[1], 10) : 0;
			}
			inHunk = true;
			out[i] = line;
			continue;
		}

		if (
			line.startsWith('diff --git') ||
			line.startsWith('index ') ||
			line.startsWith('--- ') ||
			line.startsWith('+++ ') ||
			line.startsWith('new file') ||
			line.startsWith('deleted file') ||
			line.startsWith('rename ') ||
			line.startsWith('copy ') ||
			line.startsWith('similarity ') ||
			line.startsWith('dissimilarity ') ||
			line.startsWith('Binary files')
		) {
			inHunk = false;
			out[i] = line;
			continue;
		}

		if (!inHunk || line.startsWith('\\')) {
			out[i] = line;
			continue;
		}

		const marker = line[0];
		if (marker === '-') {
			out[i] = `-[     ]${line.slice(1)}`;
			continue;
		}
		if (marker === '+' || marker === ' ') {
			out[i] = `${marker}[${String(newLine).padStart(5, ' ')}]${line.slice(1)}`;
			newLine++;
			continue;
		}

		out[i] = line;
	}

	return out.join('\n');
}

const annotatedNewLineRegex = /^[+ ]\[\s*(\d+)\](.*)$/;

/**
 * The new-side text an {@link annotateDiffWithNewLineNumbers} diff shows for each line number, by
 * new-side path. A path can appear in several parts of one diff (unstaged, staged and commit diffs
 * concatenated), each numbering its own new side, so a number can carry more than one text.
 */
export function getAnnotatedNewLines(annotatedDiff: string): Map<string, Map<number, string[]>> {
	const files = new Map<string, Map<number, string[]>>();
	let current: Map<number, string[]> | undefined;
	let previous: string | undefined;

	for (const line of annotatedDiff.split('\n')) {
		const before = previous;
		previous = line;

		const match = annotatedNewLineRegex.exec(line);
		if (match != null) {
			if (current == null) continue;

			const lineNumber = parseInt(match[1], 10);
			const texts = current.get(lineNumber);
			if (texts == null) {
				current.set(lineNumber, [match[2]]);
			} else {
				texts.push(match[2]);
			}
			continue;
		}

		// A file's new-side header always follows its old-side one; an unannotated `+++ ` anywhere else is
		// content, not a switch to another file
		if (line.startsWith('+++ ') && before?.startsWith('--- ')) {
			let path = line.slice(4).trimEnd();
			if (path.startsWith('"') && path.endsWith('"')) {
				path = path.slice(1, -1);
			}
			if (path === '/dev/null') {
				current = undefined;
				continue;
			}

			if (path.startsWith('b/')) {
				path = path.slice(2);
			}
			current = files.get(path);
			if (current == null) {
				current = new Map();
				files.set(path, current);
			}
			continue;
		}

		if (line.startsWith('diff --git')) {
			current = undefined;
		}
	}

	return files;
}

/**
 * Moves a line range quoted against an annotated diff onto the file it belongs to: verifies the range's
 * first non-blank quoted line against `target` and, when it isn't there, shifts the range to the nearest
 * place that text is. Returns the range unchanged when nothing quoted can be checked, and `undefined`
 * when the quoted text isn't in `target` at all.
 */
export function reanchorLineRange(
	range: { readonly start: number; readonly end: number },
	quoted: ReadonlyMap<number, readonly string[]>,
	target: readonly string[],
): { start: number; end: number } | undefined {
	let anchor: number | undefined;
	let texts: string[] | undefined;
	for (let n = range.start; n <= range.end; n++) {
		const candidates = quoted
			.get(n)
			?.map(t => t.trimEnd())
			.filter(t => t.trim().length > 0);
		if (candidates?.length) {
			anchor = n;
			texts = candidates;
			break;
		}
	}
	if (anchor == null || texts == null) return { start: range.start, end: range.end };

	const matches = (lineNumber: number): boolean => {
		const text = target[lineNumber - 1]?.trimEnd();
		return text != null && texts.includes(text);
	};
	if (matches(anchor)) return { start: range.start, end: range.end };

	for (let distance = 1; distance < target.length; distance++) {
		for (const lineNumber of [anchor - distance, anchor + distance]) {
			if (lineNumber < 1 || lineNumber > target.length || !matches(lineNumber)) continue;

			const offset = lineNumber - anchor;
			return {
				start: Math.max(1, range.start + offset),
				end: Math.min(target.length, Math.max(range.start, range.end) + offset),
			};
		}
	}
	return undefined;
}

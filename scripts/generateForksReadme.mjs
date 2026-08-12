//@ts-check

/** Matches a `<!-- #vscode -->…<!-- /#vscode -->` span, capturing the optional `: <replacement>` on the closing tag. */
const VSCODE_SPAN = /<!--\s*#vscode\s*-->([\s\S]*?)<!--\s*\/#vscode(?::([\s\S]*?))?\s*-->/g;

/**
 * Transforms GitLens' `README.md` into the fork-neutral variant published to Open VSX.
 *
 * `README.md` itself is the VS Code build, unchanged &mdash; the markers are HTML comments, which
 * render as nothing. One construct:
 *
 * - `<!-- #vscode -->VS Code<!-- /#vscode: your editor -->` replaces the span, tags included, with
 *   the closing tag's text.
 * - Omit the `:` part and the span is dropped instead. Spans may cover whole lines, so an entire
 *   paragraph is dropped by opening at the end of the line before it and closing at the end of the
 *   paragraph's own last line.
 *
 * Both tags must sit at the end of a line that already has content, never at the start of one: a
 * line beginning with `<!--` is an HTML block, so CommonMark stops processing the markdown inside
 * it and backticks and `**bold**` would render literally on the marketplace. A standalone comment
 * line is doubly wrong &mdash; `oxfmt` pads it out into its own block, splitting lists.
 *
 * @param {string} contents
 * @returns {string}
 */
export function generateForksReadme(contents) {
	let markerCount = 0;

	const replaced = contents.replace(VSCODE_SPAN, (_match, _kept, replacement) => {
		markerCount++;
		return replacement != null ? replacement.trim() : '';
	});

	// Any marker text still standing means an unbalanced or misspelled tag
	const leftover = replaced.indexOf('#vscode');
	if (leftover !== -1) {
		const line = replaced.slice(0, leftover).split('\n').length;
		throw new Error(`generateForksReadme: unbalanced or malformed marker on line ${line}`);
	}

	if (markerCount === 0) {
		throw new Error(
			'generateForksReadme: no #vscode markers found in README.md — the fork variant would ship the VS Code text verbatim',
		);
	}

	const result = `${replaced.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}\n`;
	if (result === contents) {
		throw new Error('generateForksReadme: output is identical to the input');
	}

	return result;
}

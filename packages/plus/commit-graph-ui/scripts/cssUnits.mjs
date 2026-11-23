import postcss from 'postcss';

/** @typedef {{ start: number; end: number; text: string }} CssEdit */

export const graphRemProperty = '--gl-graph-rem';

const remLengthPattern =
	/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\)|\/\*[\s\S]*?\*\/|(?<![\w.#-])([+-]?\d*\.?\d+(?:e[+-]?\d+)?)rem(?![\w-])/gi;

/**
 * @param {string} css
 * @returns {CssEdit[]}
 */
export function graphRemEdits(css) {
	/** @type {CssEdit[]} */
	const edits = [];
	postcss.parse(css).walkDecls(decl => {
		const start = decl.source?.start?.offset;
		if (start == null) return;

		const value = decl.raws.value?.raw ?? decl.value;
		const valueStart = start + decl.prop.length + (decl.raws.between ?? '').length;
		if (css.slice(valueStart, valueStart + value.length) !== value) {
			throw new Error(`Unable to locate the value of \`${decl.prop}\` at offset ${start}`);
		}

		for (const match of value.matchAll(remLengthPattern)) {
			const number = match[1];
			if (number == null) continue;

			edits.push({
				start: valueStart + match.index,
				end: valueStart + match.index + match[0].length,
				text: `calc(${number}*var(${graphRemProperty},10px))`,
			});
		}
	});
	return edits;
}

/**
 * @param {string} css
 * @returns {string}
 */
export function toGraphRem(css) {
	let result = '';
	let last = 0;
	for (const edit of graphRemEdits(css)) {
		result += css.slice(last, edit.start) + edit.text;
		last = edit.end;
	}
	return result + css.slice(last);
}

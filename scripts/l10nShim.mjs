/**
 * @param {unknown} source
 * @returns {boolean}
 */
export function isGraphL10nShim(source) {
	return (
		source === '@gitkraken/commit-graph/l10n.js' ||
		(typeof source === 'string' && source.startsWith('.') && /(^|\/)l10n\.js$/.test(source))
	);
}

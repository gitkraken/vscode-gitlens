// KEEP: plain .mjs — issues-label-areas.yml imports it without a TypeScript loader.
// KEEP: a match means the issue mentions the area, not that the area caused it; never map it to `blocked: *`.

/** @type {Array<{ label: string; patterns: RegExp[] }>} */
export const areaSignalRules = [
	{
		label: 'area-cli',
		patterns: [
			/\bgk(?:\.exe)?\s+(?:version|mcp|ai|AI|auth|setup|login|agents|install|update|work)\b/,
			/\bgk\.exe\b/i,
			/\bgitkraken[\s-]?cli\b/i,
			/\bCLI (?:Core|Installer)\b/,
			/\bgk-?cli\b/i,
			/\bgkinstall/i,
		],
	},
	{
		label: 'area-mcp',
		patterns: [/\bMCP\b/i],
	},
	{
		label: 'area-core',
		patterns: [/\bcore[\s-]?gitlens\b/i, /^core:/i, /\bon `core`/i, /\bcore (?:package|v?\d+\.\d+)/i],
	},
];

/**
 * @param {string} text
 * @returns {Array<{ label: string; matches: string[] }>}
 */
export function matchAreaSignals(text) {
	const signals = [];
	for (const rule of areaSignalRules) {
		const matches = [];
		for (const pattern of rule.patterns) {
			const match = text.match(pattern);
			if (match != null) {
				matches.push(match[0]);
			}
		}

		if (matches.length) {
			signals.push({ label: rule.label, matches: matches });
		}
	}

	return signals;
}

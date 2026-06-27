#!/usr/bin/env node
// Scans shared webview components for color-token adoption and prints a standalone status report.
// Ad-hoc tool for eyeballing migration progress off legacy --color-* onto --gl-color-*; run by hand,
// not wired into the build. Classification per file's color sourcing:
//   new-tokens  uses var(--gl-color-*)
//   legacy      uses var(--color-*)
//   vscode-direct  only var(--vscode-*)
//   hardcoded   hex / rgb()/hsl() literals (excluding var() fallbacks)
//   mixed       a --gl-* hook plus vscode/legacy/hardcoded
//   none        no color at all
// Usage: node scripts/styleguide/scanAdoption.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../src/webviews/apps/shared/components/', import.meta.url).pathname;

/** @param {string} dir */
function* walk(dir) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) yield* walk(p);
		else if (/\.(ts|scss)$/.test(name) && !/\.(test|stories)\./.test(name)) yield p;
	}
}

/** @param {string} src */
function classify(src) {
	const glColor = /var\(--gl-color-/.test(src);
	const glOther = /var\(--gl-(?!color-)/.test(src);
	const legacy = /var\(--color-/.test(src);
	const vscode = /var\(--vscode-/.test(src);
	// hex / rgb literals that are NOT inside a var(..., #fallback)
	const literal = /(^|[^,(\s])\s*#[0-9a-fA-F]{3,8}\b|(?:^|[\s:(])(?:rgb|rgba|hsl|hsla)\(/m.test(
		src.replace(/var\([^)]*\)/g, ''),
	);

	if (!glColor && !glOther && !legacy && !vscode && !literal) return 'none';
	if (glColor && !legacy && !literal && !vscode) return 'new-tokens';
	if (legacy && !glColor) return 'mixed-legacy';
	if (literal && !glColor) return 'hardcoded';
	if (glColor || glOther) return 'mixed';
	if (vscode && !legacy && !literal) return 'vscode-direct';
	return 'mixed';
}

const byComponent = new Map();
for (const file of walk(ROOT)) {
	// component = first path segment under components/
	const rel = file.slice(ROOT.length);
	const comp = rel.split('/')[0];
	const cls = classify(readFileSync(file, 'utf8'));
	const prev = byComponent.get(comp) ?? new Set();
	prev.add(cls);
	byComponent.set(comp, prev);
}

const rank = ['hardcoded', 'legacy', 'mixed-legacy', 'mixed', 'vscode-direct', 'new-tokens', 'none'];
const rows = [...byComponent.entries()]
	.map(([comp, set]) => {
		const classes = [...set].filter(c => c !== 'none');
		const status = classes.length === 0 ? 'none' : (rank.find(r => set.has(r)) ?? 'mixed');
		return { comp, status: status.replace('mixed-legacy', 'mixed') };
	})
	.sort((a, b) => a.comp.localeCompare(b.comp));

console.log(`Scanned ${rows.length} component folders under shared/components/\n`);
for (const { comp, status } of rows) console.log(`  ${status.padEnd(14)} ${comp}`);

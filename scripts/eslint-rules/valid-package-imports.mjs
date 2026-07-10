// @ts-check

// The host resolves `@gitlens/*` through tsconfig `paths` and bundler aliases, both of which point
// at `packages/*/src` and bypass the packages' `exports` maps entirely. Nothing else checks host
// imports against the surface a package actually declares, so this rule does.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scope = '@gitlens/';

/** @type {Map<string, Record<string, unknown>>} */
const exportsByPackage = loadPackageExports();

export default {
	meta: {
		type: 'problem',
		docs: {
			description: "Require @gitlens/* imports to name a subpath the target package's `exports` exposes",
			recommended: true,
		},
		messages: {
			bare: '`{{specifier}}` has no root export; import a subpath such as `{{package}}/<module>.js`',
			extension: '@gitlens/* imports must end with a .js extension',
			notExported:
				'`{{subpath}}` is not exported by {{package}}. Add it to that package\'s "exports" if it is meant to be public.',
		},
		fixable: 'code',
		schema: [],
	},
	/** @param {import('@oxlint/plugins').Context} context */
	createOnce(context) {
		/** @param {{ value: unknown, raw?: string }} source */
		const check = source => {
			const specifier = source.value;
			if (typeof specifier !== 'string' || !specifier.startsWith(scope)) return;

			const slash = specifier.indexOf('/', scope.length);
			const name = slash === -1 ? specifier : specifier.slice(0, slash);

			const exported = exportsByPackage.get(name);
			// Not one of ours (or a package without an `exports` map) — nothing to validate against.
			if (exported == null) return;

			if (slash === -1) {
				context.report({ node: source, messageId: 'bare', data: { specifier: specifier, package: name } });
				return;
			}

			const subpath = `.${specifier.slice(slash)}`;
			if (!subpath.endsWith('.js')) {
				// Only `.ts` and an extensionless final segment have an unambiguous `.js` form. Appending
				// to anything else (`.mjs`, `.json`, a trailing slash) would autofix into a broken specifier.
				const segment = subpath.slice(subpath.lastIndexOf('/') + 1);
				const fixable = subpath.endsWith('.ts') || (segment.length > 0 && !segment.includes('.'));

				context.report({
					node: source,
					messageId: 'extension',
					fix: fixable
						? fixer => {
								const quote = source.raw?.[0] ?? "'";
								const base = subpath.endsWith('.ts') ? specifier.slice(0, -3) : specifier;
								return fixer.replaceText(source, `${quote}${base}.js${quote}`);
							}
						: null,
				});
				return;
			}

			if (!isExported(exported, subpath)) {
				context.report({ node: source, messageId: 'notExported', data: { subpath: subpath, package: name } });
			}
		};

		return {
			ImportDeclaration(node) {
				check(node.source);
			},
			ExportNamedDeclaration(node) {
				if (node.source != null) check(node.source);
			},
			ExportAllDeclaration(node) {
				if (node.source != null) check(node.source);
			},
		};
	},
};

/**
 * Node's subpath resolution: an exact key wins, otherwise the best pattern by PATTERN_KEY_COMPARE.
 * A `null` target blocks the subpath. Per-condition `null` (`{ default: null }`) is not modelled —
 * no manifest uses it.
 *
 * @param {Record<string, unknown>} exported
 * @param {string} subpath
 */
function isExported(exported, subpath) {
	if (Object.hasOwn(exported, subpath)) return exported[subpath] !== null;

	/** @type {string | undefined} */
	let match;

	for (const key of Object.keys(exported)) {
		const star = key.indexOf('*');
		// Exactly one `*`, or Node ignores the key.
		if (star === -1 || key.lastIndexOf('*') !== star) continue;

		if (!subpath.startsWith(key.slice(0, star)) || !subpath.endsWith(key.slice(star + 1))) continue;
		// `*` must capture at least one character, i.e. subpath is no shorter than the key itself.
		if (subpath.length < key.length) continue;

		if (match == null || isMoreSpecific(key, match)) match = key;
	}

	return match != null && exported[match] !== null;
}

/** Node's PATTERN_KEY_COMPARE: longest base before `*` wins, then the longest key. */
function isMoreSpecific(key, against) {
	const keyBase = key.indexOf('*');
	const againstBase = against.indexOf('*');
	if (keyBase !== againstBase) return keyBase > againstBase;

	return key.length > against.length;
}

/** @returns {Map<string, Record<string, unknown>>} */
function loadPackageExports() {
	/** @type {Map<string, Record<string, unknown>>} */
	const out = new Map();

	for (const searchRoot of [path.join(repoRoot, 'packages'), path.join(repoRoot, 'packages', 'plus')]) {
		if (!existsSync(searchRoot)) continue;

		let entries;
		try {
			entries = readdirSync(searchRoot);
		} catch {
			continue;
		}

		for (const entry of entries) {
			const pkgJsonPath = path.join(searchRoot, entry, 'package.json');
			if (!existsSync(pkgJsonPath)) continue;

			let stats;
			try {
				stats = statSync(path.join(searchRoot, entry));
			} catch {
				continue;
			}
			if (!stats.isDirectory()) continue;

			try {
				const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
				if (typeof pkgJson.name === 'string' && pkgJson.name.startsWith(scope) && pkgJson.exports != null) {
					out.set(pkgJson.name, pkgJson.exports);
				}
			} catch {
				// Ignore malformed package.json
			}
		}
	}

	return out;
}

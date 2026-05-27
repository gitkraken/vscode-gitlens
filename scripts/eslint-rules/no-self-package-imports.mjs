// @ts-check

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {ReadonlyArray<{ name: string; root: string }>} */
const workspacePackages = loadWorkspacePackages();

/** @type {Record<string, readonly string[]>} */
const sourceExtensions = {
	'.js': ['.ts', '.tsx'],
	'.jsx': ['.tsx', '.jsx'],
	'.mjs': ['.mts', '.mjs'],
	'.cjs': ['.cts', '.cjs'],
};

/** @type {Record<string, string>} */
const importExtension = {
	'.ts': '.js',
	'.tsx': '.jsx',
	'.mts': '.mjs',
	'.cts': '.cjs',
};

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow same-package imports via the workspace package name; use a relative path instead',
			recommended: true,
		},
		messages: {
			rewriteRelative: 'Same-package import should use a relative path instead of `{{specifier}}`',
		},
		fixable: 'code',
		schema: [],
	},
	create(context) {
		const filename = context.filename;
		if (!filename || filename === '<input>' || filename === '<text>') return {};

		const owningPackage = findOwningPackage(filename);
		if (owningPackage == null) return {};

		const prefix = `${owningPackage.name}/`;
		const srcRoot = path.join(owningPackage.root, 'src');

		return {
			ImportDeclaration(node) {
				const source = node.source.value;
				if (typeof source !== 'string' || !source.startsWith(prefix)) return;

				const subPath = source.slice(prefix.length);
				const target = resolveSourceFile(srcRoot, subPath);

				context.report({
					node: node.source,
					messageId: 'rewriteRelative',
					data: { specifier: source },
					fix:
						target == null
							? null
							: fixer => {
									let rel = path.relative(path.dirname(filename), target).replace(/\\/g, '/');
									const ext = path.extname(rel);
									if (ext in importExtension) {
										rel = `${rel.slice(0, -ext.length)}${importExtension[ext]}`;
									}
									if (!rel.startsWith('.')) rel = `./${rel}`;
									return fixer.replaceText(node.source, `'${rel}'`);
								},
				});
			},
		};
	},
};

function loadWorkspacePackages() {
	/** @type {Array<{ name: string; root: string }>} */
	const out = [];
	const searchRoots = [path.join(repoRoot, 'packages'), path.join(repoRoot, 'packages', 'plus')];

	for (const searchRoot of searchRoots) {
		if (!existsSync(searchRoot)) continue;

		let entries;
		try {
			entries = readdirSync(searchRoot);
		} catch {
			continue;
		}

		for (const entry of entries) {
			const pkgDir = path.join(searchRoot, entry);
			let stats;
			try {
				stats = statSync(pkgDir);
			} catch {
				continue;
			}
			if (!stats.isDirectory()) continue;

			const pkgJsonPath = path.join(pkgDir, 'package.json');
			if (!existsSync(pkgJsonPath)) continue;

			try {
				const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
				if (typeof pkgJson.name === 'string' && pkgJson.name.length > 0) {
					out.push({ name: pkgJson.name, root: pkgDir });
				}
			} catch {
				// Ignore malformed package.json
			}
		}
	}

	// Longest root first so nested packages match before their parents.
	out.sort((a, b) => b.root.length - a.root.length);
	return out;
}

/**
 * @param {string} filename
 * @returns {{ name: string; root: string } | undefined}
 */
function findOwningPackage(filename) {
	for (const pkg of workspacePackages) {
		if (filename === pkg.root || filename.startsWith(pkg.root + path.sep)) {
			return pkg;
		}
	}
	return undefined;
}

/**
 * Map an exported sub-path (e.g. `iterable.js`, `decorators/log.js`) to its source file under `<pkg>/src`.
 *
 * @param {string} srcRoot
 * @param {string} subPath
 * @returns {string | undefined}
 */
function resolveSourceFile(srcRoot, subPath) {
	const ext = path.extname(subPath);
	const base = ext === '' ? subPath : subPath.slice(0, -ext.length);
	const candidates = sourceExtensions[ext] ?? [ext];
	for (const candidateExt of candidates) {
		const candidate = path.join(srcRoot, base + candidateExt);
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

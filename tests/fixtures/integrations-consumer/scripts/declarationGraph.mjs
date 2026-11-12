// Pure pieces of the declaration-graph check: dependency extraction from one `.d.ts` source, and the graph walk over a
// file reader. Kept free of `fs` and of the real package layout so `declarationGraph.selftest.mjs` can feed them
// adversarial synthetic sources. The repo's TypeScript is the native build with no JS compiler API, so this scans text.
// It is deliberately fail-closed: anything shaped like a module specifier that it cannot classify is reported.

import { dirname, relative, resolve } from 'node:path';

// Bare specifiers no published declaration may import.
export const forbiddenPackages = [/^@gitkraken\/provider-apis(?:\/|$)/];
// Modules (relative to `dist/`) that hold the package's internal implementation.
export const forbiddenModules = [
	/^plus\/integrations\/models\/(?:gitHostIntegration|issuesIntegration|integration)\.d\.ts$/,
	/^plus\/integrations\/integrationService\.d\.ts$/,
	/^plus\/integrations\/providers\/(?:models|providersApi)\.d\.ts$/,
];

/**
 * Replaces comments with whitespace, leaving string and template literals intact (so `"http://x"` isn't cut at `//`).
 * Newlines are preserved so line structure survives.
 */
/** The four JS line terminators: LF, CR, U+2028, U+2029. */
function isLineTerminator(c) {
	return c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';
}

export function stripComments(source) {
	let out = '';
	let i = 0;
	while (i < source.length) {
		const c = source[i];
		const n = source[i + 1];
		if (c === '/' && n === '/') {
			while (i < source.length && !isLineTerminator(source[i])) i++;
		} else if (c === '/' && n === '*') {
			const end = source.indexOf('*/', i + 2);
			const stop = end === -1 ? source.length : end + 2;
			out += source.slice(i, stop).replace(/[^\n\r\u2028\u2029]/g, ' ');
			i = stop;
		} else if (c === '"' || c === "'" || c === '`') {
			let j = i + 1;
			while (j < source.length && source[j] !== c) {
				if (source[j] === '\\') j++;
				else if (isLineTerminator(source[j]) && c !== '`') break;
				j++;
			}
			out += source.slice(i, j + 1);
			i = j + 1;
		} else {
			out += c;
			i++;
		}
	}
	return out;
}

// Each pattern captures the quote in group 1 and the specifier in group 2, and is matched with `d` so the literal's
// position can be compared against the loose scan below.
const patterns = [
	// import ... from "x" / import type ... from "x" / export ... from "x" / export * [as ns] from "x" (multi-line ok)
	{ kind: 'import-from', re: /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(["'])([^"'\n\r\u2028\u2029]*)\1/dg },
	// import "x"
	{ kind: 'import-side-effect', re: /\bimport\s*(["'])([^"'\n\r\u2028\u2029]*)\1/dg },
	// import("x") / import("x", { with: ... })
	{ kind: 'import-type-expression', re: /\bimport\s*\(\s*(["'])([^"'\n\r\u2028\u2029]*)\1\s*[,)]/dg },
	// import x = require("x") / require("x")
	{ kind: 'require', re: /\brequire\s*\(\s*(["'])([^"'\n\r\u2028\u2029]*)\1\s*\)/dg },
	// declare module "x" { ... } / module "x"
	{ kind: 'module-augmentation', re: /\bmodule\s*(["'])([^"'\n\r\u2028\u2029]*)\1/dg },
];

// Anything that looks like it is introducing a module specifier. Every hit must have been claimed by a pattern above.
const loosePatterns = [
	/\b(?:from|import|module)\s*(["'`])/dg,
	/\b(?:import|require)\s*\(\s*(["'`])/dg,
	/\b(?:import|require)\s*\(\s*(?!["'`\s])/dg,
	/\brequire\s*\(\s*(?!["'`\s])/dg,
];

/**
 * Finds every module a declaration source depends on.
 * @param {string} source raw `.d.ts` text
 * @returns {{ kind: string, specifier: string }[]} `kind: 'unclassified'` entries carry a snippet and always fail the check
 */
export function findDependencies(rawSource) {
	// A leading BOM would hide a first-line `///` directive from the line-leading match.
	const source = rawSource.startsWith('\uFEFF') ? rawSource.slice(1) : rawSource;
	const found = [];

	// Triple-slash directives are comments, so extract them from the raw text before stripping.
	for (const m of source.matchAll(/^[ \t]*\/\/\/.*<(reference|amd-dependency)\b.*$/gm)) {
		const attrs = new Map();
		for (const a of m[0].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
			attrs.set(a[1], a[3]);
		}

		let recognized = false;
		if (m[1] === 'reference') {
			if (attrs.has('types')) {
				found.push({ kind: 'reference-types', specifier: attrs.get('types') });
				recognized = true;
			}
			if (attrs.has('path')) {
				found.push({ kind: 'reference-path', specifier: attrs.get('path') });
				recognized = true;
			}
			if (attrs.has('lib') || /\bno-default-lib\b/.test(m[0])) {
				recognized = true; // a built-in lib, not a package or file
			}
		} else if (attrs.has('path')) {
			found.push({ kind: 'amd-dependency', specifier: attrs.get('path') });
			recognized = true;
		}

		if (!recognized) {
			found.push({ kind: 'unclassified', specifier: m[0].trim() });
		}
	}

	const code = stripComments(source);
	const claimed = new Set();
	for (const { kind, re } of patterns) {
		for (const m of code.matchAll(re)) {
			claimed.add(m.indices[1][0]);
			found.push({ kind: kind, specifier: m[2] });
		}
	}

	for (const re of loosePatterns) {
		for (const m of code.matchAll(re)) {
			const at = m.indices[1]?.[0] ?? m.index + m[0].length;
			if (!claimed.has(at)) {
				claimed.add(at);
				found.push({ kind: 'unclassified', specifier: code.slice(m.index, m.index + 60).split('\n')[0] });
			}
		}
	}

	// A specifier written with an escape (`"@gitkraken/\u0070rovider-apis"`) would dodge every pattern match. Rejecting is
	// simpler and safer than decoding, and no published declaration has a reason to escape a module name.
	return found.map(d =>
		d.kind !== 'unclassified' && d.specifier.includes('\\')
			? { kind: 'unclassified', specifier: `escaped specifier "${d.specifier}"` }
			: d,
	);
}

/** Specifiers that name a location outside the package: absolute POSIX, `file:` URL, drive-qualified, or UNC. */
const absoluteSpecifier = /^(?:[/\\]|file:|[A-Za-z]:)/i;

/** Resolves a relative specifier (or a `reference path`) from `from` to a declaration file the reader can supply. */
export function resolveDeclaration(from, specifier, kind, read) {
	const target = resolve(dirname(from), specifier);
	const candidates = [];
	if (kind === 'reference-path') {
		candidates.push(target, `${target}.d.ts`, `${target}.ts`);
	} else if (target.endsWith('.js')) {
		candidates.push(`${target.slice(0, -3)}.d.ts`);
	} else if (target.endsWith('.d.ts')) {
		candidates.push(target);
	} else {
		candidates.push(`${target}.d.ts`);
	}
	return candidates.find(c => read(c) != null) ?? candidates.at(-1) ?? target;
}

/**
 * Walks the declaration graph from `entries`.
 * @param {{ entries: string[], root: string, read: (file: string) => string | undefined, forbiddenPackages: RegExp[], forbiddenModules: RegExp[] }} options
 *   `root` is the package root (paths in messages are relative to it); `forbiddenModules` match paths relative to `root/dist`.
 * @returns {{ failures: string[], missing: string[], reached: Map<string, string | undefined> }}
 */
export function walkDeclarations({ entries, root, read, forbiddenPackages, forbiddenModules }) {
	const failures = [];
	const missing = [];
	/** Each reached file, mapped to the file that first reached it. */
	const reached = new Map();
	const queue = [];

	for (const entry of entries) {
		reached.set(entry, undefined);
		queue.push(entry);
	}

	const chainTo = file => {
		const chain = [];
		for (let current = file; current != null; current = reached.get(current)) {
			chain.unshift(relative(root, current).replaceAll('\\', '/'));
		}
		return chain.join(' -> ');
	};
	const distRoot = resolve(root, 'dist');

	while (queue.length > 0) {
		const file = queue.shift();
		const distPath = relative(distRoot, file).replaceAll('\\', '/');
		if (forbiddenModules.some(p => p.test(distPath))) {
			failures.push(`reaches an internal module: ${chainTo(file)}`);
		}

		const source = read(file);
		if (source == null) {
			missing.push(`${chainTo(file)} could not be read`);
			continue;
		}

		for (const { kind, specifier } of findDependencies(source)) {
			if (kind === 'unclassified') {
				failures.push(`unclassifiable module reference \`${specifier}\`: ${chainTo(file)}`);
			} else if (absoluteSpecifier.test(specifier)) {
				failures.push(
					`absolute ${kind} \`${specifier}\` is not allowed in a published declaration: ${chainTo(file)}`,
				);
			} else if (kind === 'reference-path' || specifier.startsWith('.')) {
				const target = resolveDeclaration(file, specifier, kind, read);
				if (relative(root, target).startsWith('..')) {
					failures.push(`${kind} ${specifier} escapes the package: ${chainTo(file)}`);
				} else if (read(target) == null) {
					missing.push(`${relative(root, file)} references ${specifier}, which has no declaration file`);
				} else if (!reached.has(target)) {
					reached.set(target, file);
					queue.push(target);
				}
			} else if (forbiddenPackages.some(p => p.test(specifier))) {
				failures.push(`${kind} ${specifier}: ${chainTo(file)}`);
			}
		}
	}

	return { failures: failures, missing: missing, reached: reached };
}

// Load every bundled module under plain Node ESM.
//
// The published package keeps third-party dependencies external, so CJS->ESM interop is resolved by
// whatever loads it. Bundled hosts (webpack for the VS Code extension, esbuild for the package tests)
// bind named exports of a CommonJS dependency correctly, but Node's `cjs-module-lexer` only sees
// statically analyzable `exports.*` assignments — a named value import of an SDK that declares its
// exports through getters makes the importing module unlinkable, and nothing in the bundled builds
// notices. Importing each file here reproduces exactly what a Node ESM consumer does, including the
// lazily loaded modules a smoke test of the public entry points alone would never reach.

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(scriptDir);
const distDir = join(packageRoot, 'dist');

/**
 * @param {string} dir
 * @param {string[]} [files]
 * @param {string[]} [extensions]
 * @returns {Promise<string[]>}
 */
async function collect(dir, files = [], extensions = ['.js']) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			await collect(path, files, extensions);
		} else if (extensions.some(ext => entry.name.endsWith(ext))) {
			files.push(path);
		}
	}
	return files;
}

const specifierRegex = /(?:\bfrom\s*|\bimport\s*\(\s*|\bexport\s*\*\s*from\s*)['"]([^'"]+)['"]/g;

/**
 * The two specifier rules the published package lives or dies by, checked against what was actually
 * emitted rather than against the bundler's configuration:
 *
 * 1. No `@gitlens/*` may survive. Those packages are workspace-internal and never published, so a
 *    leftover specifier is a module no consumer can resolve.
 * 2. `#env/*` MUST survive, and only in the shapes the manifest's `imports` map declares. That map is
 *    what picks the node or browser tree at the CONSUMER's resolution time — inlining it here would
 *    silently pick one for everyone.
 */
async function verifySpecifiers() {
	const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
	const importPatterns = Object.keys(manifest.imports ?? {});
	const failures = [];

	for (const file of await collect(distDir, [], ['.js', '.d.ts'])) {
		const text = await readFile(file, 'utf8');
		const where = relative(distDir, file);

		for (const [, specifier] of text.matchAll(specifierRegex)) {
			if (specifier.startsWith('@gitlens/')) {
				failures.push(`${where}: internal specifier "${specifier}" survived the bundle`);
				continue;
			}
			if (!specifier.startsWith('#')) continue;

			// Only `<prefix>*<suffix>` patterns exist here; match the specifier against each.
			const pattern = importPatterns.find(p => {
				const star = p.indexOf('*');
				if (star < 0) return p === specifier;
				return specifier.startsWith(p.slice(0, star)) && specifier.endsWith(p.slice(star + 1));
			});
			if (pattern == null) {
				failures.push(`${where}: subpath import "${specifier}" matches no pattern in the manifest's imports`);
				continue;
			}

			// A pattern that resolves to a file the tarball doesn't contain fails only at the consumer.
			const star = pattern.indexOf('*');
			const wildcard = specifier.slice(star, specifier.length - (pattern.length - star - 1));
			for (const target of targetsOf(manifest.imports[pattern])) {
				const resolved = join(packageRoot, target.replaceAll('*', wildcard));
				if (!existsSync(resolved)) {
					failures.push(
						`${where}: "${specifier}" resolves to a missing file (${relative(packageRoot, resolved)})`,
					);
				}
			}
		}
	}

	return failures;
}

/** Flattens a conditional exports/imports value down to its target path strings. */
function* targetsOf(value) {
	if (typeof value === 'string') {
		yield value;
	} else if (value != null && typeof value === 'object') {
		for (const inner of Object.values(value)) {
			yield* targetsOf(inner);
		}
	}
}

async function main() {
	const files = await collect(distDir);
	if (!files.length) {
		throw new Error(
			`No modules found in ${distDir} — run \`pnpm --filter @gitkraken/core-gitlens run build\` first.`,
		);
	}

	const failures = [];
	for (const file of files) {
		try {
			await import(pathToFileURL(file).href);
		} catch (ex) {
			failures.push([relative(distDir, file), `${ex?.name ?? 'Error'}: ${String(ex?.message).split('\n')[0]}`]);
		}
	}

	if (failures.length) {
		console.error(`[core-gitlens verify-esm] ${failures.length} of ${files.length} modules failed to load:`);
		for (const [file, message] of failures) {
			console.error(`  ${file}\n    ${message}`);
		}
		process.exitCode = 1;
		return;
	}

	const specifierFailures = await verifySpecifiers();
	if (specifierFailures.length) {
		console.error(`[core-gitlens verify-esm] ${specifierFailures.length} specifier problems:`);
		for (const failure of specifierFailures) {
			console.error(`  ${failure}`);
		}
		process.exitCode = 1;
		return;
	}

	console.log(`[core-gitlens verify-esm] ${files.length} modules loaded, specifiers verified`);
}

await main();

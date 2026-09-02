// Assembles the publishable `@gitkraken/core-gitlens` package around the `dist/` that tsdown emits.
//
// Package scope encodes publication: `@gitkraken/*` is published for other GitKraken products,
// `@gitlens/*` is workspace-internal and never published. A published manifest therefore cannot
// carry a `workspace:*` dependency on a `@gitlens/*` package — the tarball has to contain that code.
//
// `dist/` is tsdown's: it compiles the sub-packages' sources straight into core's layout, and its source
// maps carry the sources themselves, so the specifier rewriting, source-map rebasing and the dist and
// src copying this file used to do are gone. What is left is everything the bundler has no opinion about:
//   1. Rewrite the `@gitlens/<pkg>` mentions that survive in the emitted declarations' doc comments
//   2. Copy LICENSE files
//   3. Hand the manifest to the caller so it can write the generated `exports`/`imports`/`dependencies`
//
// Source packages keep `private: true` and their existing shape; only the publisher is published.

import { existsSync } from 'node:fs';
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

/**
 * @typedef {object} BundledPackage
 * @property {string} name Workspace package name, e.g. `@gitlens/utils`
 * @property {string} srcDir Repo-relative source directory, e.g. `packages/utils`
 * @property {string} dest Destination subpath inside the publisher, e.g. `utils` or `plus/ai`
 * @property {string[]} [publicExports] When set, only these export patterns are re-exported
 */

const distName = 'dist';
const srcName = 'src';

/**
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {string} options.packageRoot Absolute root of the publishing package
 * @param {BundledPackage[]} options.packages
 * @param {string} options.publishedName Published name, used to rewrite doc mentions
 * @param {string} options.logPrefix
 * @param {() => Promise<void>} [options.clean]
 * @param {string[]} [options.licenses] Repo-relative LICENSE files to copy into the package
 * @param {(manifest: Record<string, unknown>) => Promise<void>} options.updateManifest
 */
export async function bundleWorkspacePackages(options) {
	const { logPrefix, packages, packageRoot } = options;
	const log = msg => console.log(`${logPrefix} ${msg}`);

	// The manifest generated below addresses `dist/`, so publishing without it would ship an exports map
	// pointing at nothing. tsdown owns that directory; this script never writes into it.
	if (!existsSync(join(packageRoot, distName))) {
		throw new Error(
			`No ${distName}/ in ${packageRoot}. Run tsdown first — the package's \`bundle\` script does both.`,
		);
	}

	await assertNoStrayDeclarations(options);

	if (options.clean != null) {
		log('Cleaning previous bundle output');
		await options.clean();
	}

	// tsdown already resolved every real import in dist/, so this pass exists for the ones it cannot see:
	// `@gitlens/*` paths written inside JSDoc, as `{@link import('@gitlens/git/context.js').X}`. They are
	// comment text to the bundler but a broken link to whoever reads the published types.
	log('Rewriting @gitlens/* doc mentions in emitted declarations');
	await rewriteSpecifiers(options, join(packageRoot, distName), ['.js', '.d.ts']);

	if (options.licenses?.length) {
		log('Copying LICENSE files');
		for (const license of options.licenses) {
			await cp(join(options.repoRoot, license), join(packageRoot, license));
		}
	}

	log('Generating exports and merging dependencies in package.json');
	const manifestPath = join(packageRoot, 'package.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	await options.updateManifest(manifest);
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);

	log(`Bundle complete -> ${relative(options.repoRoot, packageRoot)}`);
}

/**
 * Refuses to bundle while compiled declarations are sitting in a sub-package's source tree.
 *
 * The declaration compiler writes a `.d.ts` BESIDE its source whenever the `rootDir` it is given does not
 * contain that source — a tsconfig mistake, not a code one, and a silent one: it scatters thousands of
 * files through the workspace. Here specifically, the bundler's `src/**` entry globs would pick them up as
 * entries and emit a stray empty module beside each real one. That never announces itself, so check instead.
 */
async function assertNoStrayDeclarations(options) {
	const stray = [];

	for (const pkg of options.packages) {
		const srcRoot = join(options.repoRoot, pkg.srcDir, srcName);
		if (!existsSync(srcRoot)) continue;

		for await (const file of walk(srcRoot)) {
			if (file.endsWith('.d.ts') || file.endsWith('.d.ts.map')) {
				stray.push(relative(options.repoRoot, file));
			}
		}
	}

	if (stray.length) {
		throw new Error(
			`${stray.length} compiled declaration file(s) are sitting in sub-package source trees, e.g.\n` +
				`${stray
					.slice(0, 5)
					.map(f => `  ${f}`)
					.join('\n')}\n` +
				`They are build output, not sources — delete them, then check that the tsconfig handed to the ` +
				`declaration pass has a \`rootDir\` containing every bundled source.`,
		);
	}
}

async function* walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(fullPath);
		} else if (entry.isFile()) {
			yield fullPath;
		}
	}
}

/** Only the bundled package names are matched, so an unrelated `@gitlens/…` mention can never be rewritten. */
function buildSpecifierRegexes(packages) {
	const alternation = packages.map(p => p.name.slice('@gitlens/'.length).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

	return {
		specifier: new RegExp(`(['"])@gitlens\\/(${alternation.join('|')})\\/([^'"]+)\\1`, 'g'),
		// Backtick-wrapped mentions (typical in JSDoc) so the published tarball never references the
		// internal `@gitlens/*` names. Backticks avoid false positives on URLs or incidental substrings.
		docMention: new RegExp(`\`@gitlens\\/(${alternation.join('|')})\``, 'g'),
	};
}

async function rewriteSpecifiers(options, root, extensions) {
	if (!existsSync(root)) return;

	const { docMention, specifier } = buildSpecifierRegexes(options.packages);
	const nameToDest = Object.fromEntries(options.packages.map(p => [p.name, p.dest]));

	for await (const file of walk(root)) {
		if (!extensions.some(ext => file.endsWith(ext))) continue;

		const original = await readFile(file, 'utf8');
		let rewritten = original.replace(specifier, (_match, quote, pkgName, subpath) => {
			const absTarget = join(root, nameToDest[`@gitlens/${pkgName}`], subpath);
			let rel = relative(dirname(file), absTarget).split(sep).join('/');
			if (!rel.startsWith('.')) rel = `./${rel}`;
			return `${quote}${rel}${quote}`;
		});
		rewritten = rewritten.replace(
			docMention,
			(_match, pkgName) => `\`${options.publishedName}/${nameToDest[`@gitlens/${pkgName}`]}\``,
		);

		if (original !== rewritten) {
			await writeFile(file, rewritten);
		}
	}
}

async function readSubPackageManifest(repoRoot, pkg) {
	return JSON.parse(await readFile(join(repoRoot, pkg.srcDir, 'package.json'), 'utf8'));
}

/**
 * Re-exports every bundled sub-package's own `exports` under its dest subpath, for publishers whose
 * whole public surface IS the bundled packages.
 *
 * @param {string} repoRoot
 * @param {BundledPackage[]} packages
 * @returns {Promise<Record<string, unknown>>}
 */
export async function generateBundledExports(repoRoot, packages) {
	const result = { './package.json': './package.json' };

	for (const pkg of packages) {
		const manifest = await readSubPackageManifest(repoRoot, pkg);
		for (const [pattern, value] of Object.entries(manifest.exports ?? {})) {
			if (pattern === './package.json') continue;
			if (pkg.publicExports != null && !pkg.publicExports.includes(pattern)) continue;

			result[rewriteExportPattern(pattern, pkg.dest)] = remapExportValue(value, pkg.dest);
		}
	}

	return sortExports(result);
}

/**
 * Re-declares every bundled sub-package's `imports` (its `#…` subpath map) against the copied trees.
 * `imports` resolves against the *containing* package's manifest, so a copied module's `#env/x.js`
 * would go unresolved without this — and, unlike a missing export, it breaks the publisher's own
 * bundle rather than just a consumer's deep import.
 *
 * @param {string} repoRoot
 * @param {BundledPackage[]} packages
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
export async function generateBundledImports(repoRoot, packages) {
	/** @type {Record<string, unknown>} */
	const result = {};

	for (const pkg of packages) {
		const manifest = await readSubPackageManifest(repoRoot, pkg);
		for (const [pattern, value] of Object.entries(manifest.imports ?? {})) {
			if (Object.hasOwn(result, pattern)) {
				throw new Error(`Two bundled packages declare the same subpath import: ${pattern}`);
			}
			result[pattern] = remapExportValue(value, pkg.dest);
		}
	}

	return Object.keys(result).length ? result : undefined;
}

function rewriteExportPattern(pattern, destSubpath) {
	if (pattern === '.') return `./${destSubpath}`;
	if (!pattern.startsWith('./')) {
		throw new Error(`Unexpected export pattern: ${pattern}`);
	}
	return `./${destSubpath}/${pattern.slice(2)}`;
}

function remapExportValue(value, destSubpath) {
	if (typeof value === 'string') return remapExportTargetPath(value, destSubpath);
	if (value == null || typeof value !== 'object') return value;

	return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, remapExportValue(inner, destSubpath)]));
}

function remapExportTargetPath(path, destSubpath) {
	// The bundled sub-packages are source packages: their own `exports`/`imports` point at a single
	// `./src/*.ts` string, not the `{ types, default }` pair a dist-based package uses. The publisher's
	// manifest still has to address what tsdown actually emits — its own `dist/*.js` plus tsdown's sibling
	// `.d.ts` — so a source path expands back into that pair rather than collapsing the publisher's own
	// contract to a bare string.
	if (path.startsWith('./src/')) {
		const withoutExt = path.slice('./src/'.length).replace(/\.tsx?$/, '');
		return {
			types: `./dist/${destSubpath}/${withoutExt}.d.ts`,
			default: `./dist/${destSubpath}/${withoutExt}.js`,
		};
	}
	if (path.startsWith('./dist/')) {
		return `./dist/${destSubpath}/${path.slice('./dist/'.length)}`;
	}
	return path;
}

/**
 * `exports` has an ordering convention: specific patterns come before globs, and `./package.json`
 * goes first. We sort lexicographically with `./package.json` pinned first, which is good enough for
 * Node's resolver.
 *
 * @param {Record<string, unknown>} exports
 * @returns {Record<string, unknown>}
 */
function sortExports(exports) {
	const entries = Object.entries(exports);
	entries.sort(([a], [b]) => {
		if (a === './package.json') return -1;
		if (b === './package.json') return 1;
		return a.localeCompare(b);
	});
	return Object.fromEntries(entries);
}

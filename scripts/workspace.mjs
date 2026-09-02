// The workspace packages the extension bundles from source, whatever their scope. Their runtime
// dependencies ship inside dist/ just like the root's own, so anything reasoning about what we
// distribute (e.g. third-party licence notices) has to look at their manifests too.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCatalogSpec } from './catalog.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** @returns {string[]} Absolute directories, one per workspace package the root manifest bundles into
 *  GitLens — keyed on the `workspace:` protocol, not the scope, so the published `@gitkraken/*` graph
 *  packages (compiled into the webviews via aliases) are scanned for licences and watched like the rest. */
export function getBundledPackageDirs() {
	const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
	const bundled = Object.entries(rootManifest.dependencies ?? {})
		.filter(([, spec]) => String(spec).startsWith('workspace:'))
		.map(([name]) => name);

	const dirs = [];
	for (const parent of [join(repoRoot, 'packages'), join(repoRoot, 'packages', 'plus')]) {
		if (!existsSync(parent)) continue;

		for (const entry of readdirSync(parent)) {
			const manifestPath = join(parent, entry, 'package.json');
			if (!existsSync(manifestPath)) continue;

			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
			if (bundled.includes(manifest.name)) dirs.push(join(parent, entry));
		}
	}

	if (dirs.length !== bundled.length) {
		const found = new Set(dirs.map(dir => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name));
		const missing = bundled.filter(name => !found.has(name));
		throw new Error(`Could not locate every bundled workspace package under packages/: ${missing.join(', ')}`);
	}
	return dirs;
}

// Browser-only packages are bundled into the GitLens webviews, but do not belong in the published
// host/core SDK, and the `@gitkraken/*` graph packages publish on their own. Keep this list explicit:
// being a workspace package is not an assertion that it is part of @gitkraken/core-gitlens.
const coreExcludedPackageNames = new Set([
	'@gitlens/components',
	'@gitkraken/commit-graph',
	'@gitkraken/commit-graph-ui',
]);

/** @returns {string[]} Absolute directories for packages bundled into `@gitkraken/core-gitlens`. */
export function getCoreBundledPackageDirs() {
	return getBundledPackageDirs().filter(dir => {
		const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
		return !coreExcludedPackageNames.has(manifest.name);
	});
}

/** @returns {string[]} Absolute paths to the root manifest and every bundled package's manifest. */
export function getBundledManifestPaths() {
	return [join(repoRoot, 'package.json'), ...getBundledPackageDirs().map(dir => join(dir, 'package.json'))];
}

/**
 * The runtime dependencies `@gitkraken/core-gitlens` publishes: the union of the bundled packages'.
 * `packages/core/scripts/bundle.mjs` writes these into that package's manifest; `scripts/check-deps.mjs`
 * recomputes them to prove the committed copy is not stale.
 *
 * @returns {Promise<Record<string, string>>}
 */
export async function mergeBundledDependencies() {
	return mergeDependenciesFrom(getCoreBundledPackageDirs());
}

/**
 * Unions the `dependencies` of every manifest in `dirs`, keeping specifiers verbatim.
 *
 * `catalog:` is kept as-is — `pnpm publish`/`pnpm pack` rewrite it to a concrete version at pack
 * time, so the publisher tracks the catalog instead of pinning a copy that can drift. Specifiers are
 * still resolved internally, so two packages reaching different versions of the same dependency
 * (say, via different named catalogs) fails here rather than silently picking one.
 *
 * @param {string[]} dirs
 * @param {(name: string) => boolean} [include] Defaults to dropping every `@gitlens/*` entry, since
 *   those are compiled in rather than declared.
 * @returns {Promise<Record<string, string>>}
 */
async function mergeDependenciesFrom(dirs, include = name => !name.startsWith('@gitlens/')) {
	// Null-prototype: dependency names are data, and `constructor`/`__proto__` are legal npm names.
	/** @type {Record<string, string>} */
	const specs = Object.create(null);
	/** @type {Record<string, string>} */
	const versions = Object.create(null);

	for (const dir of dirs) {
		const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

		for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
			if (!include(name)) continue;

			const version = await resolveCatalogSpec(name, spec, manifest.name);
			if (Object.hasOwn(versions, name) && versions[name] !== version) {
				throw new Error(
					`Dependency version conflict on ${name}: ${versions[name]} vs ${version} (from ${manifest.name})`,
				);
			}
			versions[name] = version;
			specs[name] = spec;
		}
	}

	// Code-point order, not localeCompare: this lands in a committed, generated manifest, so it must
	// not depend on the machine's locale.
	return Object.fromEntries(Object.entries(specs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// The one place that says which @gitlens/* packages core bundles and where each lands inside it.
//
// Both halves of the build read this: `tsdown.config.ts` turns it into entry globs and output paths for
// `dist/`, and `bundle.mjs` — which no longer copies `src/` — turns it into the generated
// `exports`/`imports`/`dependencies`. If the two ever disagreed, core would ship modules its manifest
// doesn't export, or export subpaths it doesn't ship.

import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCoreBundledPackageDirs } from '../../../scripts/workspace.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** Absolute path of `packages/core`. */
export const coreRoot = dirname(scriptDir);
/** Absolute path of the repo root. */
export const repoRoot = dirname(dirname(coreRoot));

/**
 * @typedef {object} BundledPackage
 * @property {string} name Workspace package name, e.g. `@gitlens/utils`
 * @property {string} srcDir Repo-relative source directory, e.g. `packages/utils`
 * @property {string} dest Destination subpath inside core, e.g. `utils` or `plus/ai`
 * @property {string[]} [publicExports] When set, only these export patterns are re-exported
 */

/** @type {BundledPackage[]} */
export const packages = [
	{ name: '@gitlens/utils', srcDir: 'packages/utils', dest: 'utils' },
	{ name: '@gitlens/ipc', srcDir: 'packages/ipc', dest: 'ipc' },
	{ name: '@gitlens/git', srcDir: 'packages/git', dest: 'git' },
	{ name: '@gitlens/git-cli', srcDir: 'packages/git-cli', dest: 'git-cli' },
	{ name: '@gitlens/git-github', srcDir: 'packages/plus/git-github', dest: 'plus/git-github' },
	{ name: '@gitlens/ai', srcDir: 'packages/plus/ai', dest: 'plus/ai' },
	{ name: '@gitlens/agents', srcDir: 'packages/plus/agents', dest: 'plus/agents' },
	{
		name: '@gitlens/integrations',
		srcDir: 'packages/plus/integrations',
		dest: 'plus/integrations',
		// The private workspace package exposes internal subpaths for GitLens itself. Core's published facade is
		// deliberately narrower: external consumers get only the two entry points documented as semver-stable.
		publicExports: ['./index.js', './lite.js'],
	},
];

/**
 * Absolute path of a bundled package's `src/` directory.
 *
 * @param {BundledPackage} pkg
 * @returns {string}
 */
export function srcDirOf(pkg) {
	return join(repoRoot, pkg.srcDir, 'src');
}

/**
 * The array above drives what gets compiled, copied and exported; `mergeBundledDependencies()` derives its
 * own list from the root manifest to decide what gets *declared*. If the two ever disagree, core ships
 * modules whose dependencies aren't declared, or declares dependencies for code it doesn't ship — and
 * nothing downstream notices, because both sides of the check-deps comparison use the same half.
 */
export function assertPackagesMatchWorkspace() {
	const derived = getCoreBundledPackageDirs().map(dir => relative(repoRoot, dir).split(sep).join('/'));
	const declared = packages.map(p => p.srcDir);

	const missing = derived.filter(dir => !declared.includes(dir));
	const extra = declared.filter(dir => !derived.includes(dir));
	if (missing.length || extra.length) {
		throw new Error(
			`The \`packages\` array in scripts/packages.mjs is out of step with the root manifest's @gitlens/* dependencies.${
				missing.length ? ` Missing: ${missing.join(', ')}.` : ''
			}${extra.length ? ` Unknown: ${extra.join(', ')}.` : ''}`,
		);
	}
}

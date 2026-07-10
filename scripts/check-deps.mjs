// Catalogs make version drift impossible for the dependencies they cover, but nothing makes a *new*
// shared dependency land in the catalog. That is the one hole they cannot close, so we close it here:
//
//   1. A dependency with a catalog entry must be referenced as `catalog:` everywhere.
//   2. A dependency declared with a literal version in two or more manifests must move to the catalog.
//
// Together those keep exactly one version string per dependency in the workspace.

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCataloguedNames, readWorkspace } from './catalog.mjs';
import { mergeBundledDependencies } from './workspace.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// packages/core's dependencies are output, not a declaration: its bundle script mirrors the bundled
// packages' specifiers there, `catalog:` included, so it tracks the catalog rather than pinning a copy
// that could drift. Exempt from the rules below, but validated separately — the dependency *set* still
// goes stale when a package gains or drops one.
const generatedManifests = new Set(['packages/core']);

const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

// Specifiers that name something other than a registry version, so there is no version to compare.
const nonVersionProtocols = [
	'workspace:',
	'catalog:',
	'link:',
	'file:',
	'npm:',
	'git:',
	'git+',
	'github:',
	'patch:',
	'http:',
	'https:',
];

async function main() {
	const workspace = await readWorkspace();
	const catalogued = await getCataloguedNames();
	const members = (await expandMembers(workspace.packages ?? [])).filter(m => !generatedManifests.has(m));

	/** @type {Map<string, Array<{ member: string; field: string; version: string }>>} */
	const literals = new Map();
	const errors = [];

	for (const member of members) {
		const manifest = JSON.parse(await readFile(join(repoRoot, member, 'package.json'), 'utf8'));

		for (const field of dependencyFields) {
			for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
				if (typeof spec !== 'string') continue;
				if (nonVersionProtocols.some(p => spec.startsWith(p))) continue;

				if (catalogued.has(name)) {
					errors.push(
						`${member}/package.json: ${field}.${name} pins "${spec}" but ${name} has a catalog entry — use "catalog:".`,
					);
					continue;
				}

				let declarations = literals.get(name);
				if (declarations == null) {
					declarations = [];
					literals.set(name, declarations);
				}
				declarations.push({ member: member, field: field, version: spec });
			}
		}
	}

	for (const [name, declarations] of literals) {
		const declaringMembers = new Set(declarations.map(d => d.member));
		if (declaringMembers.size < 2) continue;

		const where = declarations.map(d => `${d.member} (${d.field}: ${d.version})`).join(', ');
		errors.push(
			`${name} is declared with a literal version in ${declaringMembers.size} manifests — add it to the catalog in pnpm-workspace.yaml and reference it as "catalog:". Declared in: ${where}.`,
		);
	}

	await checkGeneratedCoreManifest(errors);

	if (errors.length) {
		console.error(`[check-deps] ${errors.length} problem(s):\n`);
		for (const error of errors) {
			console.error(`  - ${error}`);
		}
		console.error('');
		// exitCode, not exit(): stderr is async on a pipe, and exiting here truncates the report.
		process.exitCode = 1;
		return;
	}

	console.log(`[check-deps] ${members.length} manifests, ${catalogued.size} catalogued dependencies — no drift`);
}

/**
 * `packages/core/package.json` is committed but generated, and nothing regenerates it when a bundled
 * package gains or drops a dependency. Recompute what its bundle script would write and require a match.
 *
 * @param {string[]} errors
 */
async function checkGeneratedCoreManifest(errors) {
	const manifestPath = join(repoRoot, 'packages', 'core', 'package.json');
	let manifest;
	try {
		manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	} catch (ex) {
		errors.push(`packages/core/package.json could not be read: ${ex.message}`);
		return;
	}

	const expected = await mergeBundledDependencies();
	const actual = manifest.dependencies ?? {};
	const stale = [];

	for (const [name, spec] of Object.entries(expected)) {
		const declared = Object.hasOwn(actual, name) ? actual[name] : undefined;
		if (declared !== spec) {
			stale.push(`${name} is ${declared ?? '<missing>'}, expected ${spec}`);
		}
	}
	for (const name of Object.keys(actual)) {
		if (!Object.hasOwn(expected, name)) {
			stale.push(`${name} is no longer a dependency of any bundled package`);
		}
	}

	if (stale.length) {
		errors.push(
			`packages/core/package.json is stale — run \`pnpm run build:core\` to regenerate it. ${stale.join('; ')}.`,
		);
	}
}

// Expands the `packages:` globs from pnpm-workspace.yaml so this stays in step with the real
// workspace rather than becoming yet another hand-maintained list of the packages.
/** @param {string[]} patterns */
async function expandMembers(patterns) {
	const members = [];

	for (const pattern of patterns) {
		if (pattern === '.') {
			members.push('.');
			continue;
		}

		if (!pattern.endsWith('/*')) {
			throw new Error(`Unsupported workspace pattern: ${pattern}`);
		}

		const parent = pattern.slice(0, -2);
		let entries;
		try {
			entries = await readdir(join(repoRoot, parent), { withFileTypes: true });
		} catch {
			continue;
		}

		// No isDirectory() filter: a Dirent for a symlinked package directory reports false. The
		// manifest probe below is the real test, and it follows links.
		for (const entry of entries) {
			const member = `${parent}/${entry.name}`;
			if (existsSync(join(repoRoot, member, 'package.json'))) {
				members.push(member);
			}
		}
	}

	return members;
}

await main();

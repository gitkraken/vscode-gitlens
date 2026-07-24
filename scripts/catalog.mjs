// Reads the dependency catalog out of pnpm-workspace.yaml.
//
// `catalog:` is a pnpm-only protocol: pnpm rewrites it to a concrete version on `pnpm publish`/`pnpm
// pack`, and nothing else does. Manifests keep the protocol; resolution here exists only so callers
// can compare what two specifiers actually mean.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** @type {Promise<Record<string, any>> | undefined} */
let workspacePromise;

export async function readWorkspace() {
	workspacePromise ??= readFile(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8').then(c => parseYaml(c) ?? {});
	return workspacePromise;
}

/** Every name with an entry in the default or any named catalog. */
export async function getCataloguedNames() {
	const workspace = await readWorkspace();

	const names = new Set(Object.keys(workspace.catalog ?? {}));
	for (const entries of Object.values(workspace.catalogs ?? {})) {
		for (const name of Object.keys(entries ?? {})) {
			names.add(name);
		}
	}
	return names;
}

/**
 * Resolves `catalog:` / `catalog:<name>` to the concrete version. Any other specifier passes through.
 * Throws rather than guessing, so a missing entry can never reach a published manifest.
 *
 * @param {string} name
 * @param {unknown} spec
 * @param {string} origin Named in the error message
 */
export async function resolveCatalogSpec(name, spec, origin) {
	if (typeof spec !== 'string' || !spec.startsWith('catalog:')) return spec;

	const catalogName = spec.slice('catalog:'.length).trim() || 'default';
	const workspace = await readWorkspace();
	const catalogs = catalogName === 'default' ? workspace.catalog : workspace.catalogs?.[catalogName];

	// `hasOwn`, not `catalogs?.[name]` — a dependency named `constructor` would otherwise resolve to
	// Object.prototype's.
	const version = catalogs != null && Object.hasOwn(catalogs, name) ? catalogs[name] : undefined;
	if (version == null) {
		throw new Error(
			`${origin} depends on ${name}@${spec}, but the ${catalogName} catalog in pnpm-workspace.yaml has no entry for ${name}`,
		);
	}
	// YAML parses an unquoted `1.10` as the number 1.1, which would silently become the wrong version.
	if (typeof version !== 'string') {
		throw new Error(
			`The ${catalogName} catalog entry for ${name} in pnpm-workspace.yaml is a ${typeof version} (${JSON.stringify(version)}); quote it so YAML keeps it a string`,
		);
	}
	return version;
}

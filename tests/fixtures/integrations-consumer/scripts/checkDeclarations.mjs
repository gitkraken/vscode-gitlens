// Fails when the published integrations declarations reach what the package is going to internalize.
//
// The integrations package is headed out of this repo, taking `@gitkraken/provider-apis` with it as an internal
// dependency. A consumer of `@gitkraken/core-gitlens` must therefore be able to type-check against the public
// `plus/integrations/*` subpaths without either one: nothing reachable from their declarations may import the SDK, or
// a module that holds the package's implementation classes. `skipLibCheck` hides such a reach from `tsc`, so this
// walks the emitted `.d.ts` graph itself (see `declarationGraph.mjs`), following every dependency form: `import`/`export ... from`,
// side-effect imports, `import("...")`, `require`, `declare module`, and `/// <reference types|path>` directives.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { forbiddenModules, forbiddenPackages, walkDeclarations } from './declarationGraph.mjs';

const coreRoot = dirname(createRequire(import.meta.url).resolve('@gitkraken/core-gitlens/package.json'));
const manifest = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8'));

const publicSubpaths = [
	'./plus/integrations/index.js',
	'./plus/integrations/lite.js',
	'./plus/integrations/constants.js',
];

const failures = [];
const entries = [];

for (const subpath of publicSubpaths) {
	const types = manifest.exports?.[subpath]?.types;
	if (types == null) {
		failures.push(`${subpath}: no "types" entry in the core manifest's exports`);
		continue;
	}

	entries.push(join(coreRoot, types));
}

const read = file => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
const result = walkDeclarations({
	entries: entries,
	root: coreRoot,
	read: read,
	forbiddenPackages: forbiddenPackages,
	forbiddenModules: forbiddenModules,
});
failures.push(...result.failures);

if (result.missing.length > 0 || failures.length > 0) {
	console.error('The public integrations declarations reach what they must not:');
	for (const line of [...failures, ...result.missing]) {
		console.error(`  ${line}`);
	}
	process.exit(1);
}

console.log(`Public integrations declarations are self-contained (${result.reached.size} files checked).`);

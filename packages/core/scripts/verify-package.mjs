// Pack Core, run the publish gates over that tarball, then install it outside the workspace and run the
// same typed/runtime fixture Kepler relies on. This catches export-map, manifest-rewrite, and declaration
// issues that workspace links bypass.

import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packages } from './packages.mjs';

// attw only analyses a wildcard `exports` entry when it is given a concrete subpath, and core's map is
// almost entirely wildcards. This is a representative spread — at least one real module per bundled
// package, plus every subpath Kepler imports today and both halves of the `#env` split.
const attwEntrypoints = [
	'./git/service.js',
	'./git/errors.js',
	'./git/cache.js',
	'./git/context.js',
	'./git/repositoryService.js',
	'./git/models/branch.js',
	'./git/parsers/diffParser.js',
	'./git/providers/operations.js',
	'./git/utils/reference.utils.js',
	'./git-cli/service.js',
	'./git-cli/cliGitProvider.js',
	'./git-cli/exec/git.js',
	'./git-cli/exec/locator.js',
	'./git-cli/parsers/logParser.js',
	'./git-cli/providers/refs.js',
	'./ipc/ipcServer.js',
	'./ipc/discovery.js',
	'./plus/integrations/index.js',
	'./plus/integrations/lite.js',
	'./plus/ai/constants.js',
	'./plus/ai/prompts.js',
	'./plus/ai/models/model.js',
	'./plus/agents/types.js',
	'./plus/agents/stateMachine.js',
	'./plus/git-github/models.js',
	'./plus/git-github/context.js',
	'./utils/event.js',
	'./utils/uri.js',
	'./utils/cancellation.js',
	'./utils/promiseCache.js',
	'./utils/env/node/exec.js',
	'./utils/env/node/platform.js',
	'./utils/keys/chord.js',
	'./utils/decorators/log.js',
];

// Every bundled package must have at least one representative entrypoint above, or attw silently skips
// checking it — the hand-written list above stays hand-written (its Kepler subpaths are a deliberate
// contract), this only guards against a package losing its last entry unnoticed.
for (const pkg of packages) {
	if (!attwEntrypoints.some(entrypoint => entrypoint.startsWith(`./${pkg.dest}/`))) {
		throw new Error(`attwEntrypoints has no entry under './${pkg.dest}/' for package ${pkg.name}`);
	}
}

/**
 * Lints the artifact a consumer actually installs, not the working tree. Both tools are devDependencies
 * of this package, so resolve their bins here rather than through PATH.
 *
 * `--level error`: publint's suggestions and warnings are advisory, and a gate that failed on them would
 * block a release on style opinions rather than on a package a consumer cannot use.
 *
 * `--profile esm-only` (the same profile the two graph packages use): core is `"type": "module"` with no
 * CJS build, so under the `node16` profile every entrypoint reports "ESM (dynamic import only)" for the
 * `require()` row and a node10 resolution failure. Both are the correct, permanent shape of an ESM-only
 * package rather than defects, so that profile would fail every release with nothing to fix short of
 * shipping a CJS build. `esm-only` drops those two rows and still checks that the types a real ESM or
 * bundler consumer resolves are right.
 */
function runPublishGates(coreRoot, tarball) {
	const bin = name => join(coreRoot, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
	const options = { cwd: coreRoot, stdio: 'inherit', shell: process.platform === 'win32' };

	execFileSync(bin('publint'), ['run', tarball, '--level', 'error'], options);
	execFileSync(
		bin('attw'),
		[tarball, '--profile', 'esm-only', '--format', 'table-flipped', '--entrypoints', ...attwEntrypoints],
		options,
	);
}

async function* walkFiles(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkFiles(fullPath);
		} else if (entry.isFile()) {
			yield fullPath;
		}
	}
}

/** The tarball ships no `src/`, and unlike a JS source map, a declaration map cannot embed its sources —
 *  every `.d.ts.map` in the installed package would point a consumer's editor at a file it doesn't have. */
async function assertNoDeclarationMaps(installedRoot) {
	const offenders = [];

	for await (const file of walkFiles(installedRoot)) {
		if (file.endsWith('.d.ts.map')) {
			offenders.push(file);
		}
	}

	if (offenders.length > 0) {
		throw new Error(
			`@gitkraken/core-gitlens ships ${offenders.length} declaration map(s) with no source to point at, e.g.\n` +
				offenders
					.slice(0, 5)
					.map(f => `  ${f}`)
					.join('\n'),
		);
	}
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const coreRoot = dirname(scriptDir);
const repoRoot = dirname(dirname(coreRoot));
const fixtureRoot = join(repoRoot, 'tests', 'fixtures', 'integrations-consumer');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const tempRoot = await mkdtemp(join(tmpdir(), 'core-gitlens-consumer-'));

try {
	const packDir = join(tempRoot, 'pack');
	const consumerDir = join(tempRoot, 'consumer');
	await mkdir(packDir, { recursive: true });
	await mkdir(consumerDir, { recursive: true });

	execFileSync(pnpm, ['pack', '--pack-destination', packDir], {
		cwd: coreRoot,
		stdio: 'inherit',
	});

	const tarballs = (await readdir(packDir)).filter(file => file.endsWith('.tgz'));
	if (tarballs.length !== 1) {
		throw new Error(`Expected one packed tarball, found ${tarballs.length}`);
	}

	const tarball = join(packDir, tarballs[0]);
	runPublishGates(coreRoot, tarball);

	await cp(join(fixtureRoot, 'src'), join(consumerDir, 'src'), { recursive: true });
	await cp(join(fixtureRoot, 'scripts'), join(consumerDir, 'scripts'), { recursive: true });
	await cp(join(fixtureRoot, 'tsconfig.json'), join(consumerDir, 'tsconfig.json'));
	await writeFile(
		join(consumerDir, 'package.json'),
		JSON.stringify(
			{
				name: 'core-gitlens-packed-consumer',
				private: true,
				version: '0.0.0',
				type: 'module',
				scripts: {
					test: 'tsc -p tsconfig.json --noEmit && node scripts/run.mjs',
				},
				dependencies: {
					'@gitkraken/core-gitlens': pathToFileURL(tarball).href,
				},
				devDependencies: {
					'@types/node': '20.16.15',
					esbuild: '0.28.1',
					typescript: '7.0.2',
				},
			},
			null,
			2,
		) + '\n',
	);

	execFileSync(pnpm, ['install', '--ignore-scripts'], {
		cwd: consumerDir,
		stdio: 'inherit',
	});
	await assertNoDeclarationMaps(join(consumerDir, 'node_modules', '@gitkraken', 'core-gitlens'));
	execFileSync(pnpm, ['test'], {
		cwd: consumerDir,
		stdio: 'inherit',
	});

	console.log('[core-gitlens verify-package] packed consumer passed');
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

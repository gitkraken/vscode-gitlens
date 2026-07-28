// Pack Core, install that tarball outside the workspace, and run the same typed/runtime fixture Kepler relies on.
// This catches export-map, manifest-rewrite, and declaration issues that workspace links bypass.

import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
	execFileSync(pnpm, ['test'], {
		cwd: consumerDir,
		stdio: 'inherit',
	});

	console.log('[core-gitlens verify-package] packed consumer passed');
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

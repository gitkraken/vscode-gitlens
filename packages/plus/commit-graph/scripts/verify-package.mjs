import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(packageRoot, '..', '..', '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tempRoot = await mkdtemp(join(tmpdir(), 'commit-graph-consumer-'));

try {
	const packDir = join(tempRoot, 'pack');
	const consumerDir = join(tempRoot, 'consumer');
	await Promise.all([mkdir(packDir, { recursive: true }), mkdir(join(consumerDir, 'src'), { recursive: true })]);
	execFileSync(pnpm, ['pack', '--pack-destination', packDir], { cwd: packageRoot, stdio: 'inherit' });
	const tarballs = [];
	for (const file of await readdir(packDir)) {
		if (file.endsWith('.tgz')) {
			tarballs.push(file);
		}
	}
	if (tarballs.length !== 1) throw new Error(`Expected one commit-graph tarball, found ${tarballs.length}`);

	await writeFile(
		join(consumerDir, 'package.json'),
		`${JSON.stringify(
			{
				name: 'commit-graph-packed-consumer',
				private: true,
				version: '0.0.0',
				type: 'module',
				dependencies: { '@gitkraken/commit-graph': pathToFileURL(join(packDir, tarballs[0])).href },
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(
		join(consumerDir, 'tsconfig.json'),
		`${JSON.stringify(
			{
				compilerOptions: {
					lib: ['DOM', 'ES2022'],
					module: 'ESNext',
					moduleResolution: 'Bundler',
					noEmit: true,
					strict: true,
					target: 'ES2022',
				},
				include: ['src/**/*'],
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(
		join(consumerDir, 'src', 'contract.ts'),
		`import { CommitGraphEngineSession } from '@gitkraken/commit-graph/engine/session.js';\n` +
			`import type { GraphCommit } from '@gitkraken/commit-graph/engine/types.js';\n` +
			`const rows: GraphCommit[] = [{ sha: 'a', shortSha: 'a', message: 'A', author: 'A', authorEmail: '', date: 1, parents: [], kind: 'commit' }];\n` +
			`const session = new CommitGraphEngineSession<GraphCommit, GraphCommit>();\n` +
			`export const state = session.update({ identity: 'external', sourceRows: rows, toCommit: row => row });\n`,
	);
	await writeFile(
		join(consumerDir, 'src', 'run.mjs'),
		`import { readFile } from 'node:fs/promises';\n` +
			`import { fileURLToPath } from 'node:url';\n` +
			`import { CommitGraphEngineSession } from '@gitkraken/commit-graph/engine/session.js';\n` +
			`const row = { sha: 'a', shortSha: 'a', message: 'A', author: 'A', authorEmail: '', date: 1, parents: [], kind: 'commit' };\n` +
			`const state = new CommitGraphEngineSession().update({ identity: 'external', sourceRows: [row], toCommit: value => value });\n` +
			`if (state.transition.kind !== 'initial' || state.rows.length !== 1) throw new Error('engine contract failed');\n` +
			`const theme = await readFile(fileURLToPath(import.meta.resolve('@gitkraken/commit-graph/theme.css')), 'utf8');\n` +
			`if (!theme.includes('--brand:')) throw new Error('theme export failed');\n`,
	);

	// npm installs a local tarball without registering the temporary project in pnpm's global store.
	// Compiler binaries still come from this checkout; module resolution only sees the packed package.
	execFileSync(npm, ['install', '--offline', '--ignore-scripts', '--cache', join(tempRoot, 'npm-cache')], {
		cwd: consumerDir,
		stdio: 'inherit',
	});
	execFileSync(
		process.execPath,
		[join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'],
		{
			cwd: consumerDir,
			stdio: 'inherit',
		},
	);
	execFileSync(
		join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'),
		['src/contract.ts', '--bundle', '--platform=browser', '--format=esm', '--outfile=browser.js'],
		{ cwd: consumerDir, stdio: 'inherit' },
	);
	execFileSync(process.execPath, ['src/run.mjs'], { cwd: consumerDir, stdio: 'inherit' });
	console.log('[commit-graph verify-package] packed TypeScript, browser bundle, runtime, and theme consumer passed');
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

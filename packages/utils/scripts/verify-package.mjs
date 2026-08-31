import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTarGz } from '../../../scripts/package/extractTarGz.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(packageRoot, '..', '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const tempRoot = await mkdtemp(join(tmpdir(), 'gitlens-utils-consumer-'));

try {
	const packDir = join(tempRoot, 'pack');
	const consumerDir = join(tempRoot, 'consumer');
	const scopeDir = join(consumerDir, 'node_modules', '@gitlens');
	await Promise.all([mkdir(packDir, { recursive: true }), mkdir(join(consumerDir, 'src'), { recursive: true })]);
	execFileSync(pnpm, ['pack', '--pack-destination', packDir], { cwd: packageRoot, stdio: 'inherit' });
	/** @type {string[]} */
	const packedFiles = await readdir(packDir);
	const tarballs = packedFiles.filter(file => file.endsWith('.tgz'));
	if (tarballs.length !== 1) throw new Error(`Expected one @gitlens/utils tarball, found ${tarballs.length}`);

	await mkdir(scopeDir, { recursive: true });
	await extractTarGz(join(packDir, tarballs[0]), scopeDir);
	await rename(join(scopeDir, 'package'), join(scopeDir, 'utils'));
	await mkdir(join(consumerDir, 'node_modules'), { recursive: true });
	await Promise.all([
		symlink(
			join(repoRoot, 'node_modules', 'fast-string-truncated-width'),
			join(consumerDir, 'node_modules', 'fast-string-truncated-width'),
			'junction',
		),
		symlink(
			join(repoRoot, 'node_modules', 'vscode-uri'),
			join(consumerDir, 'node_modules', 'vscode-uri'),
			'junction',
		),
	]);
	await writeFile(
		join(consumerDir, 'tsconfig.json'),
		`${JSON.stringify(
			{
				compilerOptions: {
					lib: ['DOM', 'ES2023'],
					module: 'ESNext',
					moduleResolution: 'Bundler',
					noEmit: true,
					skipLibCheck: true,
					strict: true,
					target: 'ES2023',
				},
				include: ['src/**/*'],
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(
		join(consumerDir, 'src', 'contract.ts'),
		`import { formatDate } from '@gitlens/utils/date.js';\n` +
			`import { debounce } from '@gitlens/utils/debounce.js';\n` +
			`import { isTextEntryTarget } from '@gitlens/utils/dom.js';\n` +
			`import { parseChord } from '@gitlens/utils/keys/chord.js';\n` +
			`import { KeymapDispatcher } from '@gitlens/utils/keys/keymapDispatcher.js';\n` +
			`import { LruMap } from '@gitlens/utils/lruMap.js';\n` +
			`export const values = [formatDate(Date.now(), 'short'), debounce(() => 1, 1), isTextEntryTarget, parseChord('x', false), new KeymapDispatcher({ isMac: false }), new LruMap(2)];\n`,
	);
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
		[
			'src/contract.ts',
			'--bundle',
			'--platform=browser',
			'--format=esm',
			'--tree-shaking=true',
			'--outfile=browser.js',
		],
		{ cwd: consumerDir, stdio: 'inherit' },
	);

	console.log('[@gitlens/utils verify-package] packed TypeScript and browser bundle consumer passed');
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

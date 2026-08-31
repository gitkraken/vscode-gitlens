import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTarGz } from '../../../scripts/package/extractTarGz.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(packageRoot, '..', '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const tempRoot = await mkdtemp(join(tmpdir(), 'components-consumer-'));

try {
	const packDir = join(tempRoot, 'pack');
	const consumerDir = join(tempRoot, 'consumer');
	const scopeDir = join(consumerDir, 'node_modules', '@gitlens');
	await Promise.all([mkdir(packDir, { recursive: true }), mkdir(join(consumerDir, 'src'), { recursive: true })]);
	execFileSync(pnpm, ['pack', '--pack-destination', packDir], {
		cwd: join(repoRoot, 'packages', 'utils'),
		stdio: 'inherit',
	});
	/** @type {string[]} */
	const packedUtilsFiles = await readdir(packDir);
	const utilsTarball = packedUtilsFiles.find(file => file.includes('gitlens-utils') && file.endsWith('.tgz'));
	if (utilsTarball == null) throw new Error('Expected an @gitlens/utils tarball');

	await mkdir(scopeDir, { recursive: true });
	await extractTarGz(join(packDir, utilsTarball), scopeDir);
	await rename(join(scopeDir, 'package'), join(scopeDir, 'utils'));

	execFileSync(pnpm, ['pack', '--pack-destination', packDir], { cwd: packageRoot, stdio: 'inherit' });
	const tarballs = [];
	for (const file of await readdir(packDir)) {
		if (file.endsWith('.tgz') && file !== utilsTarball) {
			tarballs.push(file);
		}
	}
	if (tarballs.length !== 1) throw new Error(`Expected one components tarball, found ${tarballs.length}`);

	await extractTarGz(join(packDir, tarballs[0]), scopeDir);
	await rename(join(scopeDir, 'package'), join(scopeDir, 'components'));
	const litRoot = dirname(await realpath(join(repoRoot, 'node_modules', 'lit')));
	await Promise.all([
		symlink(
			join(repoRoot, 'node_modules', 'fast-string-truncated-width'),
			join(consumerDir, 'node_modules', 'fast-string-truncated-width'),
			'junction',
		),
		symlink(join(repoRoot, 'node_modules', 'lit'), join(consumerDir, 'node_modules', 'lit'), 'junction'),
		symlink(join(litRoot, 'lit-html'), join(consumerDir, 'node_modules', 'lit-html'), 'junction'),
		symlink(join(litRoot, 'lit-element'), join(consumerDir, 'node_modules', 'lit-element'), 'junction'),
		symlink(join(litRoot, '@lit'), join(consumerDir, 'node_modules', '@lit'), 'junction'),
		symlink(
			join(repoRoot, 'node_modules', 'vscode-uri'),
			join(consumerDir, 'node_modules', 'vscode-uri'),
			'junction',
		),
		(async () => {
			await mkdir(join(consumerDir, 'node_modules', '@awesome.me'), { recursive: true });
			await symlink(
				join(repoRoot, 'node_modules', '@awesome.me', 'webawesome'),
				join(consumerDir, 'node_modules', '@awesome.me', 'webawesome'),
				'junction',
			);
		})(),
	]);
	await writeFile(
		join(consumerDir, 'tsconfig.json'),
		`${JSON.stringify(
			{
				compilerOptions: {
					lib: ['DOM', 'ES2022'],
					module: 'ESNext',
					moduleResolution: 'Bundler',
					noEmit: true,
					skipLibCheck: true,
					strict: true,
					target: 'ES2022',
					useDefineForClassFields: false,
				},
				include: ['src/**/*'],
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(
		join(consumerDir, 'src', 'contract.ts'),
		`import { cspStyleMap } from '@gitlens/components/cspStyleMap.directive.js';\n` +
			`import { ModifierKeysController } from '@gitlens/components/controllers/modifierKeys.js';\n` +
			`import '@gitlens/components/components/codeIcon.js';\n` +
			`import '@gitlens/components/components/commitStats.js';\n` +
			`import '@gitlens/components/components/wipStats.js';\n` +
			`import '@gitlens/components/components/overlays/popover.js';\n` +
			`import '@gitlens/components/components/overlays/tooltip.js';\n` +
			`import '@gitlens/components/components/pills/tracking.js';\n` +
			`export const style = cspStyleMap({ color: 'red' });\n` +
			`export type ModifierController = ModifierKeysController;\n`,
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
	const browserBundle = await readFile(join(consumerDir, 'browser.js'), 'utf8');
	if (browserBundle.includes('--vscode-') || browserBundle.includes('.vscode-')) {
		throw new Error('Packed components contain host-specific VS Code theme hooks');
	}

	console.log('[components verify-package] packed TypeScript and browser bundle consumer passed');
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

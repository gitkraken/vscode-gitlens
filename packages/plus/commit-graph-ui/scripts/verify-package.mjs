import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTarGz } from '../../../../scripts/package/extractTarGz.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(packageRoot, '..', '..', '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const tempRoot = await mkdtemp(join(tmpdir(), 'commit-graph-ui-consumer-'));

try {
	const packDir = join(tempRoot, 'pack');
	const consumerDir = join(tempRoot, 'consumer');
	await Promise.all([mkdir(packDir, { recursive: true }), mkdir(join(consumerDir, 'src'), { recursive: true })]);

	const packageRoots = [
		{ root: join(packageRoot, '..', 'commit-graph'), scope: '@gitkraken', name: 'commit-graph' },
		{ root: join(repoRoot, 'packages', 'components'), scope: '@gitlens', name: 'components' },
		{ root: join(repoRoot, 'packages', 'utils'), scope: '@gitlens', name: 'utils' },
		{ root: packageRoot, scope: '@gitkraken', name: 'commit-graph-ui' },
	];
	for (const packed of packageRoots) {
		/** @type {Set<string>} */
		const before = new Set(await readdir(packDir));
		execFileSync(pnpm, ['pack', '--pack-destination', packDir], { cwd: packed.root, stdio: 'inherit' });
		/** @type {string[]} */
		const packedFiles = await readdir(packDir);
		const tarball = packedFiles.find(file => file.endsWith('.tgz') && !before.has(file));
		if (tarball == null) throw new Error(`No tarball produced for ${packed.name}`);

		const scopeDir = join(consumerDir, 'node_modules', packed.scope);
		await mkdir(scopeDir, { recursive: true });
		await extractTarGz(join(packDir, tarball), scopeDir);
		await rename(join(scopeDir, 'package'), join(scopeDir, packed.name));
	}
	const surfaceCss = await readFile(
		join(consumerDir, 'node_modules', '@gitkraken', 'commit-graph-ui', 'surface.css'),
		'utf8',
	);
	const vscodeThemeCss = await readFile(
		join(consumerDir, 'node_modules', '@gitkraken', 'commit-graph-ui', 'vscode-theme.css'),
		'utf8',
	);
	const stickyTimelineCss = await readFile(
		join(consumerDir, 'node_modules', '@gitkraken', 'commit-graph-ui', 'sticky-timeline.css'),
		'utf8',
	);
	const scrollMarkerCss = await readFile(
		join(consumerDir, 'node_modules', '@gitkraken', 'commit-graph-ui', 'scroll-markers.css'),
		'utf8',
	);
	if (!surfaceCss.includes('gl-lit-graph') || !surfaceCss.includes('--gl-graph-background')) {
		throw new Error('Packed commit graph stylesheet is missing its surface rules or generic theme tokens');
	}
	if (
		surfaceCss.includes('--vscode-') ||
		surfaceCss.includes('.vscode-') ||
		!vscodeThemeCss.includes('--vscode-editor-background')
	) {
		throw new Error('VS Code theme variables were not isolated from the host-neutral surface stylesheet');
	}
	if (surfaceCss.includes('gl-graph__sticky-timeline') || !stickyTimelineCss.includes('gl-graph__sticky-timeline')) {
		throw new Error('Packed sticky-timeline styles were not isolated from the base surface stylesheet');
	}
	if (surfaceCss.includes('gl-graph__scroll-markers') || !scrollMarkerCss.includes('gl-graph__scroll-markers')) {
		throw new Error('Packed scroll-marker styles were not isolated from the base surface stylesheet');
	}

	const litRoot = dirname(await realpath(join(repoRoot, 'node_modules', 'lit')));
	await Promise.all([
		symlink(join(repoRoot, 'node_modules', 'lit'), join(consumerDir, 'node_modules', 'lit'), 'junction'),
		symlink(join(litRoot, 'lit-html'), join(consumerDir, 'node_modules', 'lit-html'), 'junction'),
		symlink(join(litRoot, 'lit-element'), join(consumerDir, 'node_modules', 'lit-element'), 'junction'),
		symlink(join(litRoot, '@lit'), join(consumerDir, 'node_modules', '@lit'), 'junction'),
		symlink(join(repoRoot, 'node_modules', 'tslib'), join(consumerDir, 'node_modules', 'tslib'), 'junction'),
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
		(async () => {
			await mkdir(join(consumerDir, 'node_modules', '@lit-labs'), { recursive: true });
			await symlink(
				join(repoRoot, 'node_modules', '@lit-labs', 'virtualizer'),
				join(consumerDir, 'node_modules', '@lit-labs', 'virtualizer'),
				'junction',
			);
		})(),
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
					experimentalDecorators: true,
					lib: ['DOM', 'DOM.Iterable', 'ES2023'],
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
		join(consumerDir, 'src', 'minimal.ts'),
		`import type { GlLitGraph } from '@gitkraken/commit-graph-ui/surface.js';\n` +
			`import { registerCommitGraphElements } from '@gitkraken/commit-graph-ui/register.js';\n` +
			`import { minimalCommitGraphRuntime } from '@gitkraken/commit-graph-ui/runtime.js';\n` +
			`export function mount(element: GlLitGraph): void { element.runtime = minimalCommitGraphRuntime; registerCommitGraphElements(); }\n`,
	);
	await writeFile(
		join(consumerDir, 'src', 'full.ts'),
		`import { registerCommitGraphElements } from '@gitkraken/commit-graph-ui/register.js';\n` +
			`import { laneCollapseExtension } from '@gitkraken/commit-graph-ui/extensions/laneCollapse.js';\n` +
			`import { refsExtension } from '@gitkraken/commit-graph-ui/extensions/refs.js';\n` +
			`import { scrollMarkersExtension } from '@gitkraken/commit-graph-ui/extensions/scrollMarkers.js';\n` +
			`import { stickyTimelineExtension } from '@gitkraken/commit-graph-ui/extensions/stickyTimeline.js';\n` +
			`import { wipStatsExtension } from '@gitkraken/commit-graph-ui/extensions/wipStats.js';\n` +
			`import { defineCommitGraphProfile, prepareCommitGraphRuntime } from '@gitkraken/commit-graph-ui/runtime.js';\n` +
			`registerCommitGraphElements();\n` +
			`export const runtime = prepareCommitGraphRuntime(defineCommitGraphProfile({ extensions: [refsExtension, wipStatsExtension, laneCollapseExtension, stickyTimelineExtension, scrollMarkersExtension] }));\n`,
	);

	execFileSync(
		process.execPath,
		[join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'],
		{
			cwd: consumerDir,
			stdio: 'inherit',
		},
	);
	for (const entry of ['minimal', 'full']) {
		execFileSync(
			join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'),
			[
				`src/${entry}.ts`,
				'--bundle',
				'--platform=browser',
				'--format=esm',
				'--tree-shaking=true',
				`--outfile=${entry}.js`,
				`--metafile=${entry}-meta.json`,
			],
			{ cwd: consumerDir, stdio: 'inherit' },
		);
	}
	const fullBundle = await readFile(join(consumerDir, 'full.js'), 'utf8');
	if (fullBundle.includes('data-vscode-context')) {
		throw new Error('Packed commit graph UI contains a hardcoded VS Code context attribute');
	}

	/** @type {{ inputs: Record<string, unknown> }} */
	const minimalMeta = JSON.parse(await readFile(join(consumerDir, 'minimal-meta.json'), 'utf8'));
	const minimalInputs = Object.keys(minimalMeta.inputs);
	const forbidden = minimalInputs.filter(
		input =>
			input.includes('/commit-graph-ui/dist/extensions/') ||
			input.includes('/dist/adornments/') ||
			input.includes('/dist/graphStickyTimeline.js') ||
			input.includes('/dist/graphScrollMarkers.js'),
	);
	if (forbidden.length > 0) {
		throw new Error(`Minimal profile unexpectedly bundled optional extensions:\n${forbidden.join('\n')}`);
	}

	/** @type {{ inputs: Record<string, unknown> }} */
	const fullMeta = JSON.parse(await readFile(join(consumerDir, 'full-meta.json'), 'utf8'));
	const fullInputs = Object.keys(fullMeta.inputs);
	if (!fullInputs.some(input => input.includes('/dist/extensions/refs.js'))) {
		throw new Error('Full profile did not bundle the selected refs extension');
	}
	if (
		!fullInputs.some(input => input.includes('/dist/extensions/stickyTimeline.js')) ||
		!fullInputs.some(input => input.includes('/dist/graphStickyTimeline.js'))
	) {
		throw new Error('Full profile did not bundle the selected sticky-timeline extension and controller');
	}
	if (
		!fullInputs.some(input => input.includes('/dist/extensions/scrollMarkers.js')) ||
		!fullInputs.some(input => input.includes('/dist/graphScrollMarkers.js'))
	) {
		throw new Error('Full profile did not bundle the selected scroll-marker extension and controller');
	}

	console.log(
		'[commit-graph-ui verify-package] packed types, stylesheet, browser bundles, and opt-out metafile passed',
	);
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

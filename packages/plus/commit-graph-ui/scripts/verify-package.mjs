import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	assertNoWorkspaceSpecifiers,
	bundleForBrowser,
	linkLitFamily,
	verifyPackedPackage,
} from '../../../../scripts/package/verifyPackage.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(packageRoot, '..', '..', '..');

// Guards against a generator, or a merge, putting a wildcard back into the published surface: the packed
// tarball's `exports` must be byte-for-byte the approved map checked into this package's own manifest.
async function assertPackedExportsMatchSource(packedRoot) {
	const [sourcePkg, packedPkg] = await Promise.all([
		readFile(join(packageRoot, 'package.json'), 'utf8').then(JSON.parse),
		readFile(join(packedRoot, 'package.json'), 'utf8').then(JSON.parse),
	]);

	assert.deepStrictEqual(
		packedPkg.exports,
		sourcePkg.exports,
		'Packed @gitkraken/commit-graph-ui "exports" drifted from the approved public surface',
	);
}

// The public surface is a one-way door: an internal subpath (published but deliberately unexported) must
// fail to resolve for a real consumer the same way an unpublished one would, not just fail GitLens's
// workspace-only lint allowlist.
async function assertInternalSubpathUnresolvable(consumerDir) {
	const probe = join(consumerDir, 'assert-internal-unresolved.mjs');
	await writeFile(
		probe,
		"try {\n\timport.meta.resolve('@gitkraken/commit-graph-ui/rows/render.js');\n" +
			"\tthrow new Error('Internal subpath rows/render.js resolved from the packed consumer; it must not be exported');\n" +
			"} catch (err) {\n\tif (err?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw err;\n}\n" +
			"try {\n\timport.meta.resolve('@gitkraken/commit-graph-ui/extensions/refs/pills.js');\n" +
			"\tthrow new Error('Internal subpath extensions/refs/pills.js resolved from the packed consumer; it must not be exported');\n" +
			"} catch (err) {\n\tif (err?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw err;\n}\n",
	);
	execFileSync(process.execPath, [probe], { cwd: consumerDir, stdio: 'inherit' });
}

await verifyPackedPackage({
	tempPrefix: 'commit-graph-ui-consumer-',
	repoRoot,
	// Only the two published `@gitkraken/*` packages: `@gitlens/components` and `@gitlens/utils` are
	// compiled into this one's dist, so a real consumer never sees them.
	packages: [
		{ root: join(packageRoot, '..', 'commit-graph'), scope: '@gitkraken', name: 'commit-graph' },
		{
			root: packageRoot,
			scope: '@gitkraken',
			name: 'commit-graph-ui',
			// One entrypoint per shape in the exports map — attw skips wildcard entries unless they are
			// named, and the CSS ones have no types to resolve. `debug.js` and `rows/*.js`/`gutter/*.js`/
			// `scope/*.js`/`extensions/*/*.js` are internal (`workspaceExports`, not `exports`) and must
			// not appear here.
			publishGates: {
				attwEntrypoints: [
					'./graph.js',
					'./register.js',
					'./profile.js',
					'./contracts/rows.js',
					'./extensions/refs.js',
				],
			},
		},
	],
	// Exactly the runtime dependencies the manifest declares, resolved from this package's own
	// `node_modules` — pnpm keeps them there, and reading them from anywhere else would let an
	// undeclared dependency pass.
	symlinks: [
		{ from: packageRoot, name: 'fast-string-truncated-width' },
		{ from: packageRoot, name: 'vscode-uri' },
		{ from: packageRoot, name: '@lit-labs/virtualizer' },
		{ from: packageRoot, name: '@awesome.me/webawesome' },
	],
	beforeTsc: async ({ repoRoot, consumerDir }) => {
		await linkLitFamily(repoRoot, consumerDir);

		const packedRoot = join(consumerDir, 'node_modules', '@gitkraken', 'commit-graph-ui');
		await assertNoWorkspaceSpecifiers(packedRoot, 'Packed @gitkraken/commit-graph-ui');
		await assertPackedExportsMatchSource(packedRoot);
		await assertInternalSubpathUnresolvable(consumerDir);

		const [surfaceCss, vscodeThemeCss, stickyTimelineCss, scrollMarkerCss] = await Promise.all([
			readFile(join(packedRoot, 'dist', 'graph.css'), 'utf8'),
			readFile(join(packedRoot, 'dist', 'themes', 'vscode.css'), 'utf8'),
			readFile(join(packedRoot, 'dist', 'extensions', 'stickyTimeline.css'), 'utf8'),
			readFile(join(packedRoot, 'dist', 'extensions', 'scrollMarkers.css'), 'utf8'),
		]);

		if (!surfaceCss.includes('gl-commit-graph') || !surfaceCss.includes('--gl-graph-background')) {
			throw new Error('Packed commit graph stylesheet is missing its surface rules or generic theme tokens');
		}
		if (
			surfaceCss.includes('--vscode-') ||
			surfaceCss.includes('.vscode-') ||
			!vscodeThemeCss.includes('--vscode-editor-background')
		) {
			throw new Error('VS Code theme variables were not isolated from the host-neutral surface stylesheet');
		}
		if (
			surfaceCss.includes('gl-graph__sticky-timeline') ||
			!stickyTimelineCss.includes('gl-graph__sticky-timeline')
		) {
			throw new Error('Packed sticky-timeline styles were not isolated from the base surface stylesheet');
		}
		if (surfaceCss.includes('gl-graph__scroll-markers') || !scrollMarkerCss.includes('gl-graph__scroll-markers')) {
			throw new Error('Packed scroll-marker styles were not isolated from the base surface stylesheet');
		}
	},
	compilerOptions: {
		experimentalDecorators: true,
		lib: ['DOM', 'DOM.Iterable', 'ES2023'],
		useDefineForClassFields: false,
	},
	sources: {
		'src/minimal.ts':
			`import type { GlCommitGraph } from '@gitkraken/commit-graph-ui/graph.js';\n` +
			`import { registerCommitGraphElements } from '@gitkraken/commit-graph-ui/register.js';\n` +
			`import { minimalCommitGraphProfile } from '@gitkraken/commit-graph-ui/profile.js';\n` +
			`export function mount(element: GlCommitGraph): void { element.profile = minimalCommitGraphProfile; registerCommitGraphElements(); }\n`,
		'src/full.ts':
			`import { registerCommitGraphElements } from '@gitkraken/commit-graph-ui/register.js';\n` +
			`import { laneCollapseExtension } from '@gitkraken/commit-graph-ui/extensions/laneCollapse.js';\n` +
			`import { refsExtension } from '@gitkraken/commit-graph-ui/extensions/refs.js';\n` +
			`import { scrollMarkersExtension } from '@gitkraken/commit-graph-ui/extensions/scrollMarkers.js';\n` +
			`import { stickyTimelineExtension } from '@gitkraken/commit-graph-ui/extensions/stickyTimeline.js';\n` +
			`import { wipStatsExtension } from '@gitkraken/commit-graph-ui/extensions/wipStats.js';\n` +
			`import { defaultCommitGraphRowAdapter } from '@gitkraken/commit-graph-ui/contracts/rows.js';\n` +
			`import type { CommitGraphProfile } from '@gitkraken/commit-graph-ui/profile.js';\n` +
			`registerCommitGraphElements();\n` +
			`export const runtime: CommitGraphProfile = Object.freeze({ rowAdapter: defaultCommitGraphRowAdapter, refs: refsExtension, wipStats: wipStatsExtension, laneCollapse: laneCollapseExtension, stickyTimeline: stickyTimelineExtension, scrollMarkers: scrollMarkersExtension });\n`,
	},
	verify: async ({ repoRoot, consumerDir }) => {
		for (const entry of ['minimal', 'full']) {
			bundleForBrowser(repoRoot, consumerDir, `src/${entry}.ts`, `${entry}.js`, {
				metafile: `${entry}-meta.json`,
			});
		}

		const minimalMeta = JSON.parse(await readFile(join(consumerDir, 'minimal-meta.json'), 'utf8'));
		const minimalInputs = Object.keys(minimalMeta.inputs);

		// `meta.inputs` lists every file esbuild's resolver ever visited, including one it then dropped as
		// an "ignored-bare-import" because the target wasn't in the package's `sideEffects` array — so it
		// stays present here even when the custom element it registers never makes it into the bundle. Only
		// `meta.outputs['<file>'].inputs` reflects what a browser actually receives; that is what these
		// registration checks below must read.
		function assertElementModuleBundled(meta, outputFile, moduleSuffix, elementLabel) {
			const bundledInputs = Object.keys(meta.outputs[outputFile].inputs);
			if (!bundledInputs.some(input => input.endsWith(moduleSuffix))) {
				throw new Error(
					`${outputFile} dropped ${elementLabel}'s registration module (${moduleSuffix}) from the bundle — ` +
						`it is missing from "sideEffects" in package.json, so a tree-shaking consumer silently loses it`,
				);
			}
		}

		assertElementModuleBundled(minimalMeta, 'minimal.js', 'components/components/codeIcon.js', 'code-icon');
		assertElementModuleBundled(
			minimalMeta,
			'minimal.js',
			'components/components/overlays/popover.js',
			'gl-popover',
		);
		assertElementModuleBundled(
			minimalMeta,
			'minimal.js',
			'components/components/overlays/tooltip.js',
			'gl-tooltip',
		);

		const forbidden = minimalInputs.filter(
			input =>
				input.includes('/commit-graph-ui/dist/extensions/refs/adornmentProvider.js') ||
				input.includes('/commit-graph-ui/dist/extensions/wipStats/adornmentProvider.js') ||
				input.includes('/commit-graph-ui/dist/extensions/laneCollapse/adornmentProvider.js') ||
				input.includes('/commit-graph-ui/dist/extensions/stickyTimeline/controller.js') ||
				input.includes('/commit-graph-ui/dist/extensions/scrollMarkers/controller.js'),
		);
		if (forbidden.length > 0) {
			throw new Error(`Minimal profile unexpectedly bundled optional extensions:\n${forbidden.join('\n')}`);
		}

		const fullMeta = JSON.parse(await readFile(join(consumerDir, 'full-meta.json'), 'utf8'));
		const fullInputs = Object.keys(fullMeta.inputs);
		if (!fullInputs.some(input => input.includes('/dist/extensions/refs.js'))) {
			throw new Error('Full profile did not bundle the selected refs extension');
		}
		if (
			!fullInputs.some(input => input.includes('/dist/extensions/stickyTimeline.js')) ||
			!fullInputs.some(input => input.includes('/dist/extensions/stickyTimeline/controller.js'))
		) {
			throw new Error('Full profile did not bundle the selected sticky-timeline extension and controller');
		}
		if (
			!fullInputs.some(input => input.includes('/dist/extensions/scrollMarkers.js')) ||
			!fullInputs.some(input => input.includes('/dist/extensions/scrollMarkers/controller.js'))
		) {
			throw new Error('Full profile did not bundle the selected scroll-marker extension and controller');
		}

		// The full profile additionally reaches wip-stats and tracking-pill markup, so their custom
		// elements' registration modules must survive tree-shaking here too.
		assertElementModuleBundled(fullMeta, 'full.js', 'components/components/codeIcon.js', 'code-icon');
		assertElementModuleBundled(fullMeta, 'full.js', 'components/components/overlays/popover.js', 'gl-popover');
		assertElementModuleBundled(fullMeta, 'full.js', 'components/components/overlays/tooltip.js', 'gl-tooltip');
		assertElementModuleBundled(fullMeta, 'full.js', 'components/components/wipStats.js', 'gl-wip-stats');
		assertElementModuleBundled(fullMeta, 'full.js', 'components/components/commitStats.js', 'gl-commit-stats');
		assertElementModuleBundled(fullMeta, 'full.js', 'components/components/pills/tracking.js', 'gl-tracking-pill');
	},
	successMessage:
		'[commit-graph-ui verify-package] packed types, stylesheet, browser bundles, and opt-out metafile passed',
});

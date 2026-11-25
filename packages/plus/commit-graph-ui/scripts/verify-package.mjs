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
			// named, and the CSS ones have no types to resolve. `rows/*.js`/`gutter/*.js`/`scope/*.js`/
			// `extensions/*/*.js` are internal (`workspaceExports`, not `exports`) and must not appear here.
			publishGates: {
				attwEntrypoints: [
					'./graph.js',
					'./register.js',
					'./overviewBar.js',
					'./debug.js',
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

		const pillStyles = await readFile(
			join(packedRoot, 'dist', 'components', 'components', 'pills', 'pill.css.js'),
			'utf8',
		);
		const overviewBarStyles = await readFile(join(packedRoot, 'dist', 'overviewBar.css.js'), 'utf8');
		if (
			[surfaceCss, vscodeThemeCss, stickyTimelineCss, scrollMarkerCss].some(css => /\drem\b/i.test(css)) ||
			!surfaceCss.includes('var(--gl-graph-rem,10px)') ||
			!pillStyles.includes('var(--gl-graph-rem,10px)') ||
			!overviewBarStyles.includes('var(--gl-graph-rem,10px)')
		) {
			throw new Error('Packed styles still size with rem instead of --gl-graph-rem');
		}
		if (surfaceCss.includes(':root')) {
			throw new Error('Packed commit graph stylesheet defines tokens on the host page root');
		}

		const retiredTokens = 'brand|border|secondary|background|foreground|muted-foreground|muted|status-warning';
		const retiredRead = new RegExp(`var\\(\\s*--(?:${retiredTokens})\\s*[,)]`);
		const retiredDeclaration = new RegExp(`[{;]\\s*--(?:${retiredTokens})\\s*:`);
		const packedStyles = [surfaceCss, vscodeThemeCss, stickyTimelineCss, scrollMarkerCss];
		if (packedStyles.some(css => retiredRead.test(css) || retiredDeclaration.test(css))) {
			throw new Error('Packed styles still declare or read the retired HSL-triplet colour tokens');
		}
		if (packedStyles.some(css => css.includes('prefers-color-scheme'))) {
			throw new Error('Packed styles pick colours by the OS scheme instead of the inherited color-scheme');
		}
		if (
			!/--gl-graph-foreground:\s*light-dark\(/.test(surfaceCss) ||
			!surfaceCss.includes('--gl-graph-accent:') ||
			!vscodeThemeCss.includes('--gl-graph-accent:')
		) {
			throw new Error('Packed styles are missing the base colour tokens');
		}

		const messages = JSON.parse(await readFile(join(packedRoot, 'dist', 'l10n', 'messages.json'), 'utf8'));
		if (Object.keys(messages).length === 0) {
			throw new Error('Packed message catalog is empty');
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
			`export function mount(element: GlCommitGraph): void { element.profile = minimalCommitGraphProfile; registerCommitGraphElements(); }\n` +
			`import type { CommitGraphEventMap, GraphChangeSelectionDetail } from '@gitkraken/commit-graph-ui/contracts/events.js';\n` +
			`export function onSelect(element: GlCommitGraph, select: (detail: GraphChangeSelectionDetail) => void): void { element.addEventListener('gl-graph-changeselection', e => select(e.detail)); }\n` +
			`export type JumpRequest = CommitGraphEventMap['gl-graph-jumptocommit'];\n`,
		'src/full.ts':
			`import { registerCommitGraphElements } from '@gitkraken/commit-graph-ui/register.js';\n` +
			`import { formatGraphMessage, setGraphLanePalette, setGraphLocalizer } from '@gitkraken/commit-graph-ui/localization.js';\n` +
			`import type { WipRowInfo } from '@gitkraken/commit-graph-ui/contracts/rows.js';\n` +
			`import type { GraphKeymap } from '@gitkraken/commit-graph-ui/contracts/keyboard.js';\n` +
			`import type { GlCommitGraph } from '@gitkraken/commit-graph-ui/graph.js';\n` +
			`export function useKeymap(element: GlCommitGraph, keymap: GraphKeymap): void { element.keymap = keymap; }\n` +
			`export function useHostOptions(element: GlCommitGraph): void { element.headerMenu = { label: 'Columns', open: false }; element.vscode = { settingsContext: undefined }; setGraphLanePalette(['#336699', 'rebeccapurple']); }\n` +
			`import type { GraphCopyRequestDetail } from '@gitkraken/commit-graph-ui/contracts/contributions.js';\n` +
			`export const copiedContext = (detail: GraphCopyRequestDetail): string | undefined => detail.vscodeContext ?? detail.vscodeSelectionContexts?.[0];\n` +
			`import { laneCollapseExtension } from '@gitkraken/commit-graph-ui/extensions/laneCollapse.js';\n` +
			`import { refPillKey, refsExtension } from '@gitkraken/commit-graph-ui/extensions/refs.js';\n` +
			`import { scrollMarkersExtension } from '@gitkraken/commit-graph-ui/extensions/scrollMarkers.js';\n` +
			`import { stickyTimelineExtension } from '@gitkraken/commit-graph-ui/extensions/stickyTimeline.js';\n` +
			`import { wipStatsExtension } from '@gitkraken/commit-graph-ui/extensions/wipStats.js';\n` +
			`import { defaultCommitGraphRowAdapter } from '@gitkraken/commit-graph-ui/contracts/rows.js';\n` +
			`import type { CommitGraphProfile } from '@gitkraken/commit-graph-ui/profile.js';\n` +
			`import type { OverviewBarItem } from '@gitkraken/commit-graph-ui/overviewBar.js';\n` +
			`import { registerOverviewBarElement } from '@gitkraken/commit-graph-ui/overviewBar.js';\n` +
			`setGraphLocalizer(message => formatGraphMessage(message.message, message.args), { locale: 'fr' });\n` +
			`export const wipRowInfo: WipRowInfo = { branchName: 'main', isPrimary: true };\n` +
			`export const mainPillKey: string = refPillKey({ kind: 'head', name: 'main' });\n` +
			`registerCommitGraphElements();\n` +
			`registerOverviewBarElement();\n` +
			`export const overviewBarItem: OverviewBarItem = { id: 'main', branchName: 'main', repoPath: '/repo', isPrimary: true };\n` +
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
		if (minimalInputs.some(input => input.includes('/commit-graph-ui/dist/overviewBar.js'))) {
			throw new Error('Minimal profile unexpectedly bundled the overview bar');
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
		if (!Object.keys(fullMeta.outputs['full.js'].inputs).some(input => input.endsWith('/dist/overviewBar.js'))) {
			throw new Error('Full profile did not bundle the registered overview bar');
		}
	},
	successMessage:
		'[commit-graph-ui verify-package] packed types, stylesheet, browser bundles, and opt-out metafile passed',
});

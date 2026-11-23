import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rolldown } from 'tsdown';
import { defineConfig } from 'tsdown';
import { createOutputNamer } from '../../../scripts/package/tsdownOutputNames.mjs';
import { graphRemEdits } from './scripts/cssUnits.mjs';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));
// Only used for output placement below — the manifests of @gitlens/utils and @gitlens/components
// resolve to these same sources, so tsdown inlines them without an alias.
const utilsSrc = resolve(packageRoot, '..', '..', 'utils', 'src');
const componentsSrc = resolve(packageRoot, '..', '..', 'components', 'src');

const ownSrc = resolve(packageRoot, 'src');

type TemplateElementNode = { start: number; end: number; value: { raw: string } };

function isCssTemplate(node: object): node is { quasi: { quasis: TemplateElementNode[] } } {
	return (
		'type' in node &&
		node.type === 'TaggedTemplateExpression' &&
		'tag' in node &&
		typeof node.tag === 'object' &&
		node.tag != null &&
		'type' in node.tag &&
		node.tag.type === 'Identifier' &&
		'name' in node.tag &&
		node.tag.name === 'css'
	);
}

function* cssTemplates(node: unknown): Generator<TemplateElementNode[]> {
	if (node == null || typeof node !== 'object') return;

	if (Array.isArray(node)) {
		for (const child of node) {
			yield* cssTemplates(child);
		}
		return;
	}

	if (isCssTemplate(node)) {
		yield node.quasi.quasis;
		return;
	}

	for (const child of Object.values(node)) {
		yield* cssTemplates(child);
	}
}

const graphRemUnits: Rolldown.Plugin = {
	name: 'commit-graph-rem-units',
	transform(code, id, meta) {
		if ((!id.startsWith(ownSrc) && !id.startsWith(componentsSrc)) || !/\drem\b/.test(code)) return null;

		const source = meta.magicString;
		if (source == null) return null;

		let changed = false;
		for (const quasis of cssTemplates(meta.ast)) {
			const segments: { joinedStart: number; sourceStart: number }[] = [];
			let joined = '';
			for (const [index, quasi] of quasis.entries()) {
				const sourceStart = quasi.start + 1;
				if (code.slice(sourceStart, sourceStart + quasi.value.raw.length) !== quasi.value.raw) {
					throw new Error(`Unexpected css template offsets in ${id}`);
				}

				if (index > 0) {
					joined += '/**/';
				}
				segments.push({ joinedStart: joined.length, sourceStart: sourceStart });
				joined += quasi.value.raw;
			}

			for (const edit of graphRemEdits(joined)) {
				const segment = segments.findLast(s => s.joinedStart <= edit.start);
				if (segment == null) continue;

				const offset = segment.sourceStart - segment.joinedStart;
				source.overwrite(edit.start + offset, edit.end + offset, edit.text);
				changed = true;
			}
		}
		return changed ? { code: source } : null;
	},
};

const graphL10n: Rolldown.Plugin = {
	name: 'commit-graph-l10n',
	resolveId: {
		// KEEP: runs ahead of tsdown's dependency resolution, which would otherwise keep the import external.
		order: 'pre',
		handler: (source, importer) => {
			if (source !== '@vscode/l10n' || importer == null) return null;
			if (!importer.startsWith(utilsSrc) && !importer.startsWith(componentsSrc)) return null;

			return { id: '@gitkraken/commit-graph/l10n.js', external: true };
		},
	},
};

const outputName = createOutputNamer([
	[utilsSrc, 'utils'],
	[componentsSrc, 'components'],
]);

// Bundled mode + `preserveModules` rather than `unbundle: true` — see scripts/package/tsdownOutputNames.mjs
// for the rationale (both published Commit Graph packages build this way).
// oxlint-disable-next-line import/no-default-export
export default defineConfig({
	entry: ['src/**/*.ts', '!src/**/__tests__/**'],
	format: ['esm'],
	platform: 'browser',
	// Matches the package's own tsconfig, which does not extend tsconfig.base.json (es2023).
	target: 'es2022',
	outDir: 'dist',
	unbundle: false,
	dts: { tsconfig: 'tsconfig.build.json' },
	sourcemap: true,
	clean: true,
	plugins: [graphRemUnits, graphL10n],
	// The published exports map is a hand-written public contract — tsdown must not regenerate it.
	exports: false,
	// Keep the emitted extensions as .js/.d.ts so the exports map's dist/*.js paths keep resolving.
	fixedExtension: false,
	inputOptions: {
		// The sources import each other with the `.js` extension the repo requires, but on disk they
		// are `.ts`.
		resolve: { extensionAlias: { '.js': ['.ts', '.js'] } },
	},
	deps: {
		// Everything a consumer installs stays a bare specifier; only the unpublished @gitlens/* packages
		// are absorbed.
		neverBundle: [
			/^@gitkraken\/commit-graph(\/|$)/,
			/^lit(-html|-element)?(\/|$)/,
			/^@lit(-labs)?\//,
			/^@awesome\.me\//,
			'fast-string-truncated-width',
			'vscode-uri',
		],
	},
	outputOptions: {
		preserveModules: true,
		preserveModulesRoot: 'src',
		// `preserveModules` routes every emitted module through `entryFileNames`/`chunkFileNames`,
		// virtual ones included.
		entryFileNames: outputName,
		chunkFileNames: outputName,
	},
	copy: [
		{ from: '../../../LICENSE', to: '.' },
		{ from: '../../../LICENSE.plus', to: '.' },
	],
});

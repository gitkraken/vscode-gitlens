import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getL10nJson } from '@vscode/l10n-dev';
import { formatCatalog, validateTranslations } from '../localization.mjs';

test('extracts native and browser messages with translator context', async () => {
	const catalog = await getL10nJson([
		{ extension: '.ts', contents: "import { l10n } from 'vscode'; l10n.t('Checkout {0}', branch);" },
		{
			extension: '.ts',
			contents:
				"import * as l10n from '@vscode/l10n'; l10n.t({message: 'Open {name}', args: {name}, comment: ['A repository']});",
		},
	]);
	assert.equal(catalog['Checkout {0}'], 'Checkout {0}');
	assert.deepEqual(catalog['Open {name}/A repository'], { message: 'Open {name}', comment: ['A repository'] });
});

test('allows reordered and repeated placeholders and partial translations', () => {
	assert.deepEqual(
		validateTranslations(
			{ 'Compare {0} to {1}': 'Compare {0} to {1}', Cancel: 'Cancel' },
			{ 'Compare {0} to {1}': '{1} / {0} / {1}' },
			'fr',
		),
		[],
	);
});

test('rejects missing, added, empty and obsolete translations', () => {
	assert.equal(
		validateTranslations(
			{ 'Open {name}': 'Open {name}' },
			{ 'Open {name}': 'Ouvrir {path}', Removed: 'Supprimé' },
			'fr',
		).length,
		2,
	);
	assert.equal(validateTranslations({ Open: 'Open' }, { Open: '' }, 'fr').length, 1);
});

test('catalog output is stable across insertion orders', () => {
	assert.equal(formatCatalog({ z: 'last', a: 'first' }), formatCatalog({ a: 'first', z: 'last' }));
});

test('webview initialization translates module-level labels without a fetch', async () => {
	const { build } = await import('esbuild');
	const { runInNewContext } = await import('node:vm');
	const bundle = { 'Open {0}': '{0} を開く' };
	const result = await build({
		stdin: {
			contents:
				"import './src/webviews/apps/shared/localization.ts'; import { label } from 'test-label'; globalThis.label = label;",
			resolveDir: process.cwd(),
		},
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'iife',
		plugins: [
			{
				name: 'module-label',
				setup(builder) {
					builder.onResolve({ filter: /^test-label$/ }, () => ({ path: 'test-label', namespace: 'test' }));
					builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
						contents:
							"import * as l10n from '@vscode/l10n'; export const label = l10n.t('Open {0}', '日本語');",
						resolveDir: process.cwd(),
					}));
				},
			},
		],
	});
	const encoded = Buffer.from(JSON.stringify(bundle), 'utf8').toString('base64');
	function run(contents) {
		const context = {
			document: { querySelector: () => (contents ? { content: contents } : null) },
			TextEncoder,
			TextDecoder,
			Uint8Array,
			atob,
		};
		runInNewContext(result.outputFiles[0].text, context);
		return context.label;
	}
	assert.equal(run(encoded), '日本語 を開く');
	assert.equal(run(undefined), 'Open 日本語');
});

test('lint rejects computed messages while accepting whole literal templates and import aliases', async () => {
	const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { join, resolve } = await import('node:path');
	const { spawnSync } = await import('node:child_process');
	const directory = await mkdtemp(join(tmpdir(), 'gitlens-l10n-lint-'));
	try {
		const config = join(directory, 'config.json');
		await writeFile(
			config,
			JSON.stringify({
				categories: { correctness: 'off' },
				jsPlugins: [{ name: '@gitlens', specifier: resolve('scripts/eslint-plugin-gitlens.mjs') }],
				rules: { '@gitlens/require-literal-l10n': 'error' },
			}),
		);
		const fixture = join(directory, 'fixture.ts');
		await writeFile(
			fixture,
			"import { l10n as loc } from 'vscode'; import { t as translate } from '@vscode/l10n'; loc.t('Open {0}', name); translate({ message: 'Compare {1} with {0}', args: [a, b], comment: 'Comparison action' }); loc.t('Open ' + name); translate(message);",
		);
		const result = spawnSync(
			resolve('node_modules/.bin/oxlint'),
			['--config', config, '--format', 'json', fixture],
			{ encoding: 'utf8' },
		);
		assert.equal(result.status, 1, result.stderr || result.stdout);
		const diagnostics = JSON.parse(result.stdout).diagnostics;
		assert.equal(diagnostics.length, 2, result.stdout);
		assert.ok(diagnostics.every(diagnostic => diagnostic.code.includes('require-literal-l10n')));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

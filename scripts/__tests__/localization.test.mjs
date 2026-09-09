import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { config, t } from '@vscode/l10n';
import { getL10nJson } from '@vscode/l10n-dev';
import { formatCatalog, parsePluralBlocks, validateTranslations } from '../localization.mjs';

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

test('parsePluralBlocks finds top-level blocks without descending into a nested one, and throws on malformed input', () => {
	const blocks = parsePluralBlocks('{0, plural, one{a} other{b}} and {1, plural, one{c} other{d}}');
	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].selector, '0');
	assert.deepEqual(blocks[0].branches, { one: 'a', other: 'b' });
	assert.equal(blocks[1].selector, '1');
	assert.deepEqual(blocks[1].branches, { one: 'c', other: 'd' });

	const nested = parsePluralBlocks('{0, plural, one{{1, plural, one{x} other{y}}} other{z}}');
	assert.equal(nested.length, 1);
	assert.equal(nested[0].branches.one, '{1, plural, one{x} other{y}}');

	assert.deepEqual(parsePluralBlocks('plain string, no block'), []);
	assert.throws(() => parsePluralBlocks('{0, plural, one{a}'), /unterminated plural block/);
	assert.throws(() => parsePluralBlocks('{0, plural, one{a}}'), /without an "other" branch/);
});

test('validateTranslations accepts a correct plural block in a translation', () => {
	assert.deepEqual(
		validateTranslations(
			{ '{0} files changed': '{0} files changed' },
			{
				'{0} files changed':
					'{0, plural, one{{0} файл изменён} few{{0} файла изменено} many{{0} файлов изменено} other{{0} файлов изменено}}',
			},
			'ru',
		),
		[],
	);
});

test('validateTranslations also accepts and validates a plural block in the English source', () => {
	const key = '{count, plural, one{{count} file changed} other{{count} files changed}}';
	assert.deepEqual(validateTranslations({ [key]: key }, { [key]: key }, 'en-gb'), []);
});

test('validateTranslations accepts a source block translated with more CLDR categories than English uses', () => {
	// English (the source) only ever writes "one" and "other"; a translator may add whichever further
	// categories their language distinguishes.
	const key = '{count, plural, one{{count} file changed} other{{count} files changed}}';
	const translated =
		'{count, plural, one{{count} файл изменён} few{{count} файла изменено} many{{count} файлов изменено} other{{count} файлов изменено}}';
	assert.deepEqual(validateTranslations({ [key]: key }, { [key]: translated }, 'ru'), []);
});

test('validateTranslations rejects a plural block with no "other" branch', () => {
	const errors = validateTranslations(
		{ '{0} files changed': '{0} files changed' },
		{ '{0} files changed': '{0, plural, one{{0} файл изменён}}' },
		'ru',
	);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /plural block without an "other" branch/);
});

test('validateTranslations rejects a plural block with no "other" branch in the English source', () => {
	const key = '{count, plural, one{{count} file changed}}';
	const errors = validateTranslations({ [key]: key }, { [key]: 'plain translation' }, 'fr');
	assert.equal(errors.length, 1);
	assert.match(errors[0], /plural block without an "other" branch for .*\(source\)/);
});

test('validateTranslations rejects an unknown plural branch name', () => {
	const key = '{count, plural, foo{{count} thing} other{{count} things}}';
	const errors = validateTranslations({ [key]: key }, { [key]: '{count} things' }, 'fr');
	assert.equal(errors.length, 1);
	assert.match(errors[0], /unknown plural branch "foo" for .*\(source\)/);
});

test('validateTranslations rejects a plural branch that references a placeholder the source does not have', () => {
	// "{1}" inside the branch is a placeholder nothing in the source (just "{0}") provides — this shows up
	// as an overall placeholder-set mismatch, the same as a plain translation inventing an extra `{1}`.
	const errors = validateTranslations(
		{ '{0} files changed': '{0} files changed' },
		{ '{0} files changed': '{0, plural, one{{1} file changed} other{{0} files changed}}' },
		'ru',
	);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /mismatched placeholders for/);
});

test('validateTranslations rejects a plural selector that is not a source placeholder', () => {
	// The block's selector "count" is not among the source's placeholders ("0") — a block's selector
	// counts toward its message's placeholder set, so this is also an overall placeholder-set mismatch.
	const errors = validateTranslations(
		{ '{0} files changed': '{0} files changed' },
		{ '{0} files changed': '{count, plural, one{{0} file} other{{0} files}}' },
		'ru',
	);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /mismatched placeholders for/);
});

test('a branch may omit the selector placeholder — subset, not an exact match', () => {
	assert.deepEqual(
		validateTranslations(
			{ '{0} files changed': '{0} files changed' },
			{ '{0} files changed': '{0, plural, =0{no files changed} one{one file changed} other{{0} files changed}}' },
			'zh-cn',
		),
		[],
	);
});

test('validateTranslations accepts a message with two sibling plural blocks', () => {
	const key =
		'{0, plural, one{{0} commit} other{{0} commits}} behind, {1, plural, one{{1} commit} other{{1} commits}} ahead';
	assert.deepEqual(validateTranslations({ [key]: key }, { [key]: key }, 'en-gb'), []);
});

test('validateTranslations accepts a message with a plural block nested inside another', () => {
	const key =
		'{0, plural, one{{0} commit behind, {1, plural, one{{1} commit ahead} other{{1} commits ahead}}} other{{0} commits behind, {1, plural, one{{1} commit ahead} other{{1} commits ahead}}}}';
	assert.deepEqual(validateTranslations({ [key]: key }, { [key]: key }, 'en-gb'), []);
});

test('validateTranslations rejects a nested block whose selector the source does not have', () => {
	// The source uses selectors "0" and "1" (the inner block is nested inside the outer one's "one"
	// branch). The translation's outer selector is "0" too, but its nested block references "2" — a
	// selector nothing in the source provides, at any nesting depth — so the effective placeholder sets
	// ({0, 1} vs {0, 2}) disagree.
	const key =
		'{0, plural, one{{0} commit behind, {1, plural, one{{1} commit ahead} other{{1} commits ahead}}} other{x}}';
	const translated = '{0, plural, one{{2, plural, one{x} other{y}}} other{z}}';
	const errors = validateTranslations({ [key]: key }, { [key]: translated }, 'de');
	assert.equal(errors.length, 1);
	assert.match(errors[0], /mismatched placeholders for/);
});

test('@vscode/l10n returns an untranslated template verbatim when called with no arguments', () => {
	config({ contents: {} });
	assert.equal(t('{0} files changed'), '{0} files changed');
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
			document: {
				querySelector: () => (contents ? { content: contents } : null),
				documentElement: { lang: '' },
			},
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

test('host initialization translates shared package constants before extension modules load', async () => {
	const { build } = await import('esbuild');
	const { runInNewContext } = await import('node:vm');
	const result = await build({
		stdin: {
			contents:
				"import './src/system/-webview/localization.ts'; import { pausedOperationStatusStringsByType } from '@gitlens/utils/pausedOperation.js'; globalThis.label = pausedOperationStatusStringsByType.rebase.label;",
			resolveDir: process.cwd(),
		},
		bundle: true,
		write: false,
		platform: 'node',
		format: 'cjs',
		external: ['vscode'],
	});
	for (const bundle of [undefined, { Rebasing: 'リベース中' }]) {
		const context = {
			require: id => {
				if (id === 'vscode') return { l10n: { bundle }, env: { language: 'en' } };
				return createRequire(import.meta.url)(id);
			},
		};
		runInNewContext(result.outputFiles[0].text, context);
		assert.equal(context.label, bundle ? 'リベース中' : 'Rebasing');
	}
});

test('Unicode escapes produce the same catalog keys as JavaScript runtime strings', async () => {
	const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const { execFileSync } = await import('node:child_process');
	const source = String.raw`
import { l10n } from 'vscode';
l10n.t('Bullet \u2022 {0}', value);
l10n.t('Nonbreaking \u00a0 {0}', value);
l10n.t('Astral \uD83D\uDE80 {0}', value);
l10n.t('Placeholder {0} before \u{1F680}', value);
l10n.t('Hex \xA0 {0}', value);
l10n.t('Line\nTab\tBackslash\\ {0}', value);
`;
	const expected = Object.fromEntries(
		[
			'Bullet • {0}',
			'Nonbreaking \u00a0 {0}',
			'Astral 🚀 {0}',
			'Placeholder {0} before 🚀',
			'Hex \u00a0 {0}',
			'Line\nTab\tBackslash\\ {0}',
		].map(message => [message, message]),
	);
	assert.deepEqual(await getL10nJson([{ extension: '.ts', contents: source }]), expected);

	const directory = await mkdtemp(join(tmpdir(), 'gitlens-l10n-escapes-'));
	try {
		await writeFile(join(directory, 'sample.ts'), source);
		await writeFile(join(directory, 'package.json'), JSON.stringify({ l10n: './catalog' }));
		const require = createRequire(import.meta.url);
		execFileSync(
			process.execPath,
			[
				require.resolve('@vscode/l10n-dev').replace(/main\.js$/, 'cli.js'),
				'export',
				'--outDir',
				join(directory, 'catalog'),
				directory,
			],
			{ encoding: 'utf8', cwd: directory },
		);
		assert.deepEqual(JSON.parse(await readFile(join(directory, 'catalog/bundle.l10n.json'), 'utf8')), expected);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

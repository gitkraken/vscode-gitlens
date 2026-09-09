import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

async function lint(contents) {
	const directory = await mkdtemp(join(tmpdir(), 'gitlens-require-format-plural-'));
	try {
		const config = join(directory, 'config.json');
		await writeFile(
			config,
			JSON.stringify({
				categories: { correctness: 'off' },
				jsPlugins: [{ name: '@gitlens', specifier: resolve('scripts/eslint-plugin-gitlens.mjs') }],
				rules: { '@gitlens/require-format-plural': 'error' },
			}),
		);
		const fixture = join(directory, 'fixture.ts');
		await writeFile(fixture, contents);
		const result = spawnSync(
			resolve('node_modules/.bin/oxlint'),
			['--config', config, '--format', 'json', fixture],
			{
				encoding: 'utf8',
			},
		);
		return JSON.parse(result.stdout).diagnostics.map(d => d.message);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

const block = "'{0, plural, one{{0} file changed} other{{0} files changed}}'";

test('accepts plural-block messages wrapped in formatPlural and plain messages anywhere', async () => {
	const diagnostics = await lint(
		`import { l10n } from 'vscode'; import { formatPlural } from '@gitlens/utils/plural.js';
		formatPlural(l10n.t(${block}), [count]);
		formatPlural(l10n.t({ message: ${block}, comment: ['Status bar'] }), { 0: count });
		l10n.t('{0} files', count);`,
	);
	assert.deepEqual(diagnostics, []);
});

test('rejects plural-block messages rendered without formatPlural or with translator arguments', async () => {
	const diagnostics = await lint(
		`import * as l10n from '@vscode/l10n'; import { formatPlural } from '@gitlens/utils/plural.js';
		const a = l10n.t(${block});
		const b = formatPlural(l10n.t(${block}, count), [count]);
		const c = l10n.t({ message: ${block}, args: [count] });`,
	);
	assert.equal(diagnostics.filter(m => m.includes('first argument of formatPlural')).length, 2);
	assert.equal(diagnostics.filter(m => m.includes('Pass the arguments to formatPlural')).length, 2);
});

test('points at the import when formatPlural is not imported', async () => {
	const diagnostics = await lint(`import { l10n } from 'vscode'; l10n.t(${block});`);
	assert.deepEqual(diagnostics, ["Import formatPlural from '@gitlens/utils/plural.js' to render this message."]);
});

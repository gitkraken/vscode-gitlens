import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * Runs oxlint with only `@gitlens/no-raw-error-message` enabled against a set of fixture files.
 *
 * The rule scopes itself by each linted file's path relative to `process.cwd()` (`src/`,
 * `packages/git/src/`), so a fixture's key here must be the path it would have *relative to the repo
 * root* — the temp directory is used as the oxlint child process's cwd, not as an arbitrary scratch folder.
 * @param {Record<string, string>} files repo-root-relative path -> file contents
 * @returns {Promise<Array<{ code: string, message: string, filename: string }>>}
 */
async function lint(files) {
	const directory = await mkdtemp(join(tmpdir(), 'gitlens-no-raw-error-message-'));
	try {
		const config = join(directory, 'config.json');
		await writeFile(
			config,
			JSON.stringify({
				categories: { correctness: 'off' },
				jsPlugins: [{ name: '@gitlens', specifier: resolve('scripts/eslint-plugin-gitlens.mjs') }],
				rules: { '@gitlens/no-raw-error-message': 'error' },
			}),
		);

		const relativePaths = [];
		for (const [relativePath, contents] of Object.entries(files)) {
			const filePath = join(directory, relativePath);
			await mkdir(resolve(filePath, '..'), { recursive: true });
			await writeFile(filePath, contents);
			relativePaths.push(relativePath);
		}

		const result = spawnSync(
			resolve('node_modules/.bin/oxlint'),
			['--config', config, '--format', 'json', ...relativePaths],
			{ encoding: 'utf8', cwd: directory },
		);
		const output = JSON.parse(result.stdout || '{"diagnostics":[]}');

		return output.diagnostics ?? [];
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test('flags a raw message shown in a notification', async () => {
	const diagnostics = await lint({
		'src/fixture.ts': 'declare const ex: Error; window.showErrorMessage(ex.message);',
	});
	assert.equal(diagnostics.length, 1);
	assert.ok(diagnostics[0].code.includes('no-raw-error-message'));
});

test('flags a raw message passed to l10n.t', async () => {
	const diagnostics = await lint({
		'src/fixture.ts':
			"declare const ex: Error; declare const l10n: { t(msg: string, ...args: unknown[]): string }; l10n.t('x {0}', ex.message);",
	});
	assert.equal(diagnostics.length, 1);
});

test('flags a raw message nested in an object literal returned from a function', async () => {
	const diagnostics = await lint({
		'src/fixture.ts': 'declare const ex: Error; function toResult() { return { error: { message: ex.message } }; }',
	});
	assert.equal(diagnostics.length, 1);
});

test('flags a raw message read into a local before being displayed', async () => {
	const diagnostics = await lint({
		'src/fixture.ts':
			'declare const ex: Error; declare function show(x: unknown): void; const m = ex.message; show(m);',
	});
	assert.equal(diagnostics.length, 1);
});

test('exempts a message passed to Logger.error', async () => {
	const diagnostics = await lint({
		'src/fixture.ts':
			'declare const ex: Error; declare const Logger: { error(...args: unknown[]): void }; Logger.error(ex.message);',
	});
	assert.equal(diagnostics.length, 0);
});

test('exempts a message passed to a scoped logger call', async () => {
	const diagnostics = await lint({
		'src/fixture.ts':
			'declare const ex: Error; declare const scope: { error(...args: unknown[]): void }; scope.error(ex, ex.message);',
	});
	assert.equal(diagnostics.length, 0);
});

test('exempts a classification read via .includes()', async () => {
	const diagnostics = await lint({
		'src/fixture.ts': "declare const ex: Error; ex.message.includes('x');",
	});
	assert.equal(diagnostics.length, 0);
});

test('exempts a comparison operand', async () => {
	const diagnostics = await lint({
		'src/fixture.ts': "declare const ex: Error; ex.message === 'x';",
	});
	assert.equal(diagnostics.length, 0);
});

test('exempts String(ex.message)', async () => {
	const diagnostics = await lint({
		'src/fixture.ts': 'declare const ex: Error; String(ex.message);',
	});
	assert.equal(diagnostics.length, 0);
});

test('exempts a labeled telemetry field with a string-literal key', async () => {
	const diagnostics = await lint({
		'src/fixture.ts':
			"declare const ex: Error; declare function sendEvent(name: string, data: unknown): void; sendEvent('e', { 'error.message': ex.message });",
	});
	assert.equal(diagnostics.length, 0);
});

test('exempts new Error(ex.message)', async () => {
	const diagnostics = await lint({
		'src/fixture.ts': 'declare const ex: Error; new Error(ex.message);',
	});
	assert.equal(diagnostics.length, 0);
});

test('exempts files under webviews/apps/', async () => {
	const diagnostics = await lint({
		'src/webviews/apps/fixture.ts': 'declare const ex: Error; window.showErrorMessage(ex.message);',
	});
	assert.equal(diagnostics.length, 0);
});

test('sees through ternary, template-literal, and optional-call wrappers to find the sink', async () => {
	const diagnostics = await lint({
		'src/a.ts':
			"declare const ex: unknown; declare const scope: { error(...args: unknown[]): void } | undefined; scope?.error(ex, `Error: ${ex instanceof Error ? ex.message : 'Unknown'}`);",
		'src/b.ts':
			'declare const ex: unknown; declare const Logger: { debug(...args: unknown[]): void }; Logger.debug(`x: ${ex instanceof Error ? ex.message : String(ex)}`);',
		'src/c.ts':
			"declare const ex: unknown; declare function sendEvent(name: string, data: unknown): void; sendEvent('e', { 'error.message': ex instanceof Error ? ex.message : 'Unknown error' });",
	});
	assert.equal(diagnostics.length, 0);
});

test('exempts a labeled telemetry field with an Identifier key', async () => {
	const diagnostics = await lint({
		'src/fixture.ts':
			"declare const ex: Error; declare function sendTelemetryEvent(name: string, data: unknown): void; sendTelemetryEvent('e', { error: ex.message });",
	});
	assert.equal(diagnostics.length, 0);
});

test('exempts a message passed to a regex/string classification call, and typeof <err>.message', async () => {
	const diagnostics = await lint({
		'src/a.ts': 'declare const ex: Error; /No provider registered/i.test(ex.message);',
		// Mirrors src/system/-webview/loadChunk.ts:32 — both reads are classification, not display: the
		// `typeof e.message === 'string'` operand, and the `.test(e.message)` argument.
		'src/b.ts':
			"declare const e: { message?: unknown }; typeof e.message === 'string' && /Cannot find module/.test(e.message);",
	});
	assert.equal(diagnostics.length, 0);
});

test('scopes to src/ and packages/git/src/, pointing packages/git at .localizedMessage', async () => {
	const outOfScope = await lint({
		'packages/plus/integrations/src/fixture.ts': 'declare const ex: Error; window.showErrorMessage(ex.message);',
	});
	assert.equal(outOfScope.length, 0);

	const inPackagesGit = await lint({
		'packages/git/src/fixture.ts': 'declare const ex: Error; window.showErrorMessage(ex.message);',
	});
	assert.equal(inPackagesGit.length, 1);
	assert.match(inPackagesGit[0].message, /\.localizedMessage/);
});

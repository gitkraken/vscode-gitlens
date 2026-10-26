import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { scanOutput, secretNeedles } from '../e2eScanForSecrets.mjs';

const secret = 'gk-cookie-0123456789abcdef';

/**
 * @param {Record<string, string>} files output-relative path -> file contents
 * @param {(dir: string) => Promise<void>} run
 */
async function withOutput(files, run) {
	const directory = await mkdtemp(join(tmpdir(), 'gitlens-e2e-scan-'));
	try {
		for (const [file, content] of Object.entries(files)) {
			const full = join(directory, file);
			await mkdir(join(full, '..'), { recursive: true });
			await writeFile(full, content);
		}
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function scan(dir, env = { SECRET: secret }) {
	return scanOutput([dir], secretNeedles(env, Object.keys(env)), () => {});
}

test('deletes a file holding a secret verbatim and in each encoding', async () => {
	const forms = {
		'verbatim.txt': `cookie=${secret}`,
		'base64.json': JSON.stringify({ value: Buffer.from(secret).toString('base64') }),
		'base64url.log': Buffer.from(secret).toString('base64url'),
		'url.md': `https://example.test/?c=${encodeURIComponent(secret)}`,
	};
	await withOutput({ ...forms, 'clean.txt': 'nothing here' }, async dir => {
		const result = scan(dir);
		assert.equal(result.removed.length, 4);
		for (const file of Object.keys(forms)) {
			assert.equal(existsSync(join(dir, file)), false, file);
		}
		assert.equal(existsSync(join(dir, 'clean.txt')), true);
	});
});

test('finds a secret base64-encoded inside a larger blob at every byte offset', async () => {
	const blobs = {};
	for (const prefix of ['', 'x', 'xy', 'Cookie: stagingAccessToken=']) {
		blobs[`b64-${prefix.length}.txt`] = Buffer.from(`${prefix}${secret}; Path=/`).toString('base64');
		blobs[`b64url-${prefix.length}.txt`] = Buffer.from(`${prefix}${secret}; Path=/`).toString('base64url');
	}
	await withOutput(blobs, async dir => {
		const result = scan(dir);
		assert.equal(result.removed.length, Object.keys(blobs).length);
	});
});

test('masks e-mail addresses in text files but leaves other files alone', async () => {
	await withOutput(
		{
			'test-results/spec/error-context.md': '- text: qa.account+e2e@example.co.uk\n- button "Sign Out"',
			'image.png': 'binary qa.account@example.com',
		},
		async dir => {
			const result = scan(dir);
			assert.equal(result.removed.length, 0);
			assert.equal(result.masked.length, 1);
			assert.equal(
				await readFile(join(dir, 'test-results/spec/error-context.md'), 'utf8'),
				'- text: <email>\n- button "Sign Out"',
			);
			assert.equal(await readFile(join(dir, 'image.png'), 'utf8'), 'binary qa.account@example.com');
		},
	);
});

test('masks JWT-shaped tokens and skips text-named files holding NUL bytes', async () => {
	const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
	await withOutput({ 'log.txt': `token ${jwt} end`, 'blob.json': `\0${jwt}` }, async dir => {
		const result = scan(dir);
		assert.deepEqual(result.masked, [join(dir, 'log.txt')]);
		assert.equal(await readFile(join(dir, 'log.txt'), 'utf8'), 'token <token> end');
		assert.equal(await readFile(join(dir, 'blob.json'), 'utf8'), `\0${jwt}`);
	});
});

test('deletes an archive it cannot read', async () => {
	await withOutput({ 'trace.zip': 'not a zip' }, async dir => {
		const result = scan(dir);
		assert.deepEqual(result.removed, [join(dir, 'trace.zip')]);
		assert.equal(existsSync(join(dir, 'trace.zip')), false);
	});
});

test('deletes a file it cannot mask instead of aborting the scan', async () => {
	await withOutput(
		{ 'a-readonly.log': 'user qa.account@example.com', 'b-later.txt': 'qa.account@example.com' },
		async dir => {
			await chmod(join(dir, 'a-readonly.log'), 0o444);
			const result = scan(dir);
			assert.deepEqual(result.removed, [join(dir, 'a-readonly.log')]);
			assert.equal(existsSync(join(dir, 'a-readonly.log')), false);
			// The scan went on past the failure
			assert.equal(await readFile(join(dir, 'b-later.txt'), 'utf8'), '<email>');
		},
	);
});

test('the CLI reports a complete pass to GITHUB_OUTPUT', async () => {
	await withOutput({ 'clean.txt': 'nothing here' }, async dir => {
		// Outside the scanned directory, so the scan doesn't read its own output file
		const output = `${dir}-output`;
		try {
			const result = spawnSync(process.execPath, [resolve('scripts/e2eScanForSecrets.mjs'), dir], {
				encoding: 'utf8',
				env: { ...process.env, SCAN_SECRET_NAMES: '', GITHUB_OUTPUT: output },
			});
			assert.equal(result.status, 0);
			assert.equal(await readFile(output, 'utf8'), 'complete=true\n');
		} finally {
			await rm(output, { force: true });
		}
	});
});

test('finds a secret stored with surrounding whitespace in its trimmed form', async () => {
	await withOutput(
		{ 'verbatim.txt': `cookie=${secret};`, 'base64.log': Buffer.from(secret).toString('base64') },
		async dir => {
			const result = scan(dir, { SECRET: `${secret}\n` });
			assert.equal(result.removed.length, 2);
		},
	);
});

test('ignores short or missing values', () => {
	assert.deepEqual(secretNeedles({ SHORT: 'abc', EMPTY: '' }, ['SHORT', 'EMPTY', 'MISSING']), []);
});

test('the CLI fails the run and names only the variable when a secret is found', async () => {
	await withOutput({ 'trace.txt': `token ${secret}` }, async dir => {
		const result = spawnSync(process.execPath, [resolve('scripts/e2eScanForSecrets.mjs'), dir], {
			encoding: 'utf8',
			env: { ...process.env, SCAN_SECRET_NAMES: 'GK_E2E_TEST_SECRET', GK_E2E_TEST_SECRET: secret },
		});
		assert.equal(result.status, 1);
		assert.match(result.stdout, /contains GK_E2E_TEST_SECRET \(verbatim\)/);
		assert.equal(result.stdout.includes(secret), false);
	});
});

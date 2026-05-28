import * as assert from 'assert';
import { ppid } from 'process';
import { getDiscoveryFileName, parseDiscoveryFileName } from '../discovery.js';

suite('parseDiscoveryFileName', () => {
	test('parses a valid discovery file name', () => {
		const result = parseDiscoveryFileName('gitlens-ipc-server-1234-56789.json');
		assert.deepStrictEqual(result, { ppid: 1234, port: 56789 });
	});

	test('round-trips with getDiscoveryFileName', () => {
		const result = parseDiscoveryFileName(getDiscoveryFileName(65535));
		assert.deepStrictEqual(result, { ppid: ppid, port: 65535 });
	});

	test('returns undefined for a non-matching name', () => {
		assert.strictEqual(parseDiscoveryFileName('not-a-discovery-file.json'), undefined);
	});

	test('returns undefined when the prefix is wrong', () => {
		assert.strictEqual(parseDiscoveryFileName('gitlens-ipc-1234-5678.json'), undefined);
	});

	test('returns undefined for non-numeric segments', () => {
		assert.strictEqual(parseDiscoveryFileName('gitlens-ipc-server-abc-def.json'), undefined);
	});

	test('returns undefined when the extension is missing', () => {
		assert.strictEqual(parseDiscoveryFileName('gitlens-ipc-server-1234-5678'), undefined);
	});

	test('returns undefined for a wrong extension', () => {
		assert.strictEqual(parseDiscoveryFileName('gitlens-ipc-server-1234-5678.txt'), undefined);
	});
});

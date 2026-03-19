import * as assert from 'assert';
import { URI } from 'vscode-uri';
import { getRepositoryKey } from '../uri.js';

suite('getRepositoryKey', () => {
	test('plain local path string returns normalized path', () => {
		assert.strictEqual(getRepositoryKey('/home/user/repo'), '/home/user/repo');
	});

	test('local path with trailing slash is normalized', () => {
		assert.strictEqual(getRepositoryKey('/home/user/repo/'), '/home/user/repo');
	});

	test('backslash path is normalized to forward slashes', () => {
		const result = getRepositoryKey('C:\\Users\\foo\\repo');
		assert.ok(!result.includes('\\'), 'should not contain backslashes');
		assert.ok(result.includes('C:/Users/foo/repo') || result.includes('c:/Users/foo/repo'));
	});

	test('file URI string is parsed and normalized to fsPath', () => {
		const fileUriStr = 'file:///home/user/repo';
		const result = getRepositoryKey(fileUriStr);
		assert.strictEqual(result, '/home/user/repo');
	});

	test('file URI string and equivalent path produce the same key', () => {
		const fromPath = getRepositoryKey('/home/user/repo');
		const fromUri = getRepositoryKey('file:///home/user/repo');
		assert.strictEqual(fromPath, fromUri);
	});

	test('non-file URI string is parsed and canonicalized via toString()', () => {
		const vfsUri = 'vscode-vfs://github/owner/repo';
		const result = getRepositoryKey(vfsUri);
		// URI.parse may canonicalize, but the scheme and authority must be preserved
		assert.ok(result.startsWith('vscode-vfs://'), `expected vscode-vfs scheme, got: ${result}`);
		assert.ok(result.includes('github'), `expected github authority, got: ${result}`);
		assert.ok(result.includes('/owner/repo'), `expected path, got: ${result}`);
	});

	test('file: Uri object returns normalized fsPath', () => {
		const uri = URI.file('/home/user/repo');
		assert.strictEqual(getRepositoryKey(uri), '/home/user/repo');
	});

	test('non-file Uri object returns toString()', () => {
		const uri = URI.parse('vscode-vfs://github/owner/repo');
		const result = getRepositoryKey(uri);
		assert.strictEqual(result, uri.toString());
	});

	test('non-file Uri preserves scheme and authority', () => {
		const uri = URI.parse('github+ssh://github.com/owner/repo');
		const result = getRepositoryKey(uri);
		assert.ok(result.startsWith('github+ssh://'), `expected github+ssh scheme, got: ${result}`);
		assert.ok(result.includes('github.com'), `expected authority, got: ${result}`);
	});
});

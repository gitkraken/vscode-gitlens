import * as assert from 'assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Uri, workspace } from 'vscode';
import {
	findUserAvatarValue,
	getUserAvatarFileUri,
	getUserAvatarMimeType,
	loadUserAvatarAsDataUri,
} from '../avatars.js';

suite('findUserAvatarValue', () => {
	test('matches an email exactly', () => {
		assert.strictEqual(
			findUserAvatarValue('jane@company.com', { 'jane@company.com': '/avatars/jane.png' }),
			'/avatars/jane.png',
		);
	});

	test('matches setting keys case-insensitively', () => {
		assert.strictEqual(
			findUserAvatarValue('jane@company.com', { 'Jane@Company.com': '/avatars/jane.png' }),
			'/avatars/jane.png',
		);
	});

	test('trims whitespace around the email and keys', () => {
		assert.strictEqual(
			findUserAvatarValue('  jane@company.com ', { ' jane@company.com ': '/avatars/jane.png' }),
			'/avatars/jane.png',
		);
	});

	test('returns undefined when there is no mapping', () => {
		assert.strictEqual(
			findUserAvatarValue('jane@company.com', { 'john@company.com': '/avatars/john.png' }),
			undefined,
		);
		assert.strictEqual(findUserAvatarValue('jane@company.com', undefined), undefined);
		assert.strictEqual(findUserAvatarValue('jane@company.com', null), undefined);
	});
});

suite('getUserAvatarFileUri', () => {
	test('turns a plain path into a file Uri', () => {
		const uri = getUserAvatarFileUri('/Users/jane/photos/jane.png');
		assert.strictEqual(uri?.scheme, 'file');
	});

	test('keeps file: URIs as-is', () => {
		const uri = getUserAvatarFileUri('file:///Users/jane/photos/jane.png');
		assert.strictEqual(uri?.scheme, 'file');
		assert.strictEqual(uri?.fsPath, '/Users/jane/photos/jane.png');
	});

	test('rejects non-file schemes', () => {
		assert.strictEqual(getUserAvatarFileUri('https://example.com/jane.png'), undefined);
	});

	test('rejects empty values', () => {
		assert.strictEqual(getUserAvatarFileUri(''), undefined);
		assert.strictEqual(getUserAvatarFileUri('   '), undefined);
	});

	test('treats Windows drive paths as file paths', () => {
		const uri = getUserAvatarFileUri('C:\\avatars\\jane.png');
		assert.strictEqual(uri?.scheme, 'file');
	});
});

suite('getUserAvatarMimeType', () => {
	test('maps supported raster extensions', () => {
		assert.strictEqual(getUserAvatarMimeType('/avatars/jane.png'), 'image/png');
		assert.strictEqual(getUserAvatarMimeType('/avatars/jane.jpg'), 'image/jpeg');
		assert.strictEqual(getUserAvatarMimeType('/avatars/jane.jpeg'), 'image/jpeg');
		assert.strictEqual(getUserAvatarMimeType('/avatars/jane.gif'), 'image/gif');
		assert.strictEqual(getUserAvatarMimeType('/avatars/jane.webp'), 'image/webp');
	});

	test('matches extensions case-insensitively', () => {
		assert.strictEqual(getUserAvatarMimeType('/avatars/jane.PNG'), 'image/png');
	});

	test('returns undefined for unsupported or missing extensions', () => {
		assert.strictEqual(getUserAvatarMimeType('/avatars/jane.svg'), undefined);
		assert.strictEqual(getUserAvatarMimeType('/avatars/jane'), undefined);
	});
});

suite('loadUserAvatarAsDataUri', () => {
	async function writeTempFile(name: string, contents: Uint8Array): Promise<Uri> {
		const uri = Uri.file(join(tmpdir(), name));
		await workspace.fs.writeFile(uri, contents);

		return uri;
	}

	test('reads a local file into a data Uri', async () => {
		const uri = await writeTempFile('gl-user-avatar-test.png', new Uint8Array([1, 2, 3]));
		try {
			const dataUri = await loadUserAvatarAsDataUri(uri.fsPath);
			assert.strictEqual(dataUri?.toString(), 'data:image/png;base64,AQID');
		} finally {
			await workspace.fs.delete(uri);
		}
	});

	test('returns undefined for a missing file', async () => {
		assert.strictEqual(
			await loadUserAvatarAsDataUri(join(tmpdir(), 'gl-user-avatar-does-not-exist.png')),
			undefined,
		);
	});

	test('returns undefined for an unsupported file type', async () => {
		const uri = await writeTempFile('gl-user-avatar-test.txt', new Uint8Array([1, 2, 3]));
		try {
			assert.strictEqual(await loadUserAvatarAsDataUri(uri.fsPath), undefined);
		} finally {
			await workspace.fs.delete(uri);
		}
	});

	test('returns undefined for a file over the size cap', async () => {
		const uri = await writeTempFile('gl-user-avatar-test-big.png', new Uint8Array(600 * 1024));
		try {
			assert.strictEqual(await loadUserAvatarAsDataUri(uri.fsPath), undefined);
		} finally {
			await workspace.fs.delete(uri);
		}
	});
});

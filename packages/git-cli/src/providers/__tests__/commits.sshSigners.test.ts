import * as assert from 'assert';
import type { SshSignedCommit } from '@gitlens/git/models/signature.js';
import { parseCatFileBatchForSshSigners } from '../commits.js';

/** Encodes a length-prefixed SSH wire-format string (big-endian uint32 length + bytes). */
function sshString(b: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(b.length);
	return Buffer.concat([len, b]);
}

/** Builds a raw commit object carrying a synthetic SSHSIG with the given key type/body and message. */
function buildSshSignedCommit(keyType: string, keyBody: Buffer, message = 'signed commit'): string {
	const pubKeyBlob = Buffer.concat([sshString(Buffer.from(keyType, 'utf8')), sshString(keyBody)]);
	const version = Buffer.alloc(4);
	version.writeUInt32BE(1);
	const namespace = sshString(Buffer.from('git', 'utf8'));
	const blob = Buffer.concat([Buffer.from('SSHSIG', 'latin1'), version, sshString(pubKeyBlob), namespace]);
	const armored = blob.toString('base64');
	return `tree 2e81171448eb9f2ee3821e3d447aa6b2fe3ddba1
committer Fixture User <fixture@example.com> 1781882202 -0300
gpgsig -----BEGIN SSH SIGNATURE-----
 ${armored}
 -----END SSH SIGNATURE-----

${message}
`;
}

const sha1 = 'a'.repeat(40);
const sha2 = 'b'.repeat(40);
const sha3 = 'c'.repeat(40);

const unsignedObject = `tree 2e81171448eb9f2ee3821e3d447aa6b2fe3ddba1
committer Jane <jane@example.com> 1781882202 -0300

unsigned commit
`;

suite('parseCatFileBatchForSshSigners', () => {
	test('extracts only SSH-signed commits, keyed by sha with committer identity', () => {
		const stdout = `${sha1} commit 500\n${buildSshSignedCommit('ssh-ed25519', Buffer.alloc(32, 7))}${sha2} commit 80\n${unsignedObject}`;

		const out = new Map<string, SshSignedCommit>();
		parseCatFileBatchForSshSigners(stdout, new Set([sha1, sha2]), out);

		assert.strictEqual(out.size, 1);
		assert.ok(out.has(sha1));
		assert.strictEqual(out.get(sha1)?.email, 'fixture@example.com');
		assert.strictEqual(out.get(sha1)?.key.keyType, 'ssh-ed25519');
		assert.ok(!out.has(sha2));
	});

	test('skips a missing object without consuming the next object', () => {
		const stdout = `${sha3} missing\n${sha1} commit 500\n${buildSshSignedCommit('ssh-ed25519', Buffer.alloc(32, 7))}`;

		const out = new Map<string, SshSignedCommit>();
		parseCatFileBatchForSshSigners(stdout, new Set([sha1, sha3]), out);

		assert.strictEqual(out.size, 1);
		assert.ok(out.has(sha1));
		assert.ok(!out.has(sha3));
	});

	test('does not treat a header-like message line for a non-requested sha as a boundary', () => {
		const fakeSha = 'd'.repeat(40);
		const message = `body line\n${fakeSha} commit 7\nmore body`;
		const stdout = `${sha1} commit 600\n${buildSshSignedCommit('ssh-ed25519', Buffer.alloc(32, 7), message)}`;

		const out = new Map<string, SshSignedCommit>();
		parseCatFileBatchForSshSigners(stdout, new Set([sha1]), out);

		assert.strictEqual(out.size, 1);
		assert.ok(out.has(sha1));
		assert.ok(!out.has(fakeSha));
	});

	test('returns an empty map for empty output', () => {
		const out = new Map<string, SshSignedCommit>();
		parseCatFileBatchForSshSigners('', new Set([sha1]), out);
		assert.strictEqual(out.size, 0);
	});
});

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

/** A `cat-file --batch` record for a found object: `<sha> <type> <size>` LF `<bytes>` LF, with a byte-accurate size. */
function found(sha: string, object: string, type = 'commit'): Buffer {
	const body = Buffer.from(object, 'utf8');
	return Buffer.concat([Buffer.from(`${sha} ${type} ${body.length}\n`), body, Buffer.from('\n')]);
}

/** A `cat-file --batch` record for a missing object: `<sha> missing` LF (no content body). */
function missing(sha: string): Buffer {
	return Buffer.from(`${sha} missing\n`);
}

suite('parseCatFileBatchForSshSigners', () => {
	test('extracts only SSH-signed commits, keyed by sha with committer identity', () => {
		const stdout = Buffer.concat([
			found(sha1, buildSshSignedCommit('ssh-ed25519', Buffer.alloc(32, 7))),
			found(sha2, unsignedObject),
		]);

		const out = new Map<string, SshSignedCommit>();
		parseCatFileBatchForSshSigners(stdout, new Set([sha1, sha2]), out);

		assert.strictEqual(out.size, 1);
		assert.ok(out.has(sha1));
		assert.strictEqual(out.get(sha1)?.email, 'fixture@example.com');
		assert.strictEqual(out.get(sha1)?.key.keyType, 'ssh-ed25519');
		assert.ok(!out.has(sha2));
	});

	test('skips a missing object without consuming the next object', () => {
		const stdout = Buffer.concat([
			missing(sha3),
			found(sha1, buildSshSignedCommit('ssh-ed25519', Buffer.alloc(32, 7))),
		]);

		const out = new Map<string, SshSignedCommit>();
		parseCatFileBatchForSshSigners(stdout, new Set([sha1, sha3]), out);

		assert.strictEqual(out.size, 1);
		assert.ok(out.has(sha1));
		assert.ok(!out.has(sha3));
	});

	test('does not treat a header-like message line for a non-requested sha as a boundary', () => {
		const fakeSha = 'd'.repeat(40);
		const message = `body line\n${fakeSha} commit 7\nmore body`;
		const stdout = found(sha1, buildSshSignedCommit('ssh-ed25519', Buffer.alloc(32, 7), message));

		const out = new Map<string, SshSignedCommit>();
		parseCatFileBatchForSshSigners(stdout, new Set([sha1]), out);

		assert.strictEqual(out.size, 1);
		assert.ok(out.has(sha1));
		assert.ok(!out.has(fakeSha));
	});

	test('does not treat a header-like message line for a requested sha as a boundary', () => {
		// A commit body that embeds what looks like another requested object's header must not truncate this object
		// or hijack the parse of the following one — the byte `<size>` delimits the object regardless of its content.
		const message = `see also\n${sha2} commit 7\ntrailing body`;
		const stdout = Buffer.concat([
			found(sha1, buildSshSignedCommit('ssh-ed25519', Buffer.alloc(32, 7), message)),
			found(sha2, unsignedObject),
		]);

		const out = new Map<string, SshSignedCommit>();
		parseCatFileBatchForSshSigners(stdout, new Set([sha1, sha2]), out);

		assert.strictEqual(out.size, 1);
		assert.ok(out.has(sha1));
		assert.strictEqual(out.get(sha1)?.key.keyType, 'ssh-ed25519');
		assert.ok(!out.has(sha2));
	});

	test('consumes objects by byte size, tolerating multi-byte content', () => {
		// `<size>` is a byte count; a committer name with multi-byte characters must not shift the object boundary.
		const message = 'café ☕ commit';
		const stdout = Buffer.concat([
			found(sha1, buildSshSignedCommit('ssh-ed25519', Buffer.alloc(32, 7), message)),
			found(sha2, buildSshSignedCommit('ssh-ed25519', Buffer.alloc(32, 9))),
		]);

		const out = new Map<string, SshSignedCommit>();
		parseCatFileBatchForSshSigners(stdout, new Set([sha1, sha2]), out);

		assert.strictEqual(out.size, 2);
		assert.ok(out.has(sha1));
		assert.ok(out.has(sha2));
		assert.strictEqual(out.get(sha2)?.email, 'fixture@example.com');
	});

	test('returns an empty map for empty output', () => {
		const out = new Map<string, SshSignedCommit>();
		parseCatFileBatchForSshSigners(Buffer.alloc(0), new Set([sha1]), out);
		assert.strictEqual(out.size, 0);
	});
});

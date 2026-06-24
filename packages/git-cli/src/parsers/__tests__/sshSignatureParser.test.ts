import * as assert from 'assert';
import { extractCommitterFromCommitObject, extractSshPublicKeyFromCommitObject } from '../sshSignatureParser.js';

// Real `git cat-file commit <sha>` output for commits signed with `gpg.format=ssh`.
const ed25519SignedCommit = `tree 2e81171448eb9f2ee3821e3d447aa6b2fe3ddba1
author Fixture User <fixture@example.com> 1781882202 -0300
committer Fixture User <fixture@example.com> 1781882202 -0300
gpgsig -----BEGIN SSH SIGNATURE-----
 U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgXZCXrbV699MarEGCpcLMQiBlKY
 40arLUzIDMm0MUpkcAAAADZ2l0AAAAAAAAAAZzaGE1MTIAAABTAAAAC3NzaC1lZDI1NTE5
 AAAAQEtiD4ryouYuWDlEFj8V9BsY7Nx8gxNK2laXYf8HFKxPdIsx5eS8UZ9FDftxYxrQgl
 k+OzDQkXmAlqAkLpCN9wQ=
 -----END SSH SIGNATURE-----

ed25519 signed commit
`;
const ed25519ExpectedType = 'ssh-ed25519';
const ed25519ExpectedData = 'AAAAC3NzaC1lZDI1NTE5AAAAIF2Ql621evfTGqxBgqXCzEIgZSmONGqy1MyAzJtDFKZH';

const rsaSignedCommit = `tree 18eb80fbbbf9160491c007668d5298f1e86cd40a
parent 59fb567e8274b8f11751477eaeab820d9522bf27
author Fixture User <fixture@example.com> 1781882202 -0300
committer Fixture User <fixture@example.com> 1781882202 -0300
gpgsig -----BEGIN SSH SIGNATURE-----
 U1NIU0lHAAAAAQAAARcAAAAHc3NoLXJzYQAAAAMBAAEAAAEBAPBfDfASk/VD630Stem1D2
 ufltcNcoBDKyKs4oLob4iM9lCYuc7UnbJb1EJnYrqblkIDGFC9BZFK7rFdShUcrtEm1SXb
 HSn7Uw+6gtgGaj0tym9RGBIMMJdyQR0XK9i3a9PiKBUugmw2OrZ1hjQ+mw4wv6nvWD0z5z
 RX9aOvFGQZ2itBNBKaa0KQDqolwoKJxn9xCg9qGEMO+G82sdUCcLovZdiZkC8PAXpnFPvU
 c6J5GzaAtetgeZ342/uBw91lfdSnWlLVnW0MVue8OJuR7gM4ai4ztsoTBXkAet3f37ZSTt
 EPXO6Hxw2gG3SklDaDEHXsscMG7+T5FsXdQKk6UPsAAAADZ2l0AAAAAAAAAAZzaGE1MTIA
 AAEUAAAADHJzYS1zaGEyLTUxMgAAAQBhZSTl+lNXG7JhbNGqIY7Q1e5Y1cqXgc7qQ1Copq
 vd/jCbo25/thzJpNvIinlYR2un9wZm1N3n9SmYgVEo0NwR5LVdOcyDMl7/sXAnomhoZFaF
 NKmXybYUaDAIi+Sy6MTXdz/9glkG8KR6uXtveBxxHozU5K6TDrQAc3HwVGUInoZsWnzw2E
 m1nFI1XP3nYobVlj7Syaj3/4e13b3rbOh+DSO3+XOMRHB+0dUDizpu3cQH4Ex6WpHeEOzm
 NeIIbx8t9d4fTSGD75YywHVB9eANcUn8IDa9J0rrw1uv1mHUXmueKPid6OTaRU8z/gQ9We
 SXHbwfBDXTZU9yjuTHXTHu
 -----END SSH SIGNATURE-----

rsa signed commit
`;
const rsaExpectedType = 'ssh-rsa';
const rsaExpectedData =
	'AAAAB3NzaC1yc2EAAAADAQABAAABAQDwXw3wEpP1Q+t9ErXptQ9rn5bXDXKAQysirOKC6G+IjPZQmLnO1J2yW9RCZ2K6m5ZCAxhQvQWRSu6xXUoVHK7RJtUl2x0p+1MPuoLYBmo9LcpvURgSDDCXckEdFyvYt2vT4igVLoJsNjq2dYY0PpsOML+p71g9M+c0V/WjrxRkGdorQTQSmmtCkA6qJcKCicZ/cQoPahhDDvhvNrHVAnC6L2XYmZAvDwF6ZxT71HOieRs2gLXrYHmd+Nv7gcPdZX3Up1pS1Z1tDFbnvDibke4DOGouM7bKEwV5AHrd39+2Uk7RD1zuh8cNoBt0pJQ2gxB17LHDBu/k+RbF3UCpOlD7';

const unsignedCommit = `tree 2e81171448eb9f2ee3821e3d447aa6b2fe3ddba1
author Fixture User <fixture@example.com> 1781882202 -0300
committer Fixture User <fixture@example.com> 1781882202 -0300

unsigned commit
`;

const gpgSignedCommit = `tree 2e81171448eb9f2ee3821e3d447aa6b2fe3ddba1
author Fixture User <fixture@example.com> 1781882202 -0300
committer Fixture User <fixture@example.com> 1781882202 -0300
gpgsig -----BEGIN PGP SIGNATURE-----
 iQEzBAABCgAdFiEEexampleexampleexampleexampleexampleAAoJEAAAAAAAAAAA
 -----END PGP SIGNATURE-----

gpg signed commit
`;

/** Encodes a length-prefixed SSH wire-format string (big-endian uint32 length + bytes). */
function sshString(b: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(b.length);
	return Buffer.concat([len, b]);
}

/**
 * Builds a commit object carrying a synthetic SSHSIG with the given (attacker-chosen) key type and body. The signature
 * blob is stored verbatim by Git and never verified on read, so a hostile commit can put anything here.
 */
function buildSshSignedCommit(keyType: string, keyBody: Buffer): string {
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

crafted commit
`;
}

suite('SSH Signature Parser Test Suite', () => {
	test('extracts the full ed25519 public key from a signed commit', () => {
		const result = extractSshPublicKeyFromCommitObject(ed25519SignedCommit);

		assert.ok(result, 'Should extract a key');
		assert.strictEqual(result?.keyType, ed25519ExpectedType);
		assert.strictEqual(result?.keyData, ed25519ExpectedData);
	});

	test('extracts the full rsa public key from a signed commit', () => {
		const result = extractSshPublicKeyFromCommitObject(rsaSignedCommit);

		assert.ok(result, 'Should extract a key');
		assert.strictEqual(result?.keyType, rsaExpectedType);
		assert.strictEqual(result?.keyData, rsaExpectedData);
	});

	test('returns undefined for an unsigned commit', () => {
		assert.strictEqual(extractSshPublicKeyFromCommitObject(unsignedCommit), undefined);
	});

	test('returns undefined for a GPG-signed (non-SSH) commit', () => {
		assert.strictEqual(extractSshPublicKeyFromCommitObject(gpgSignedCommit), undefined);
	});

	test('returns undefined for empty or malformed input', () => {
		assert.strictEqual(extractSshPublicKeyFromCommitObject(''), undefined);
		assert.strictEqual(
			extractSshPublicKeyFromCommitObject('gpgsig -----BEGIN SSH SIGNATURE-----\n not-valid-base64!!!\n'),
			undefined,
		);
	});

	test('extracts the committer name and raw email', () => {
		assert.deepStrictEqual(extractCommitterFromCommitObject(ed25519SignedCommit), {
			name: 'Fixture User',
			email: 'fixture@example.com',
		});
	});

	test('extracts the committer even when the author differs', () => {
		const commit = `tree 2e81171448eb9f2ee3821e3d447aa6b2fe3ddba1
author Someone Else <author@example.com> 1781882202 -0300
committer Real Committer <committer@example.com> 1781882202 -0300

message
`;
		assert.deepStrictEqual(extractCommitterFromCommitObject(commit), {
			name: 'Real Committer',
			email: 'committer@example.com',
		});
	});

	test('returns undefined committer for input without a committer line', () => {
		assert.strictEqual(extractCommitterFromCommitObject('not a commit'), undefined);
	});

	test('extracts a synthetic but well-formed key (builder sanity check)', () => {
		const result = extractSshPublicKeyFromCommitObject(buildSshSignedCommit('ssh-ed25519', Buffer.alloc(32, 7)));
		assert.strictEqual(result?.keyType, 'ssh-ed25519');
	});

	test('rejects a key type containing a newline (would inject an allowed_signers line)', () => {
		const commit = buildSshSignedCommit(`ssh-ed25519\n* ssh-rsa AAAA`, Buffer.alloc(32, 7));
		assert.strictEqual(extractSshPublicKeyFromCommitObject(commit), undefined);
	});

	test('rejects a key type containing a space', () => {
		const commit = buildSshSignedCommit('ssh-ed25519 evil', Buffer.alloc(32, 7));
		assert.strictEqual(extractSshPublicKeyFromCommitObject(commit), undefined);
	});

	test('rejects an unrecognized key type', () => {
		const commit = buildSshSignedCommit('ssh-bogus', Buffer.alloc(32, 7));
		assert.strictEqual(extractSshPublicKeyFromCommitObject(commit), undefined);
	});
});

import type { SshPublicKey } from '@gitlens/git/models/signature.js';
import { isValidSshKeyData, isValidSshKeyType } from '@gitlens/git/utils/sshKey.utils.js';

const sshSigMagic = 'SSHSIG';
const gpgSigHeaderRegex = /^gpgsig(?:-sha256)? /;
const sshSigArmorRegex = /-----BEGIN SSH SIGNATURE-----\n([\s\S]*?)\n-----END SSH SIGNATURE-----/;
// A commit header line: `committer Display Name <email> <unix-ts> <tz>`.
const committerRegex = /^committer (.*) <([^>]*)> \d+ [-+]\d+$/m;

/**
 * Extracts the committer's name and raw email from a commit object. The raw email (not a mailmapped one) is the
 * principal Git checks an SSH signature against, so it's what an `allowed_signers` entry must use.
 */
export function extractCommitterFromCommitObject(commitObject: string): { name: string; email: string } | undefined {
	const match = committerRegex.exec(commitObject);
	if (match == null) return undefined;

	return { name: match[1], email: match[2] };
}

/**
 * Extracts the signer's full SSH public key from a commit object's `gpgsig` SSH signature.
 *
 * A commit signed with `gpg.format=ssh` stores an armored `-----BEGIN SSH SIGNATURE-----` (SSHSIG) blob in its
 * `gpgsig` header, and the SSHSIG wire format embeds the signer's full public key — exactly what an `allowed_signers`
 * entry requires. (`git log`'s signature fields only expose the key fingerprint, never the full key.)
 *
 * @param commitObject Raw commit object text, as produced by `git cat-file commit <sha>`
 * @returns The key type and base64 public-key blob, or `undefined` if the commit isn't SSH-signed or can't be parsed.
 */
export function extractSshPublicKeyFromCommitObject(commitObject: string): SshPublicKey | undefined {
	const armored = extractArmoredSignature(commitObject);
	if (armored == null) return undefined;

	const buffer = Buffer.from(armored, 'base64');

	// SSHSIG wire format (see OpenSSH PROTOCOL.sshsig):
	//   byte[6] MAGIC "SSHSIG" | uint32 version | string publickey | string namespace | ...
	// where each `string` is a big-endian uint32 length followed by that many bytes.
	if (buffer.length < 10 || buffer.toString('latin1', 0, 6) !== sshSigMagic) return undefined;

	// `publickey` is the first length-prefixed string, after the 6-byte magic and 4-byte version.
	const pubKeyBlob = readSshString(buffer, 10);
	if (pubKeyBlob == null) return undefined;

	// The public-key blob itself begins with its key type as a length-prefixed string.
	const keyType = readSshString(pubKeyBlob, 0)?.toString('utf8');
	if (!keyType) return undefined;

	const keyData = pubKeyBlob.toString('base64');
	// The signature blob is attacker-controllable (Git stores it verbatim and never verifies it on read), so reject
	// anything that isn't a recognized key type / well-formed base64 before it can become an `allowed_signers` entry.
	if (!isValidSshKeyType(keyType) || !isValidSshKeyData(keyData)) return undefined;

	return { keyType: keyType, keyData: keyData };
}

/** Extracts and concatenates the base64 body of the armored SSH signature from a commit's `gpgsig` header. */
function extractArmoredSignature(commitObject: string): string | undefined {
	const lines = commitObject.split('\n');
	const start = lines.findIndex(l => gpgSigHeaderRegex.test(l));
	if (start === -1) return undefined;

	// The header value, followed by continuation lines (each indented with a single leading space).
	const block = [lines[start].replace(gpgSigHeaderRegex, '')];
	for (let i = start + 1; i < lines.length; i++) {
		if (!lines[i].startsWith(' ')) break;

		block.push(lines[i].slice(1));
	}

	const match = sshSigArmorRegex.exec(block.join('\n'));
	return match != null ? match[1].replace(/\s+/g, '') : undefined;
}

/** Reads a length-prefixed SSH wire-format string (big-endian uint32 length + bytes) at `offset`. */
function readSshString(buffer: Buffer, offset: number): Buffer | undefined {
	if (offset + 4 > buffer.length) return undefined;

	const start = offset + 4;
	const end = start + buffer.readUInt32BE(offset);
	if (end > buffer.length) return undefined;

	return buffer.subarray(start, end);
}

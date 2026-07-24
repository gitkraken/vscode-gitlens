import type { SshPublicKey } from '@gitlens/git/models/signature.js';
import {
	isValidAllowedSignerPrincipal,
	isValidSshKeyData,
	isValidSshKeyType,
} from '@gitlens/git/utils/sshKey.utils.js';

export interface AllowedSignerEntry {
	/** The principal authorized to sign — typically the signer's email address. */
	principal: string;
	/** The SSH key type, e.g. `ssh-ed25519`. */
	keyType: string;
	/** The base64-encoded public-key blob. */
	keyData: string;
}

// An allowed_signers line is: `principals [options...] keytype keydata [comment]`.
// Key types we recognize: `ssh-ed25519`, `ssh-rsa`, `ecdsa-sha2-*`, security-key variants (`sk-*`), and `*-cert-v01@*`.
const keyTypeRegex = /^(?:sk-)?(?:ssh-|ecdsa-)/;

/** Limit signers to the `git` namespace so an entry only authorizes commit/tag verification. */
const gitNamespacesOption = 'namespaces="git"';

/** Builds a case-insensitive dedupe key for an entry, stable across an existing file and freshly discovered candidates. */
export function getAllowedSignerEntryKey(entry: AllowedSignerEntry): string {
	return `${entry.principal.toLowerCase()}\0${entry.keyType}\0${entry.keyData}`;
}

/**
 * Parses a single OpenSSH public key string (`<keytype> <keydata> [comment]`, as found in a `.pub` file or returned by
 * a provider API) into its type and data, ignoring any options prefix or trailing comment. Returns `undefined` if no
 * key type can be located.
 */
export function parsePublicKey(key: string): SshPublicKey | undefined {
	const tokens = key.trim().split(/\s+/);
	const i = tokens.findIndex(t => keyTypeRegex.test(t));
	if (i === -1 || i + 1 >= tokens.length) return undefined;

	const keyType = tokens[i];
	const keyData = tokens[i + 1];
	// Provider APIs are less likely to be hostile than commit signatures, but still validate strictly — the result
	// flows into a trust-sensitive file, and `keyTypeRegex` above only locates the token, it doesn't fully validate it.
	if (!isValidSshKeyType(keyType) || !isValidSshKeyData(keyData)) return undefined;

	return { keyType: keyType, keyData: keyData };
}

/** Parses a single allowed_signers line into its principal + key, or `undefined` for comments, blanks, and unparseable lines. */
function parseLine(line: string): AllowedSignerEntry | undefined {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith('#')) return undefined;

	const tokens = trimmed.split(/\s+/);
	const keyIndex = tokens.findIndex(t => keyTypeRegex.test(t));
	// The principal must precede the key type, and the key data must follow it.
	if (keyIndex < 1 || keyIndex + 1 >= tokens.length) return undefined;

	return { principal: tokens[0], keyType: tokens[keyIndex], keyData: tokens[keyIndex + 1] };
}

/** Returns the dedupe keys of every entry already present in an allowed_signers file's content. */
export function getExistingEntryKeys(content: string): Set<string> {
	const keys = new Set<string>();
	for (const line of content.split('\n')) {
		const entry = parseLine(line);
		if (entry != null) {
			keys.add(getAllowedSignerEntryKey(entry));
		}
	}

	return keys;
}

/**
 * Whether an entry is safe to serialize into an allowed_signers file — every field must be free of whitespace/newlines
 * and well-formed, so a hostile principal/keytype can't inject extra tokens or whole lines into this trust-sensitive
 * file. Candidates are already validated upstream (extraction/parse), so this is a defense-in-depth backstop.
 */
function isWritableEntry(entry: AllowedSignerEntry): boolean {
	return (
		isValidAllowedSignerPrincipal(entry.principal) &&
		isValidSshKeyType(entry.keyType) &&
		isValidSshKeyData(entry.keyData)
	);
}

/** Serializes a managed allowed_signers line, scoped to the `git` namespace. */
function serializeEntry(entry: AllowedSignerEntry): string {
	return `${entry.principal} ${gitNamespacesOption} ${entry.keyType} ${entry.keyData}`;
}

/**
 * Merges new signer entries into an existing allowed_signers file's content, appending only entries not already present.
 * Existing content (including comments and hand-authored lines) is preserved verbatim, and the operation is idempotent —
 * re-merging the same entries produces no further changes.
 */
export function mergeAllowedSigners(existingContent: string, entries: readonly AllowedSignerEntry[]): string {
	const seen = getExistingEntryKeys(existingContent);

	const additions: string[] = [];
	for (const entry of entries) {
		if (!isWritableEntry(entry)) continue;

		const key = getAllowedSignerEntryKey(entry);
		if (seen.has(key)) continue;

		seen.add(key);
		additions.push(serializeEntry(entry));
	}

	if (additions.length === 0) return existingContent;

	// Preserve existing content exactly, ensuring it ends with a newline before appending the new managed lines.
	const base = !existingContent || existingContent.endsWith('\n') ? existingContent : `${existingContent}\n`;
	return `${base}${additions.join('\n')}\n`;
}

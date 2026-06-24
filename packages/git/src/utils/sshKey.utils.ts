// Strict allowlist of OpenSSH public-key types valid in an `allowed_signers`/`.pub` entry, including security-key
// (`sk-`) and certificate (`-cert-v01@openssh.com`) variants. Used to reject attacker-controllable key types embedded
// in commit SSH signatures (or returned by a provider) before they're written to a trust-sensitive file.
const sshKeyTypeRegex =
	/^(?:sk-)?(?:ssh-ed25519|ssh-rsa|ssh-dss|ecdsa-sha2-nistp(?:256|384|521))(?:-cert-v01)?(?:@openssh\.com)?$/;

// A base64 blob with no embedded whitespace/newlines (length must be a multiple of 4, standard base64 alphabet).
const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;

// A principal safe to write as the first token of an `allowed_signers` line. Beyond whitespace/control characters
// (which would inject extra tokens or whole lines), it also rejects the principal-list meta-characters `,` (separator),
// `*`/`?` (wildcards), `!` (negation), and `"`/`\` (quoting) — any of which could broaden a single identity into a
// list or pattern that matches signers it shouldn't.
// eslint-disable-next-line no-control-regex
const principalRegex = /^[^\s\x00-\x1f\x7f,*?!"\\]+$/;

/** Whether `keyType` is a recognized OpenSSH public-key type (strict allowlist, not a prefix match). */
export function isValidSshKeyType(keyType: string): boolean {
	return sshKeyTypeRegex.test(keyType);
}

/** Whether `keyData` is a well-formed base64 public-key blob with no embedded whitespace or newlines. */
export function isValidSshKeyData(keyData: string): boolean {
	return keyData.length % 4 === 0 && base64Regex.test(keyData);
}

/** Whether `principal` is safe to write as an `allowed_signers` principal (non-empty, no whitespace/control chars). */
export function isValidAllowedSignerPrincipal(principal: string): boolean {
	return principalRegex.test(principal);
}

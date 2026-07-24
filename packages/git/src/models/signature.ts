export type SigningFormat = 'gpg' | 'ssh' | 'x509' | 'openpgp';

export interface SigningConfig {
	enabled: boolean;
	format: SigningFormat;
	signingKey?: string;
	gpgProgram?: string;
	sshProgram?: string;
	allowedSignersFile?: string;
}

export type SignatureStatus = 'good' | 'bad' | 'unknown' | 'expired' | 'revoked' | 'error';
export type TrustLevel = 'ultimate' | 'full' | 'marginal' | 'never' | 'unknown';

export interface CommitSignature {
	status: SignatureStatus;
	format?: SigningFormat;
	signer?: string;
	keyId?: string;
	fingerprint?: string;
	timestamp?: Date;
	errorMessage?: string;
	trustLevel?: TrustLevel;
}

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

export interface SshPublicKey {
	/** The SSH key type, e.g. `ssh-ed25519`, `ssh-rsa`, `ecdsa-sha2-nistp256`. */
	keyType: string;
	/** The base64-encoded public-key blob, as it appears after the key type in an `allowed_signers`/`.pub` entry. */
	keyData: string;
}

export interface SshSignedCommit {
	/** The signer's full SSH public key, extracted from the commit's SSH signature. */
	key: SshPublicKey;
	/** The committer's name from the commit object (the signing identity). */
	name: string | undefined;
	/** The committer's raw email from the commit object — the principal Git verifies the signature against. */
	email: string | undefined;
}

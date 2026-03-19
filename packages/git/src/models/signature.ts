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

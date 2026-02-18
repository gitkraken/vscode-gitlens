import type { CommitSignature, SignatureStatus, SigningFormat, TrustLevel } from '../models/signature.js';

const hexFingerprintRegex = /^[0-9A-Fa-f]{16,40}$/;
const hexKeyIdRegex = /^[0-9A-Fa-f]{8,16}$/;

/**
 * Git format specifiers for signature information:
 * - %G?: Signature status (G/B/U/X/Y/R/E/N)
 * - %GS: Signer name
 * - %GK: Key ID
 * - %GF: Key fingerprint
 * - %GP: Primary key fingerprint (preferred over %GF)
 * - %GT: Trust level
 * - %GG: Raw verification message
 *
 * Fields separated by ASCII 0x1D (Group Separator)
 */
export const signatureFormat = '%G?%x1D%GS%x1D%GK%x1D%GF%x1D%GP%x1D%GT%x1D%GG';

const fieldSeparator = '\x1D';

/**
 * Maps Git signature status codes to SignatureStatus enum
 * @param statusCode Git status code from %G?
 * @returns SignatureStatus or undefined for unsigned commits
 */
function mapStatusCode(statusCode: string): SignatureStatus | undefined {
	switch (statusCode) {
		case 'G': // Good signature
			return 'good';
		case 'B': // Bad signature
			return 'bad';
		case 'U': // Good signature with unknown validity
			return 'unknown';
		case 'X': // Good signature that has expired
		case 'Y': // Good signature made by expired key
			return 'expired';
		case 'R': // Good signature made by revoked key
			return 'revoked';
		case 'E': // Signature cannot be checked (e.g., missing key)
			return 'error';
		case 'N': // No signature
			return undefined;
		default:
			return undefined;
	}
}

/**
 * Infers the signing format from signature data patterns
 * @param signer Signer identity string
 * @param keyId Key ID
 * @param fingerprint Key fingerprint
 * @returns Inferred SigningFormat or undefined
 */
function inferSigningFormat(
	signer: string | undefined,
	keyId: string | undefined,
	fingerprint: string | undefined,
): SigningFormat | undefined {
	// X.509: Distinguished Name format with slashes (e.g., "/C=US/O=Org/CN=Name")
	if (signer?.startsWith('/') && signer.includes('/CN=')) {
		return 'x509';
	}

	// SSH: key ID or fingerprint starts with "SHA256:" or "SHA512:" prefix
	if (
		keyId?.startsWith('SHA256:') ||
		keyId?.startsWith('SHA512:') ||
		fingerprint?.startsWith('SHA256:') ||
		fingerprint?.startsWith('SHA512:')
	) {
		return 'ssh';
	}

	// GPG/OpenPGP: fingerprints are hex strings (typically 16-40 chars)
	// Signer format is "Name <email@example.com>"
	if (fingerprint && hexFingerprintRegex.test(fingerprint)) {
		return 'gpg';
	}

	// If signer has angle bracket email format, likely GPG
	if (signer?.includes('<') && signer?.includes('>')) {
		return 'gpg';
	}

	// If keyId looks like a hex GPG key ID (8-16 hex chars)
	if (keyId && hexKeyIdRegex.test(keyId)) {
		return 'gpg';
	}

	return undefined;
}

/**
 * Maps Git trust level string to TrustLevel enum
 * @param trustStr Git trust level from %GT
 * @returns TrustLevel
 */
function mapTrustLevel(trustStr: string | undefined): TrustLevel {
	if (!trustStr) return 'unknown';

	const normalized = trustStr.toLowerCase().trim();
	switch (normalized) {
		case 'ultimate':
			return 'ultimate';
		case 'fully':
			return 'full';
		case 'marginal':
			return 'marginal';
		case 'never':
			return 'never';
		case 'undefined':
		case 'unknown':
		case '':
			return 'unknown';
		default:
			return 'unknown';
	}
}

/**
 * Parses Git signature output from format specifiers
 * @param output Raw Git output using signatureFormat
 * @returns CommitSignature or undefined if unsigned
 */
export function parseSignatureOutput(output: string): CommitSignature | undefined {
	const trimmed = output.trim();
	if (!trimmed) return undefined;

	// Split by field separator
	const fields = trimmed.split(fieldSeparator);
	if (fields.length !== 7) return undefined;

	const [statusCode, signer, keyId, subkeyFingerprint, primaryFingerprint, trustStr, rawMessage] = fields;

	// Map status code
	const status = mapStatusCode(statusCode);
	if (status === undefined) return undefined; // Unsigned commit (N)

	// Prefer primary key fingerprint over subkey fingerprint
	const fingerprint = primaryFingerprint || subkeyFingerprint || undefined;

	// Map trust level
	const trustLevel = mapTrustLevel(trustStr);

	// Use raw message as error message for non-good signatures
	const errorMessage = status !== 'good' && rawMessage ? rawMessage.trim() : undefined;

	// Infer signing format from signature data
	const format = inferSigningFormat(signer, keyId, fingerprint);

	return {
		status: status,
		format: format,
		signer: signer || undefined,
		keyId: keyId || undefined,
		fingerprint: fingerprint,
		trustLevel: trustLevel,
		errorMessage: errorMessage,
	};
}

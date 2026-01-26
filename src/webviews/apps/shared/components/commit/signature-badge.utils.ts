import type { CommitSignatureShape } from '../../../../commitDetails/protocol.js';

export type SignatureState = 'trusted' | 'unknown' | 'untrusted';

/**
 * Extracts the email address from a signer identity string.
 * Handles formats:
 * - GPG: "Name <email@example.com>" -> "email@example.com"
 * - SSH: "email@example.com" -> "email@example.com"
 * - X.509: "/C=US/O=Org/CN=Name/EMail=email@example.com" -> "email@example.com"
 */
export function extractEmailFromSigner(signer: string | undefined): string | undefined {
	if (!signer) return undefined;

	// X.509 Distinguished Name format: extract from /EMail= field
	const x509Match = signer.match(/\/EMail=([^/]+)/i);
	if (x509Match) {
		return x509Match[1];
	}

	// GPG format: "Name <email@example.com>"
	const angleMatch = signer.match(/<([^>]+)>/);
	if (angleMatch) {
		return angleMatch[1];
	}

	// SSH format: just an email address (contains @ and no spaces)
	if (signer.includes('@') && !signer.includes(' ')) {
		return signer;
	}

	return undefined;
}

/**
 * Determines the signature state based on signature properties and committer email.
 * Returns 'trusted' only if:
 * - Signature status is 'good'
 * - Trust level is 'ultimate' or 'full'
 * - Signer email matches committer email (case-insensitive)
 */
export function getSignatureState(
	signature: CommitSignatureShape | undefined,
	committerEmail: string | undefined,
): SignatureState {
	if (signature == null) return 'unknown';

	const { status, trustLevel, signer } = signature;

	// Bad signatures are always untrusted
	if (status === 'bad') {
		return 'untrusted';
	}

	// Good status with ultimate or full trust requires email verification
	if (status === 'good' && (trustLevel === 'ultimate' || trustLevel === 'full')) {
		// Verify that the committer email matches the signer email for trusted status
		const signerEmail = extractEmailFromSigner(signer);

		if (signerEmail && committerEmail) {
			// Case-insensitive email comparison
			if (signerEmail.toLowerCase() === committerEmail.toLowerCase()) {
				return 'trusted';
			}
		}

		// Emails don't match or couldn't be verified - return unknown
		return 'unknown';
	}

	// Everything else is unknown
	return 'unknown';
}

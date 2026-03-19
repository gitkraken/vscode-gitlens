import * as assert from 'assert';
import { parseSignatureOutput } from '../signatureParser.js';

const fieldSeparator = '\x1D';

suite('Signature Parser Test Suite', () => {
	test('parses good GPG signature with ultimate trust', () => {
		// Format: %G?%x1D%GS%x1D%GK%x1D%GF%x1D%GP%x1D%GT%x1D%GG
		const output = `G${fieldSeparator}John Doe <john@example.com>${fieldSeparator}ABCD1234${fieldSeparator}1234567890ABCDEF${fieldSeparator}FEDCBA0987654321${fieldSeparator}ultimate${fieldSeparator}gpg: Good signature`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.status, 'good', 'Should have good status');
		assert.strictEqual(result?.signer, 'John Doe <john@example.com>', 'Should have correct signer');
		assert.strictEqual(result?.keyId, 'ABCD1234', 'Should have correct key ID');
		assert.strictEqual(result?.fingerprint, 'FEDCBA0987654321', 'Should prefer primary fingerprint');
		assert.strictEqual(result?.trustLevel, 'ultimate', 'Should have ultimate trust');
		assert.strictEqual(result?.errorMessage, undefined, 'Should have no error for good signature');
	});

	test('parses good GPG signature with full trust', () => {
		const output = `G${fieldSeparator}Jane Smith${fieldSeparator}5678EFGH${fieldSeparator}${fieldSeparator}ABCDEF1234567890${fieldSeparator}fully${fieldSeparator}`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.status, 'good', 'Should have good status');
		assert.strictEqual(result?.signer, 'Jane Smith', 'Should have correct signer');
		assert.strictEqual(result?.trustLevel, 'full', 'Should have full trust');
	});

	test('parses good GPG signature with marginal trust', () => {
		const output = `G${fieldSeparator}Bob Jones${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}marginal${fieldSeparator}`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.status, 'good', 'Should have good status');
		assert.strictEqual(result?.trustLevel, 'marginal', 'Should have marginal trust');
	});

	test('parses good GPG signature with never trust', () => {
		const output = `G${fieldSeparator}Eve Hacker${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}never${fieldSeparator}`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.status, 'good', 'Should have good status');
		assert.strictEqual(result?.trustLevel, 'never', 'Should have never trust');
	});

	test('parses good signature with unknown trust', () => {
		const output = `G${fieldSeparator}Unknown User${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.status, 'good', 'Should have good status');
		assert.strictEqual(result?.trustLevel, 'unknown', 'Should have unknown trust for empty trust field');
	});

	test('parses bad signature', () => {
		const output = `B${fieldSeparator}John Doe${fieldSeparator}ABCD1234${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}gpg: BAD signature from "John Doe"`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.status, 'bad', 'Should have bad status');
		assert.strictEqual(result?.signer, 'John Doe', 'Should have correct signer');
		assert.strictEqual(result?.errorMessage, 'gpg: BAD signature from "John Doe"', 'Should include error message');
	});

	test('parses unknown validity signature', () => {
		const output = `U${fieldSeparator}Unknown Signer${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}undefined${fieldSeparator}gpg: Good signature with unknown validity`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.status, 'unknown', 'Should have unknown status');
		assert.strictEqual(result?.trustLevel, 'unknown', 'Should map undefined trust to unknown');
		assert.strictEqual(
			result?.errorMessage,
			'gpg: Good signature with unknown validity',
			'Should include error message',
		);
	});

	test('parses expired signature (X)', () => {
		const output = `X${fieldSeparator}Former User${fieldSeparator}DEAD1234${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}gpg: Good signature but expired`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.status, 'expired', 'Should have expired status');
		assert.strictEqual(result?.errorMessage, 'gpg: Good signature but expired', 'Should include error message');
	});

	test('parses expired key signature (Y)', () => {
		const output = `Y${fieldSeparator}Old Key User${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}gpg: Good signature made by expired key`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.status, 'expired', 'Should have expired status for expired key');
	});

	test('parses revoked key signature', () => {
		const output = `R${fieldSeparator}Revoked User${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}gpg: Good signature made by revoked key`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.status, 'revoked', 'Should have revoked status');
		assert.strictEqual(
			result?.errorMessage,
			'gpg: Good signature made by revoked key',
			'Should include error message',
		);
	});

	test('parses error checking signature', () => {
		const output = `E${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}gpg: Cannot check signature: No public key`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.status, 'error', 'Should have error status');
		assert.strictEqual(result?.signer, undefined, 'Should have no signer for error');
		assert.strictEqual(
			result?.errorMessage,
			'gpg: Cannot check signature: No public key',
			'Should include error message',
		);
	});

	test('returns undefined for unsigned commit (N)', () => {
		const output = `N${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}`;

		const result = parseSignatureOutput(output);

		assert.strictEqual(result, undefined, 'Should return undefined for unsigned commit');
	});

	test('returns undefined for empty output', () => {
		const result = parseSignatureOutput('');

		assert.strictEqual(result, undefined, 'Should return undefined for empty output');
	});

	test('returns undefined for whitespace-only output', () => {
		const result = parseSignatureOutput('   \n\t  ');

		assert.strictEqual(result, undefined, 'Should return undefined for whitespace output');
	});

	test('returns undefined for insufficient fields', () => {
		const output = `G${fieldSeparator}John Doe${fieldSeparator}ABCD`; // Only 3 fields instead of 7

		const result = parseSignatureOutput(output);

		assert.strictEqual(result, undefined, 'Should return undefined for malformed output');
	});

	test('returns undefined for unknown status code', () => {
		const output = `Z${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}`;

		const result = parseSignatureOutput(output);

		assert.strictEqual(result, undefined, 'Should return undefined for unknown status code');
	});

	test('prefers primary fingerprint over subkey fingerprint', () => {
		const output = `G${fieldSeparator}User${fieldSeparator}${fieldSeparator}SUBKEY_FP${fieldSeparator}PRIMARY_FP${fieldSeparator}ultimate${fieldSeparator}`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.fingerprint, 'PRIMARY_FP', 'Should prefer primary fingerprint');
	});

	test('falls back to subkey fingerprint when primary is missing', () => {
		const output = `G${fieldSeparator}User${fieldSeparator}${fieldSeparator}SUBKEY_FP${fieldSeparator}${fieldSeparator}ultimate${fieldSeparator}`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.fingerprint, 'SUBKEY_FP', 'Should use subkey fingerprint when primary missing');
	});

	test('handles SSH signature format', () => {
		const output = `G${fieldSeparator}user@example.com${fieldSeparator}SHA256:abcdef123456${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}Good "git" signature`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse SSH signature');
		assert.strictEqual(result?.status, 'good', 'Should have good status');
		assert.strictEqual(result?.signer, 'user@example.com', 'Should have email as signer');
		assert.strictEqual(result?.keyId, 'SHA256:abcdef123456', 'Should have SSH key ID');
	});

	test('handles empty optional fields without error', () => {
		const output = `G${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature with minimal fields');
		assert.strictEqual(result?.status, 'good', 'Should have good status');
		assert.strictEqual(result?.signer, undefined, 'Should have no signer');
		assert.strictEqual(result?.keyId, undefined, 'Should have no key ID');
		assert.strictEqual(result?.fingerprint, undefined, 'Should have no fingerprint');
		assert.strictEqual(result?.trustLevel, 'unknown', 'Should default to unknown trust');
	});

	test('trims whitespace from raw message', () => {
		const output = `B${fieldSeparator}User${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}  \n\ngpg: BAD signature\n\n  `;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.errorMessage, 'gpg: BAD signature', 'Should trim whitespace from error message');
	});

	test('handles case-insensitive trust levels', () => {
		const output = `G${fieldSeparator}User${fieldSeparator}${fieldSeparator}${fieldSeparator}${fieldSeparator}ULTIMATE${fieldSeparator}`;

		const result = parseSignatureOutput(output);

		assert.ok(result, 'Should parse signature');
		assert.strictEqual(result?.trustLevel, 'ultimate', 'Should handle uppercase trust level');
	});
});

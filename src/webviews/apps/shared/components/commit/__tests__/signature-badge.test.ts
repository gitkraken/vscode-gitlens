import * as assert from 'assert';
import type { CommitSignatureShape } from '../../../../../commitDetails/protocol.js';
import { extractEmailFromSigner, getSignatureState } from '../signature.utils.js';

suite('GlSignatureBadge Email Extraction Test Suite', () => {
	suite('extractEmailFromSigner', () => {
		suite('GPG format extraction', () => {
			test('should extract email from GPG format "Name <email@example.com>"', () => {
				const result = extractEmailFromSigner('John Doe <john@example.com>');
				assert.strictEqual(result, 'john@example.com');
			});

			test('should handle GPG format with different name', () => {
				const result = extractEmailFromSigner('Jane Smith <jane.smith@example.org>');
				assert.strictEqual(result, 'jane.smith@example.org');
			});

			test('should extract email with special characters', () => {
				const result = extractEmailFromSigner('User Name <user+tag@example.co.uk>');
				assert.strictEqual(result, 'user+tag@example.co.uk');
			});

			test('should return undefined for GPG format with no email brackets', () => {
				const result = extractEmailFromSigner('John Doe');
				assert.strictEqual(result, undefined);
			});

			test('should return undefined for GPG format with empty brackets', () => {
				// The regex /<([^>]+)>/ requires at least one character, so <> won't match
				const result = extractEmailFromSigner('John Doe <>');
				assert.strictEqual(result, undefined);
			});
		});

		suite('SSH format extraction', () => {
			test('should extract email from SSH format (plain email)', () => {
				const result = extractEmailFromSigner('user@example.com');
				assert.strictEqual(result, 'user@example.com');
			});

			test('should handle SSH format with subdomain', () => {
				const result = extractEmailFromSigner('developer@mail.company.com');
				assert.strictEqual(result, 'developer@mail.company.com');
			});

			test('should handle SSH format with plus addressing', () => {
				const result = extractEmailFromSigner('user+tag@example.com');
				assert.strictEqual(result, 'user+tag@example.com');
			});

			test('should not extract from SSH format with spaces', () => {
				const result = extractEmailFromSigner('user @ example.com');
				assert.strictEqual(result, undefined);
			});
		});

		suite('X.509 format extraction', () => {
			test('should extract email from X.509 Distinguished Name format', () => {
				const result = extractEmailFromSigner('/C=US/O=Organization/CN=John Doe/EMail=john@example.com');
				assert.strictEqual(result, 'john@example.com');
			});

			test('should extract email from X.509 with lowercase /email=', () => {
				const result = extractEmailFromSigner('/C=US/O=Org/CN=Name/email=test@example.org');
				assert.strictEqual(result, 'test@example.org');
			});

			test('should extract email from X.509 in middle of DN', () => {
				const result = extractEmailFromSigner('/C=US/EMail=middle@example.com/O=Org/CN=Name');
				assert.strictEqual(result, 'middle@example.com');
			});

			test('should extract email from X.509 at beginning', () => {
				const result = extractEmailFromSigner('/EMail=first@example.com/C=US/O=Org/CN=Name');
				assert.strictEqual(result, 'first@example.com');
			});

			test('should handle X.509 with complex email', () => {
				const result = extractEmailFromSigner('/C=US/O=Org/EMail=user+tag@mail.example.co.uk/CN=Name');
				assert.strictEqual(result, 'user+tag@mail.example.co.uk');
			});
		});

		suite('Edge cases', () => {
			test('should return undefined for empty signer', () => {
				const result = extractEmailFromSigner('');
				assert.strictEqual(result, undefined);
			});

			test('should return undefined for undefined signer', () => {
				const result = extractEmailFromSigner(undefined);
				assert.strictEqual(result, undefined);
			});

			test('should return undefined for signer without @ symbol', () => {
				const result = extractEmailFromSigner('no-email-here');
				assert.strictEqual(result, undefined);
			});

			test('should prefer angle brackets over plain email format', () => {
				// If both formats exist, GPG format takes precedence
				const result = extractEmailFromSigner('user1@example.com <user2@example.com>');
				assert.strictEqual(result, 'user2@example.com');
			});
		});
	});

	suite('getSignatureState', () => {
		suite('No signature', () => {
			test('should return unknown when signature is undefined', () => {
				const result = getSignatureState(undefined, 'john@example.com');
				assert.strictEqual(result, 'unknown');
			});
		});

		suite('Bad signature status', () => {
			test('should return untrusted for bad signature', () => {
				const signature: CommitSignatureShape = {
					status: 'bad',
					trustLevel: 'unknown',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'untrusted');
			});

			test('should return untrusted for bad signature regardless of trust level', () => {
				const signature: CommitSignatureShape = {
					status: 'bad',
					trustLevel: 'ultimate',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'untrusted');
			});

			test('should return untrusted for bad signature even with matching emails', () => {
				const signature: CommitSignatureShape = {
					status: 'bad',
					trustLevel: 'full',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'untrusted');
			});
		});

		suite('Good signature with email verification', () => {
			test('should return trusted when emails match (ultimate trust)', () => {
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'ultimate',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'trusted');
			});

			test('should return trusted when emails match (full trust)', () => {
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'full',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'trusted');
			});

			test('should return trusted for case-insensitive email match', () => {
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'ultimate',
					signer: 'John Doe <John@Example.COM>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'trusted');
			});

			test('should return trusted for uppercase committer email', () => {
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'ultimate',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'JOHN@EXAMPLE.COM');
				assert.strictEqual(result, 'trusted');
			});

			test('should return unknown when emails do not match', () => {
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'ultimate',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'different@example.com');
				assert.strictEqual(result, 'unknown');
			});

			test('should return unknown when signer has no email', () => {
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'ultimate',
					signer: 'John Doe',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'unknown');
			});

			test('should return unknown when committer email is missing', () => {
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'ultimate',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, undefined);
				assert.strictEqual(result, 'unknown');
			});

			test('should return unknown when committer email is empty', () => {
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'ultimate',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, '');
				assert.strictEqual(result, 'unknown');
			});

			test('should return unknown when signer has empty brackets', () => {
				// Empty brackets <> don't match the regex, so no email is extracted
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'ultimate',
					signer: 'John Doe <>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'unknown');
			});
		});

		suite('Other trust levels', () => {
			test('should return unknown for marginal trust even with matching emails', () => {
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'marginal',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'unknown');
			});

			test('should return unknown for never trust', () => {
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'never',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'unknown');
			});

			test('should return unknown for unknown trust', () => {
				const signature: CommitSignatureShape = {
					status: 'good',
					trustLevel: 'unknown',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'unknown');
			});
		});

		suite('Other signature statuses', () => {
			test('should return unknown for expired signature', () => {
				const signature: CommitSignatureShape = {
					status: 'expired',
					trustLevel: 'ultimate',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'unknown');
			});

			test('should return unknown for revoked signature', () => {
				const signature: CommitSignatureShape = {
					status: 'revoked',
					trustLevel: 'ultimate',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'unknown');
			});

			test('should return unknown for error status', () => {
				const signature: CommitSignatureShape = {
					status: 'error',
					trustLevel: 'ultimate',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'unknown');
			});

			test('should return unknown for unknown status', () => {
				const signature: CommitSignatureShape = {
					status: 'unknown',
					trustLevel: 'ultimate',
					signer: 'John Doe <john@example.com>',
				};
				const result = getSignatureState(signature, 'john@example.com');
				assert.strictEqual(result, 'unknown');
			});
		});
	});
});

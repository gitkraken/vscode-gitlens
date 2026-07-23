import * as assert from 'node:assert';
import type { AllowedSignerEntry } from '../allowedSignersFile.js';
import { getExistingEntryKeys, mergeAllowedSigners, parsePublicKey } from '../allowedSignersFile.js';

const KEY_DATA = 'AAAAC3NzaC1lZDI1NTE5AAAAIF2Ql621evfTGqxBgqXCzEIgZSmONGqy1MyAzJtDFKZH';
const KEY_DATA_2 = 'AAAAC3NzaC1lZDI1NTE5AAAAILLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL';

const ada: AllowedSignerEntry = { principal: 'ada@example.com', keyType: 'ssh-ed25519', keyData: KEY_DATA };
const grace: AllowedSignerEntry = { principal: 'grace@example.com', keyType: 'ssh-ed25519', keyData: KEY_DATA_2 };

suite('allowedSignersFile', () => {
	suite('parsePublicKey', () => {
		test('parses type and data, ignoring a trailing comment', () => {
			assert.deepStrictEqual(parsePublicKey(`ssh-ed25519 ${KEY_DATA} ada@example.com`), {
				keyType: 'ssh-ed25519',
				keyData: KEY_DATA,
			});
		});

		test('returns undefined when no key type is present', () => {
			assert.strictEqual(parsePublicKey('not a key'), undefined);
		});
	});

	suite('mergeAllowedSigners', () => {
		test('appends a namespaced line to empty content', () => {
			const result = mergeAllowedSigners('', [ada]);
			assert.strictEqual(result, `ada@example.com namespaces="git" ssh-ed25519 ${KEY_DATA}\n`);
		});

		test('preserves comments and hand-authored lines', () => {
			const existing = `# my signers\ngrace@example.com ssh-ed25519 ${KEY_DATA_2}\n`;
			const result = mergeAllowedSigners(existing, [ada]);
			assert.strictEqual(
				result,
				`# my signers\ngrace@example.com ssh-ed25519 ${KEY_DATA_2}\nada@example.com namespaces="git" ssh-ed25519 ${KEY_DATA}\n`,
			);
		});

		test('does not duplicate an entry already present (even without the namespaces option)', () => {
			const existing = `ada@example.com ssh-ed25519 ${KEY_DATA}\n`;
			assert.strictEqual(mergeAllowedSigners(existing, [ada]), existing);
		});

		test('dedupes entries within the same batch', () => {
			const result = mergeAllowedSigners('', [ada, { ...ada }, grace]);
			assert.strictEqual(
				result,
				`ada@example.com namespaces="git" ssh-ed25519 ${KEY_DATA}\ngrace@example.com namespaces="git" ssh-ed25519 ${KEY_DATA_2}\n`,
			);
		});

		test('is idempotent across repeated merges', () => {
			const once = mergeAllowedSigners('', [ada, grace]);
			const twice = mergeAllowedSigners(once, [ada, grace]);
			assert.strictEqual(twice, once);
		});

		test('treats principals case-insensitively when deduping', () => {
			const existing = `ADA@EXAMPLE.COM ssh-ed25519 ${KEY_DATA}\n`;
			assert.strictEqual(mergeAllowedSigners(existing, [ada]), existing);
		});

		test('appends a missing newline before adding entries', () => {
			const result = mergeAllowedSigners(`# trailing no newline`, [ada]);
			assert.strictEqual(
				result,
				`# trailing no newline\nada@example.com namespaces="git" ssh-ed25519 ${KEY_DATA}\n`,
			);
		});
	});

	suite('getExistingEntryKeys', () => {
		test('extracts keys for parseable lines only', () => {
			const content = `# comment\n\nada@example.com namespaces="git" ssh-ed25519 ${KEY_DATA}\ngarbage line\n`;
			const keys = getExistingEntryKeys(content);
			assert.strictEqual(keys.size, 1);
			assert.ok(keys.has(`ada@example.com\0ssh-ed25519\0${KEY_DATA}`));
		});
	});

	suite('rejects unsafe entries (injection guard)', () => {
		test('skips an entry whose keyType contains a newline (would inject a line)', () => {
			const malicious: AllowedSignerEntry = {
				principal: 'attacker@example.com',
				keyType: `ssh-ed25519 ${KEY_DATA}\n* namespaces="git" ssh-ed25519`,
				keyData: KEY_DATA_2,
			};
			const result = mergeAllowedSigners('', [malicious]);
			assert.strictEqual(result, '');
			assert.ok(!result.includes('*'), 'must not write the injected wildcard principal');
		});

		test('skips an entry whose principal contains whitespace', () => {
			const malicious: AllowedSignerEntry = { principal: 'a b', keyType: 'ssh-ed25519', keyData: KEY_DATA };
			assert.strictEqual(mergeAllowedSigners('', [malicious]), '');
		});

		test('skips an entry whose principal contains a newline', () => {
			const malicious: AllowedSignerEntry = {
				principal: `ada@example.com\n* namespaces="git" ssh-ed25519 ${KEY_DATA_2}`,
				keyType: 'ssh-ed25519',
				keyData: KEY_DATA,
			};
			assert.strictEqual(mergeAllowedSigners('', [malicious]), '');
		});

		test('skips an entry whose principal broadens trust via list/wildcard meta-characters', () => {
			// Each of these is whitespace-free yet, written verbatim, would authorize the key for more than the one
			// intended identity — a comma-separated list, a `*`/`?` wildcard, or a `!` negation.
			for (const principal of [
				'ada@example.com,*',
				'ada@example.com,grace@example.com',
				'*',
				'ada@*',
				'ada?@x.com',
			]) {
				const malicious: AllowedSignerEntry = {
					principal: principal,
					keyType: 'ssh-ed25519',
					keyData: KEY_DATA,
				};
				assert.strictEqual(mergeAllowedSigners('', [malicious]), '', `expected "${principal}" to be rejected`);
			}
		});

		test('skips an entry whose keyType is not a recognized type', () => {
			const bad: AllowedSignerEntry = { principal: 'ada@example.com', keyType: 'ssh-bogus', keyData: KEY_DATA };
			assert.strictEqual(mergeAllowedSigners('', [bad]), '');
		});

		test('skips an entry whose keyData is not valid base64', () => {
			const bad: AllowedSignerEntry = {
				principal: 'ada@example.com',
				keyType: 'ssh-ed25519',
				keyData: 'not valid base64!!',
			};
			assert.strictEqual(mergeAllowedSigners('', [bad]), '');
		});

		test('writes only the valid entry when mixed with a malicious one', () => {
			const malicious: AllowedSignerEntry = {
				principal: 'attacker@example.com',
				keyType: `ssh-ed25519\n* namespaces="git" ssh-ed25519 ${KEY_DATA_2}`,
				keyData: KEY_DATA_2,
			};
			const result = mergeAllowedSigners('', [ada, malicious]);
			assert.strictEqual(result, `ada@example.com namespaces="git" ssh-ed25519 ${KEY_DATA}\n`);
		});

		test('parsePublicKey rejects an unrecognized key type', () => {
			assert.strictEqual(parsePublicKey(`ssh-bogus ${KEY_DATA}`), undefined);
		});
	});
});

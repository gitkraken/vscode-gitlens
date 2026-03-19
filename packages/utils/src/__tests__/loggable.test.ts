/* eslint-disable @gitlens/scoped-logger-usage */
import * as assert from 'assert';
import type { LogChannel, LogChannelProvider } from '../logger.js';
import { Logger } from '../logger.js';
import { getScopedLogger, maybeStartScopedLogger } from '../logger.scoped.js';

suite('maybeStartScopedLogger', () => {
	let loggedMessages: Array<{ level: string; message: string }>;

	function setupMockLogger(logLevel: LogChannel['logLevel'] = 1 /* Trace */) {
		loggedMessages = [];
		const mockChannel: LogChannel = {
			name: 'test-channel',
			logLevel: logLevel,
			trace: (message: string) => {
				loggedMessages.push({ level: 'trace', message: message });
			},
			debug: (message: string) => {
				loggedMessages.push({ level: 'debug', message: message });
			},
			info: (message: string) => {
				loggedMessages.push({ level: 'info', message: message });
			},
			warn: (message: string) => {
				loggedMessages.push({ level: 'warn', message: message });
			},
			error: (error: string | Error) => {
				loggedMessages.push({ level: 'error', message: error instanceof Error ? error.message : error });
			},
		};
		const mockProvider: LogChannelProvider = {
			name: 'test-provider',
			createChannel: () => mockChannel,
			sanitizeKeys: new Set(),
		};
		Logger.configure(mockProvider, false);
	}

	setup(() => {
		setupMockLogger();
	});

	suite('when logging is disabled', () => {
		test('should return undefined', () => {
			setupMockLogger(0 /* Off */);
			const scope = maybeStartScopedLogger('Test.method');
			assert.strictEqual(scope, undefined);
		});
	});

	suite('scope tracking only (no log option)', () => {
		test('should return a scope', () => {
			using scope = maybeStartScopedLogger('Test.method');
			assert.notStrictEqual(scope, undefined);
			assert.ok(scope!.scopeId != null);
		});

		test('should not produce any log messages', () => {
			{
				using _scope = maybeStartScopedLogger('Test.method');
			}
			assert.strictEqual(loggedMessages.length, 0);
		});

		test('should be available via getScopedLogger', () => {
			{
				using scope = maybeStartScopedLogger('Test.method');
				const current = getScopedLogger();
				assert.strictEqual(current?.scopeId, scope!.scopeId);
			}

			// After dispose, scope should be cleared
			assert.strictEqual(getScopedLogger(), undefined);
		});

		test('should support manual logging via scope methods', () => {
			{
				using scope = maybeStartScopedLogger('Test.method');
				scope?.debug('manual message');
			}
			assert.strictEqual(loggedMessages.length, 1);
			assert.strictEqual(loggedMessages[0].level, 'debug');
			assert.ok(loggedMessages[0].message.includes('manual message'));
		});
	});

	suite('auto entry + exit logging (log: true)', () => {
		test('should log entry and exit', () => {
			{
				using _scope = maybeStartScopedLogger('Test.method', true);
			}

			assert.strictEqual(loggedMessages.length, 2);
			// Entry message (empty string at debug level)
			assert.strictEqual(loggedMessages[0].level, 'debug');
			// Exit message with timing
			assert.strictEqual(loggedMessages[1].level, 'debug');
			assert.ok(loggedMessages[1].message.includes('completed'));
			assert.ok(loggedMessages[1].message.includes('ms]'));
		});

		test('should log failed exit at error level', () => {
			{
				using scope = maybeStartScopedLogger('Test.method', true);
				scope?.setFailed('something went wrong');
			}

			assert.strictEqual(loggedMessages.length, 2);
			assert.strictEqual(loggedMessages[0].level, 'debug'); // entry
			assert.strictEqual(loggedMessages[1].level, 'error'); // failed exit
			assert.ok(loggedMessages[1].message.includes('something went wrong'));
		});

		test('should include exit details in exit message', () => {
			{
				using scope = maybeStartScopedLogger('Test.method', true);
				scope?.addExitInfo('found 5 items');
			}

			const exitMsg = loggedMessages[1].message;
			assert.ok(exitMsg.includes('completed'));
			assert.ok(exitMsg.includes('found 5 items'));
		});
	});

	suite('fine-grained control (log object)', () => {
		test('should support custom message', () => {
			{
				using _scope = maybeStartScopedLogger('Test.method', { message: 'loading items' });
			}

			assert.strictEqual(loggedMessages.length, 2);
			assert.ok(loggedMessages[0].message.includes('loading items'));
		});

		test('should support onlyExit', () => {
			{
				using _scope = maybeStartScopedLogger('Test.method', { onlyExit: true });
			}

			// Only exit message, no entry
			assert.strictEqual(loggedMessages.length, 1);
			assert.ok(loggedMessages[0].message.includes('completed'));
			assert.ok(loggedMessages[0].message.includes('ms]'));
		});

		test('should support custom level', () => {
			{
				using _scope = maybeStartScopedLogger('Test.method', { level: 'info' });
			}

			assert.strictEqual(loggedMessages.length, 2);
			assert.strictEqual(loggedMessages[0].level, 'info');
			assert.strictEqual(loggedMessages[1].level, 'info');
		});

		test('should support trace level', () => {
			{
				using _scope = maybeStartScopedLogger('Test.method', { level: 'trace' });
			}

			assert.strictEqual(loggedMessages.length, 2);
			assert.strictEqual(loggedMessages[0].level, 'trace');
			assert.strictEqual(loggedMessages[1].level, 'trace');
		});

		test('should log failed exit at error level regardless of configured level', () => {
			{
				using scope = maybeStartScopedLogger('Test.method', { level: 'info' });
				scope?.setFailed('broke');
			}

			assert.strictEqual(loggedMessages[0].level, 'info'); // entry at configured level
			assert.strictEqual(loggedMessages[1].level, 'error'); // failure always at error
		});

		test('should combine onlyExit with custom level', () => {
			{
				using _scope = maybeStartScopedLogger('Test.method', { onlyExit: true, level: 'info' });
			}

			assert.strictEqual(loggedMessages.length, 1);
			assert.strictEqual(loggedMessages[0].level, 'info');
			assert.ok(loggedMessages[0].message.includes('completed'));
		});
	});

	suite('async scope tracking', () => {
		function delay(ms: number): Promise<void> {
			return new Promise(resolve => setTimeout(resolve, ms));
		}

		test('should maintain scope across await', async () => {
			async function asyncMethod() {
				using scope = maybeStartScopedLogger('Async.method');
				const scopeId = scope!.scopeId;

				assert.strictEqual(getScopedLogger()?.scopeId, scopeId);

				await delay(10);

				assert.strictEqual(getScopedLogger()?.scopeId, scopeId);
			}

			await asyncMethod();
			assert.strictEqual(getScopedLogger(), undefined);
		});

		test('should handle nested scopes correctly', async () => {
			async function outerMethod() {
				using outerScope = maybeStartScopedLogger('Outer.method');
				const outerId = outerScope!.scopeId;

				assert.strictEqual(getScopedLogger()?.scopeId, outerId);

				await delay(5);

				{
					using innerScope = maybeStartScopedLogger('Inner.method');
					const innerId = innerScope!.scopeId;

					assert.strictEqual(getScopedLogger()?.scopeId, innerId);
					assert.notStrictEqual(innerId, outerId);

					await delay(5);

					assert.strictEqual(getScopedLogger()?.scopeId, innerId);
				}

				// After inner dispose, back to outer scope
				assert.strictEqual(getScopedLogger()?.scopeId, outerId);
			}

			await outerMethod();
			assert.strictEqual(getScopedLogger(), undefined);
		});
	});
});

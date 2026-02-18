/* eslint-disable @gitlens/scoped-logger-usage */
import * as assert from 'assert';
import type { LogChannel, LogChannelProvider } from '../logger.js';
import { Logger } from '../logger.js';
import {
	createLogScope,
	getLoggableScopeBlock,
	getNewLogScope,
	getScopedLogger,
	maybeStartLoggableScope,
	runInScope,
} from '../logger.scope.js';

suite('LogScope Test Suite', () => {
	let loggedMessages: Array<{ level: string; message: string }>;

	function setupMockLogger() {
		loggedMessages = [];
		const mockChannel: LogChannel = {
			name: 'test-channel',
			logLevel: 1, // VS Code LogLevel.Trace (needed for scope.trace() to work)
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

	suite('createLogScope', () => {
		test('should create a scope with correct properties', () => {
			const scope = createLogScope(1, undefined, 'TestPrefix');

			assert.strictEqual(scope.scopeId, 1);
			assert.strictEqual(scope.prevScopeId, undefined);
			assert.strictEqual(scope.prefix, 'TestPrefix');
			assert.strictEqual(scope.getExitInfo().details, undefined);
			assert.strictEqual(scope.getExitInfo().failed, undefined);
		});

		test('should create a scope with parent scope id', () => {
			const scope = createLogScope(2, 1, 'ChildPrefix');

			assert.strictEqual(scope.scopeId, 2);
			assert.strictEqual(scope.prevScopeId, 1);
		});

		test('should have bound logger methods', () => {
			const scope = createLogScope(1, undefined, 'TestPrefix');

			assert.strictEqual(typeof scope.debug, 'function');
			assert.strictEqual(typeof scope.trace, 'function');
			assert.strictEqual(typeof scope.warn, 'function');
			assert.strictEqual(typeof scope.error, 'function');

			// Call the methods and verify they log with the scope prefix
			scope.trace('test message');
			assert.strictEqual(loggedMessages.length, 1);
			assert.ok(loggedMessages[0].message.includes('TestPrefix'));
			assert.ok(loggedMessages[0].message.includes('test message'));
		});
	});

	suite('getLoggableScopeBlock', () => {
		test('should format scope block without parent', () => {
			const block = getLoggableScopeBlock(1);
			assert.ok(block.startsWith('['));
			assert.ok(block.endsWith(']'));
			assert.ok(block.includes('1'));
		});

		test('should format scope block with parent using arrow', () => {
			const block = getLoggableScopeBlock(2, 1);
			assert.ok(block.includes('→'));
		});
	});

	suite('scope.addExitInfo', () => {
		test('should set exit details on scope with auto-prefix', () => {
			const scope = createLogScope(1, undefined, 'TestPrefix');
			scope.addExitInfo('completed');
			assert.strictEqual(scope.getExitInfo().details, ' • completed');
		});

		test('should append exit details with auto-prefix', () => {
			const scope = createLogScope(1, undefined, 'TestPrefix');
			scope.addExitInfo('step1');
			scope.addExitInfo('step2');
			assert.strictEqual(scope.getExitInfo().details, ' • step1, step2');
		});
	});

	suite('scope.setFailed', () => {
		test('should set exit failed', () => {
			const scope = createLogScope(1, undefined, 'TestPrefix');
			scope.setFailed('error occurred');
			assert.strictEqual(scope.getExitInfo().failed, 'error occurred');
		});

		test('should overwrite failed on subsequent calls', () => {
			const scope = createLogScope(1, undefined, 'TestPrefix');
			scope.setFailed('first error');
			scope.setFailed('second error');
			assert.strictEqual(scope.getExitInfo().failed, 'second error');
		});

		test('should set both details and failed independently', () => {
			const scope = createLogScope(1, undefined, 'TestPrefix');
			scope.addExitInfo('details');
			scope.setFailed('failed reason');
			assert.strictEqual(scope.getExitInfo().details, ' • details');
			assert.strictEqual(scope.getExitInfo().failed, 'failed reason');
		});
	});

	suite('runInScope and getScopedLogger', () => {
		test('should return undefined when no scope is active', () => {
			const scope = getScopedLogger();
			assert.strictEqual(scope, undefined);
		});

		test('should return scope when inside runInScope', () => {
			const testScope = createLogScope(42, undefined, 'TestScope');

			runInScope(testScope, () => {
				const currentScope = getScopedLogger();
				// getScopedLogger() returns a prototype wrapper, so check properties not reference
				assert.strictEqual(currentScope?.scopeId, testScope.scopeId);
				assert.strictEqual(currentScope?.prefix, testScope.prefix);
				assert.strictEqual(currentScope?.scopeId, 42);
			});
		});

		test('should restore previous scope after runInScope completes', () => {
			const outerScope = createLogScope(1, undefined, 'Outer');
			const innerScope = createLogScope(2, 1, 'Inner');

			runInScope(outerScope, () => {
				assert.strictEqual(getScopedLogger()?.scopeId, outerScope.scopeId);

				runInScope(innerScope, () => {
					assert.strictEqual(getScopedLogger()?.scopeId, innerScope.scopeId);
				});

				// After inner scope exits, should be back to outer
				assert.strictEqual(getScopedLogger()?.scopeId, outerScope.scopeId);
			});

			// After outer scope exits, should be undefined
			assert.strictEqual(getScopedLogger(), undefined);
		});
	});

	suite('Async Scope Tracking', () => {
		// Helper to create a delay
		function delay(ms: number): Promise<void> {
			return new Promise(resolve => setTimeout(resolve, ms));
		}

		test('should maintain scope across await', async () => {
			const testScope = createLogScope(100, undefined, 'AsyncTest');

			await runInScope(testScope, async () => {
				assert.strictEqual(getScopedLogger()?.scopeId, 100);

				await delay(10);

				// After await, scope should still be correct
				const scopeAfterAwait = getScopedLogger();
				assert.strictEqual(scopeAfterAwait?.scopeId, 100);
				assert.strictEqual(scopeAfterAwait?.prefix, testScope.prefix);
			});
		});

		test('should track correct scope with concurrent async operations', async () => {
			const scopeA = createLogScope(1, undefined, 'ScopeA');
			const scopeB = createLogScope(2, undefined, 'ScopeB');

			const capturedScopes: Array<{ phase: string; scopeId: number | undefined }> = [];

			const promiseA = runInScope(scopeA, async () => {
				capturedScopes.push({ phase: 'A-start', scopeId: getScopedLogger()?.scopeId });
				await delay(20);
				capturedScopes.push({ phase: 'A-after-await', scopeId: getScopedLogger()?.scopeId });
				await delay(20);
				capturedScopes.push({ phase: 'A-end', scopeId: getScopedLogger()?.scopeId });
			});

			// Start B while A is awaiting
			await delay(5);
			const promiseB = runInScope(scopeB, async () => {
				capturedScopes.push({ phase: 'B-start', scopeId: getScopedLogger()?.scopeId });
				await delay(10);
				capturedScopes.push({ phase: 'B-after-await', scopeId: getScopedLogger()?.scopeId });
			});

			await Promise.all([promiseA, promiseB]);

			// Verify each operation got its own scope throughout
			const aScopes = capturedScopes.filter(s => s.phase.startsWith('A-'));
			const bScopes = capturedScopes.filter(s => s.phase.startsWith('B-'));

			// All A captures should have scopeId 1
			for (const capture of aScopes) {
				assert.strictEqual(capture.scopeId, 1, `${capture.phase} should have scopeId 1`);
			}

			// All B captures should have scopeId 2
			for (const capture of bScopes) {
				assert.strictEqual(capture.scopeId, 2, `${capture.phase} should have scopeId 2`);
			}
		});

		test('should handle nested async scopes correctly', async () => {
			const outerScope = createLogScope(10, undefined, 'Outer');
			const innerScope = createLogScope(20, 10, 'Inner');

			const capturedScopes: Array<{ phase: string; scopeId: number | undefined }> = [];

			await runInScope(outerScope, async () => {
				capturedScopes.push({ phase: 'outer-start', scopeId: getScopedLogger()?.scopeId });
				await delay(5);

				await runInScope(innerScope, async () => {
					capturedScopes.push({ phase: 'inner-start', scopeId: getScopedLogger()?.scopeId });
					await delay(5);
					capturedScopes.push({ phase: 'inner-after-await', scopeId: getScopedLogger()?.scopeId });
				});

				capturedScopes.push({ phase: 'outer-after-inner', scopeId: getScopedLogger()?.scopeId });
				await delay(5);
				capturedScopes.push({ phase: 'outer-end', scopeId: getScopedLogger()?.scopeId });
			});

			// Verify scope transitions
			assert.strictEqual(capturedScopes.find(s => s.phase === 'outer-start')?.scopeId, 10);
			assert.strictEqual(capturedScopes.find(s => s.phase === 'inner-start')?.scopeId, 20);
			assert.strictEqual(capturedScopes.find(s => s.phase === 'inner-after-await')?.scopeId, 20);
			assert.strictEqual(capturedScopes.find(s => s.phase === 'outer-after-inner')?.scopeId, 10);
			assert.strictEqual(capturedScopes.find(s => s.phase === 'outer-end')?.scopeId, 10);
		});

		test('should get parent scope for nesting via getNewLogScope', () => {
			const parentScope = createLogScope(100, undefined, 'Parent');

			runInScope(parentScope, () => {
				// getNewLogScope should pick up the parent from AsyncLocalStorage
				const childScope = getNewLogScope('Child.method', true);

				assert.strictEqual(childScope.prevScopeId, 100);
			});
		});
	});

	suite('maybeStartLoggableScope with Async Tracking', () => {
		// Helper to create a delay
		function delay(ms: number): Promise<void> {
			return new Promise(resolve => setTimeout(resolve, ms));
		}

		test('should register scope and make it available via getScopedLogger', () => {
			assert.strictEqual(getScopedLogger(), undefined);

			{
				using scope = maybeStartLoggableScope('Test.method');
				assert.strictEqual(getScopedLogger()?.scopeId, scope!.scopeId);
			}

			// After dispose, scope should be cleared
			assert.strictEqual(getScopedLogger(), undefined);
		});

		test('should maintain scope across await with using keyword', async () => {
			async function asyncMethod() {
				using scope = maybeStartLoggableScope('Async.method');
				const scopeId = scope!.scopeId;

				assert.strictEqual(getScopedLogger()?.scopeId, scopeId);

				await delay(10);

				// After await, scope should still be correct
				assert.strictEqual(getScopedLogger()?.scopeId, scopeId);

				await delay(10);

				// Still correct
				assert.strictEqual(getScopedLogger()?.scopeId, scopeId);
			}

			await asyncMethod();

			// After method returns, scope should be cleared
			assert.strictEqual(getScopedLogger(), undefined);
		});

		test('should handle nested maybeStartLoggableScope correctly', async () => {
			async function outerMethod() {
				using outerScope = maybeStartLoggableScope('Outer.method');
				const outerId = outerScope!.scopeId;

				assert.strictEqual(getScopedLogger()?.scopeId, outerId);

				await delay(5);

				{
					using innerScope = maybeStartLoggableScope('Inner.method');
					const innerId = innerScope!.scopeId;

					assert.strictEqual(getScopedLogger()?.scopeId, innerId);
					assert.notStrictEqual(innerId, outerId);

					await delay(5);

					// Still inner scope after await
					assert.strictEqual(getScopedLogger()?.scopeId, innerId);
				}

				// After inner dispose, back to outer scope
				assert.strictEqual(getScopedLogger()?.scopeId, outerId);

				await delay(5);

				// Still outer scope
				assert.strictEqual(getScopedLogger()?.scopeId, outerId);
			}

			await outerMethod();
			assert.strictEqual(getScopedLogger(), undefined);
		});

		test('should track correct scope with concurrent maybeStartLoggableScope operations', async () => {
			const capturedScopes: Array<{ phase: string; scopeId: number | undefined }> = [];

			async function methodA() {
				using scope = maybeStartLoggableScope('MethodA');
				const scopeId = scope!.scopeId;
				capturedScopes.push({ phase: 'A-start', scopeId: getScopedLogger()?.scopeId });
				await delay(20);
				capturedScopes.push({ phase: 'A-after-await', scopeId: getScopedLogger()?.scopeId });
				await delay(20);
				capturedScopes.push({ phase: 'A-end', scopeId: getScopedLogger()?.scopeId });
				return scopeId;
			}

			async function methodB() {
				using scope = maybeStartLoggableScope('MethodB');
				const scopeId = scope!.scopeId;
				capturedScopes.push({ phase: 'B-start', scopeId: getScopedLogger()?.scopeId });
				await delay(10);
				capturedScopes.push({ phase: 'B-after-await', scopeId: getScopedLogger()?.scopeId });
				return scopeId;
			}

			const promiseA = methodA();

			// Start B while A is awaiting
			await delay(5);
			const promiseB = methodB();

			const [scopeIdA, scopeIdB] = await Promise.all([promiseA, promiseB]);

			// Verify each operation maintained its own scope
			const aScopes = capturedScopes.filter(s => s.phase.startsWith('A-'));
			const bScopes = capturedScopes.filter(s => s.phase.startsWith('B-'));

			for (const capture of aScopes) {
				assert.strictEqual(capture.scopeId, scopeIdA, `${capture.phase} should have scopeId ${scopeIdA}`);
			}

			for (const capture of bScopes) {
				assert.strictEqual(capture.scopeId, scopeIdB, `${capture.phase} should have scopeId ${scopeIdB}`);
			}
		});
	});
});

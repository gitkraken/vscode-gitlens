/* oxlint-disable @gitlens/scoped-logger-usage */
import * as assert from 'assert';
import * as sinon from 'sinon';
import type { LogChannel, LogChannelProvider, LoggerOptions } from '../../logger.js';
import { Logger } from '../../logger.js';
import { getScopedLogger } from '../../logger.scoped.js';
import { Stopwatch } from '../../stopwatch.js';
import { debug, info, trace } from '../log.js';

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

suite('log decorator Test Suite', () => {
	let lines: Array<{ level: string; message: string }>;

	function configure(options?: LoggerOptions, channelLevel: LogChannel['logLevel'] = 1, debugging = false): void {
		lines = [];
		const channel: LogChannel = {
			name: 'test-channel',
			logLevel: channelLevel,
			trace: (message: string) => lines.push({ level: 'trace', message: message }),
			debug: (message: string) => lines.push({ level: 'debug', message: message }),
			info: (message: string) => lines.push({ level: 'info', message: message }),
			warn: (message: string) => lines.push({ level: 'warn', message: message }),
			// Errors with an exception arrive as (String(ex), message); without one, as (message)
			error: (error: string | Error, message?: string) =>
				lines.push({ level: 'error', message: message ?? (error instanceof Error ? error.message : error) }),
		};
		const provider: LogChannelProvider = {
			name: 'test-provider',
			createChannel: () => channel,
			sanitizeKeys: new Set(),
		};
		Logger.configure(provider, debugging, options);
	}

	function messages(): string[] {
		return lines.map(l => l.message.trim());
	}

	// Strips the leading `[scopeId]` block so assertions don't depend on the id generator
	function stripped(): string[] {
		return messages().map(m =>
			m
				.replace(/^\[[\da-f\u2190-\u2193\s\u00b7\->]*\]\s*/, '')
				.replace(/\[\d+ms\]/, '[Nms]')
				.replace(/started \d+ms earlier/, 'started Nms earlier'),
		);
	}

	teardown(() => {
		// The Logger is a process-wide singleton; leave it unconfigured-for-quiet for other suites
		configure();
	});

	suite('default (no quietCallsUnder)', () => {
		setup(() => configure());

		test('logs the entry with args, then a completed exit at debug', () => {
			class Sample {
				@debug()
				run(a: number): number {
					return a;
				}
			}
			new Sample().run(1);

			assert.deepStrictEqual(stripped(), ['Sample.run(a=1)', 'Sample.run(a=1) completed [Nms]']);
			assert.deepStrictEqual(
				lines.map(l => l.level),
				['debug', 'debug'],
			);
		});

		test('a quiet method logs entry and exit as usual, with no late entry', async () => {
			class Sample {
				@debug({ quiet: true })
				async run(a: number): Promise<void> {
					await delay(1);
					Logger.info('[GIT] git status');
				}

				@debug({ quiet: true })
				cached(a: number): number {
					return a;
				}
			}
			const sample = new Sample();
			await sample.run(1);
			sample.cached(2);

			assert.deepStrictEqual(stripped(), [
				'Sample.run(a=1)',
				'[GIT] git status',
				'Sample.run(a=1) completed [Nms]',
				'Sample.cached(a=2)',
				'Sample.cached(a=2) completed [Nms]',
			]);
		});

		test('onlyExit { after } logs a fast call that called setFailed as an error', () => {
			class Sample {
				@debug({ onlyExit: { after: 100000 } })
				run(a: number): void {
					getScopedLogger()?.setFailed('nope');
					void a;
				}
			}
			new Sample().run(1);

			assert.strictEqual(lines.length, 1);
			assert.strictEqual(lines[0].level, 'error');
			assert.ok(lines[0].message.includes('Sample.run'));
			assert.ok(lines[0].message.includes('nope'));
		});

		test('onlyExit { after } drops a fast call that succeeded', () => {
			class Sample {
				@debug({ onlyExit: { after: 100000 } })
				run(a: number): number {
					return a;
				}
			}
			new Sample().run(1);

			assert.deepStrictEqual(lines, []);
		});
	});

	suite('quietCallsUnder', () => {
		setup(() => configure({ quietCallsUnder: 100000 }));

		test('fast sync and async calls with no inner output write nothing and never evaluate args', async () => {
			const argsFn = sinon.spy((a: number) => ({ a: a }));
			class Sample {
				@debug({ quiet: true, args: argsFn })
				sync(a: number): number {
					return a;
				}

				@trace({ quiet: true, args: argsFn })
				async async(a: number): Promise<number> {
					await delay(1);
					return a;
				}

				@debug({ quiet: true })
				defaultArgs(a: number): number {
					return a;
				}
			}
			const toLoggable = sinon.spy(Logger, 'toLoggable');
			try {
				const sample = new Sample();
				sample.sync(1);
				await sample.async(2);
				sample.defaultArgs(3);

				assert.deepStrictEqual(lines, []);
				assert.strictEqual(argsFn.callCount, 0);
				assert.strictEqual(toLoggable.callCount, 0);
			} finally {
				toLoggable.restore();
			}
		});

		test('a line written inside a sync call yields that line plus the exit line with args', () => {
			class Sample {
				@debug({ quiet: true })
				run(a: number): void {
					Logger.info('[GIT] git status');
				}
			}
			new Sample().run(1);

			assert.deepStrictEqual(stripped(), [
				'Sample.run(a=1) · started Nms earlier',
				'[GIT] git status',
				'Sample.run(a=1) completed [Nms]',
			]);
			assert.deepStrictEqual(
				lines.map(l => l.level),
				['debug', 'info', 'debug'],
			);
		});

		test('a line written after an await is attributed to the call', async () => {
			class Sample {
				@debug({ quiet: true })
				async run(a: number): Promise<void> {
					await delay(1);
					Logger.info('[GIT] git log');
				}
			}
			await new Sample().run(1);

			assert.deepStrictEqual(stripped(), [
				'Sample.run(a=1) · started Nms earlier',
				'[GIT] git log',
				'Sample.run(a=1) completed [Nms]',
			]);
		});

		test('a line from a nested call marks every ancestor, and a cache hit writes nothing', async () => {
			class Sample {
				cached = false;

				@debug({ quiet: true })
				async outer(a: number): Promise<void> {
					await this.inner(a);
				}

				@debug({ quiet: true })
				async inner(b: number): Promise<void> {
					await delay(1);
					if (this.cached) return;

					Logger.info('[GIT] git branch');
				}
			}
			const sample = new Sample();
			await sample.outer(1);

			assert.deepStrictEqual(stripped(), [
				'Sample.outer(a=1) · started Nms earlier',
				'Sample.inner(b=1) · started Nms earlier',
				'[GIT] git branch',
				'Sample.inner(b=1) completed [Nms]',
				'Sample.outer(a=1) completed [Nms]',
			]);

			sample.cached = true;
			lines.length = 0;
			await sample.outer(2);
			assert.deepStrictEqual(lines, []);
		});

		test('a line written by a nested call does not mark an unrelated sibling', async () => {
			class Sample {
				@debug({ quiet: true })
				async quiet(a: number): Promise<void> {
					await delay(1);
				}

				@debug({ quiet: true })
				async noisy(a: number): Promise<void> {
					await delay(1);
					Logger.info('[GIT] noisy');
				}
			}
			const sample = new Sample();
			await Promise.all([sample.quiet(1), sample.noisy(2)]);

			const out = stripped();
			assert.ok(out.includes('Sample.noisy(a=2) completed [Nms]'));
			assert.ok(out.includes('Sample.noisy(a=2) · started Nms earlier'));
			assert.ok(!out.some(m => m.startsWith('Sample.quiet')));
		});

		test('a call that takes at least N ms logs its exit with args', async () => {
			configure({ quietCallsUnder: 20 });
			class Sample {
				@debug({ quiet: true })
				async run(a: number): Promise<void> {
					await delay(60);
				}
			}
			await new Sample().run(1);

			assert.strictEqual(lines.length, 1);
			assert.strictEqual(lines[0].level, 'debug');
			assert.ok(/Sample\.run\(a=1\) completed \[\d+ms\]/.test(lines[0].message), lines[0].message);
		});

		test('a call that takes less than N ms does not log', async () => {
			configure({ quietCallsUnder: 100000 });
			class Sample {
				@debug({ quiet: true })
				async run(a: number): Promise<void> {
					await delay(30);
				}
			}
			await new Sample().run(1);

			assert.deepStrictEqual(lines, []);
		});

		test('a slow call (> warnAfter) logs at warn even when quieted', async () => {
			class Sample {
				@debug({ quiet: true, timing: { warnAfter: 5 } })
				async run(a: number): Promise<void> {
					await delay(40);
				}
			}
			await new Sample().run(1);

			assert.strictEqual(lines.length, 1);
			assert.strictEqual(lines[0].level, 'warn');
			assert.ok(lines[0].message.includes('Sample.run(a=1)'));
			assert.ok(lines[0].message.includes('(slow)'));
		});

		test('a sync throw logs an error with args', () => {
			class Sample {
				@debug({ quiet: true })
				run(a: number): void {
					throw new Error('boom');
				}
			}
			assert.throws(() => new Sample().run(1), /boom/);

			assert.strictEqual(lines.length, 1);
			assert.strictEqual(lines[0].level, 'error');
			assert.ok(lines[0].message.includes('Sample.run(a=1)'));
			assert.ok(lines[0].message.includes('failed'));
		});

		test('a rejection logs an error with args', async () => {
			class Sample {
				@trace({ quiet: true })
				async run(a: number): Promise<void> {
					await delay(1);
					throw new Error('boom');
				}
			}
			await assert.rejects(new Sample().run(1), /boom/);

			assert.strictEqual(lines.length, 1);
			assert.strictEqual(lines[0].level, 'error');
			assert.ok(lines[0].message.includes('Sample.run(a=1)'));
			assert.ok(lines[0].message.includes('failed'));
		});

		test('setFailed logs an error with args', () => {
			class Sample {
				@debug({ quiet: true })
				run(a: number): void {
					getScopedLogger()?.setFailed('bad thing');
				}
			}
			new Sample().run(1);

			assert.strictEqual(lines.length, 1);
			assert.strictEqual(lines[0].level, 'error');
			assert.ok(lines[0].message.includes('Sample.run(a=1)'));
			assert.ok(lines[0].message.includes('bad thing'));
		});

		test('an untagged @debug method logs entry and exit as usual', () => {
			class Sample {
				@debug()
				run(a: number): number {
					return a;
				}
			}
			new Sample().run(1);

			assert.deepStrictEqual(stripped(), ['Sample.run(a=1)', 'Sample.run(a=1) completed [Nms]']);
			assert.deepStrictEqual(
				lines.map(l => l.level),
				['debug', 'debug'],
			);
		});

		test('an untagged @info method logs entry and exit as usual', () => {
			class Sample {
				@info()
				run(a: number): number {
					return a;
				}
			}
			new Sample().run(1);

			assert.deepStrictEqual(stripped(), ['Sample.run(a=1)', 'Sample.run(a=1) completed [Nms]']);
			assert.deepStrictEqual(
				lines.map(l => l.level),
				['info', 'info'],
			);
		});

		test('a quiet @info method is quieted too', () => {
			class Sample {
				@info({ quiet: true })
				run(a: number): number {
					return a;
				}
			}
			new Sample().run(1);

			assert.deepStrictEqual(lines, []);
		});

		test('an untagged child inside a quiet parent triggers the parent late entry first', () => {
			class Child {
				@debug()
				inner(b: number): void {}
			}
			class Parent {
				@debug({ quiet: true })
				outer(a: number): void {
					new Child().inner(1);
				}
			}
			new Parent().outer(1);

			assert.deepStrictEqual(stripped(), [
				'Parent.outer(a=1) · started Nms earlier',
				'Child.inner(b=1)',
				'Child.inner(b=1) completed [Nms]',
				'Parent.outer(a=1) completed [Nms]',
			]);
		});

		test('a quiet call that only crosses the threshold writes just its exit line', async () => {
			configure({ quietCallsUnder: 20 });
			class Sample {
				@debug({ quiet: true })
				async run(a: number): Promise<void> {
					await delay(60);
				}
			}
			await new Sample().run(1);

			assert.deepStrictEqual(stripped(), ['Sample.run(a=1) completed [Nms]']);
		});

		test('a quiet child that crosses the threshold inside a quiet parent writes the parent late entry, then both exits', async () => {
			configure({ quietCallsUnder: 20 });
			class Child {
				@debug({ quiet: true })
				async inner(b: number): Promise<void> {
					await delay(60);
				}
			}
			class Parent {
				@debug({ quiet: true })
				async outer(a: number): Promise<void> {
					await new Child().inner(1);
				}
			}
			await new Parent().outer(1);

			assert.deepStrictEqual(stripped(), [
				'Parent.outer(a=1) · started Nms earlier',
				'Child.inner(b=1) completed [Nms]',
				'Parent.outer(a=1) completed [Nms]',
			]);
		});

		test('a line written after the quiet call returned writes no entry line for it', async () => {
			class Sample {
				@debug({ quiet: true })
				run(a: number): void {
					setTimeout(() => Logger.info('[GIT] late'), 5);
				}
			}
			new Sample().run(1);
			await delay(30);

			assert.deepStrictEqual(stripped(), ['[GIT] late']);
		});

		test('the late entry reports the real elapsed time', async () => {
			class Sample {
				@debug({ quiet: true })
				async run(a: number): Promise<void> {
					await delay(40);
					Logger.info('[GIT] git log');
				}
			}
			await new Sample().run(1);

			const match = /started (\d+)ms earlier/.exec(lines[0].message);
			assert.ok(match != null, lines[0].message);
			assert.ok(Number(match[1]) >= 30, lines[0].message);
		});

		test('quiet with onlyExit { after } still drops a fast call but keeps one that logged inside', () => {
			configure({ quietCallsUnder: 0 });
			class Sample {
				@debug({ quiet: true, onlyExit: { after: 100000 } })
				quiet(a: number): void {}

				@debug({ quiet: true, onlyExit: { after: 100000 } })
				noisy(a: number): void {
					Logger.info('[GIT] x');
				}
			}
			const sample = new Sample();
			sample.quiet(1);
			assert.deepStrictEqual(lines, []);

			sample.noisy(2);
			assert.deepStrictEqual(stripped(), [
				'Sample.noisy(a=2) · started Nms earlier',
				'[GIT] x',
				'Sample.noisy(a=2) completed [Nms]',
			]);
		});

		test('onlyExit { after } with a call over the threshold logs', async () => {
			configure({ quietCallsUnder: 0 });
			class Sample {
				@debug({ onlyExit: { after: 10 } })
				async run(a: number): Promise<void> {
					await delay(50);
				}
			}
			await new Sample().run(1);

			assert.strictEqual(lines.length, 1);
			assert.ok(lines[0].message.includes('Sample.run(a=1) completed'));
		});

		test('a line written through a detached scope still marks the running call', () => {
			class Sample {
				@debug({ quiet: true })
				run(a: number): void {
					const sw = new Stopwatch('Git.parse', { log: { onlyExit: true } });
					sw.stop();
				}
			}
			new Sample().run(1);

			const out = stripped();
			assert.strictEqual(out.length, 3, out.join('\n'));
			assert.strictEqual(out[0], 'Sample.run(a=1) · started Nms earlier');
			assert.ok(out[1].includes('Git.parse'));
			assert.strictEqual(out[2], 'Sample.run(a=1) completed [Nms]');
		});

		test('a custom prefix is built from the state before the call ran', () => {
			class Sample {
				paused = false;

				@debug({
					quiet: true,
					args: false,
					prefix: context => `${context.prefix}(paused=${context.instance.paused})`,
				})
				pause(): void {
					this.paused = true;
					Logger.info('[GIT] x');
				}
			}
			new Sample().pause();

			assert.deepStrictEqual(stripped(), [
				'Sample.pause(paused=false) · started Nms earlier',
				'[GIT] x',
				'Sample.pause(paused=false) completed [Nms]',
			]);
		});

		test('a line only the debugger console shows does not mark a quiet call', () => {
			const consoleDebug = sinon.stub(console, 'debug');
			try {
				configure({ quietCallsUnder: 100000 }, 2 /* Debug */, true);
				class Sample {
					@debug({ quiet: true })
					run(a: number): void {
						Logger.trace('[GIT] awaiting existing call...');
					}
				}
				new Sample().run(1);

				// The mock channel records the trace line a real channel at debug would drop, but the call writes nothing
				assert.deepStrictEqual(stripped(), ['[GIT] awaiting existing call...']);
			} finally {
				consoleDebug.restore();
			}
		});

		test("an untagged child's console-only exit does not mark its quiet parent", () => {
			const consoleDebug = sinon.stub(console, 'debug');
			try {
				configure({ quietCallsUnder: 100000 }, 2 /* Debug */, true);
				class Sample {
					@debug({ quiet: true })
					outer(a: number): void {
						this.inner(a);
					}

					@trace()
					inner(b: number): number {
						return b;
					}
				}
				new Sample().outer(1);

				// The mock channel records the trace lines a real channel at debug would drop, but the parent writes nothing
				assert.deepStrictEqual(stripped(), ['Sample.inner(b=1)', 'Sample.inner(b=1) completed [Nms]']);
			} finally {
				consoleDebug.restore();
			}
		});

		test("a quiet child writing through its parent's scope keeps the late entries outermost first", () => {
			class Sample {
				@debug({ quiet: true })
				outer(a: number): void {
					const parent = getScopedLogger();
					this.inner(a, parent);
				}

				@debug({ quiet: true, args: b => ({ b: b }) })
				inner(b: number, parent: ReturnType<typeof getScopedLogger>): void {
					parent?.info('[GIT] x');
				}
			}
			new Sample().outer(1);

			assert.deepStrictEqual(stripped().slice(0, 2), [
				'Sample.outer(a=1) · started Nms earlier',
				'Sample.inner(b=1) · started Nms earlier',
			]);
		});

		test('a fast quiet call with an exit formatter that called setFailed still logs', () => {
			class Sample {
				@debug({ quiet: true, exit: true })
				run(a: number): number {
					getScopedLogger()?.setFailed('bad thing');
					return a;
				}
			}
			new Sample().run(1);

			assert.deepStrictEqual(stripped(), ['Sample.run(a=1) returned 1 [Nms]']);
		});

		test('when: false skips everything, even a failing call', () => {
			const argsFn = sinon.spy((a: number) => ({ a: a }));
			class Sample {
				@debug({
					args: argsFn,
					when: function (this: Sample, a: number) {
						return a > 5;
					},
				})
				run(a: number): void {
					getScopedLogger()?.setFailed('ignored');
				}
			}
			new Sample().run(1);

			assert.deepStrictEqual(lines, []);
			assert.strictEqual(argsFn.callCount, 0);
		});
	});
});

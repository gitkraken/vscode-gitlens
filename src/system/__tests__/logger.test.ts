import * as assert from 'assert';
import type { LogChannel, LogChannelProvider } from '../logger.js';
import { Logger } from '../logger.js';

// VS Code LogLevel enum values
const VSCodeLogLevel = {
	Off: 0,
	Trace: 1,
	Debug: 2,
	Info: 3,
	Warning: 4,
	Error: 5,
} as const;

suite('Logger Test Suite', () => {
	let mockChannel: LogChannel;
	let mockProvider: LogChannelProvider;
	let loggedMessages: Array<{ level: string; message: string; args?: any[] }>;

	function createMockChannel(vsCodeLogLevel: number): LogChannel {
		return {
			name: 'test-channel',
			logLevel: vsCodeLogLevel,
			trace: (message: string, ...args: any[]) => {
				loggedMessages.push({ level: 'trace', message: message, args: args });
			},
			debug: (message: string, ...args: any[]) => {
				loggedMessages.push({ level: 'debug', message: message, args: args });
			},
			info: (message: string, ...args: any[]) => {
				loggedMessages.push({ level: 'info', message: message, args: args });
			},
			warn: (message: string, ...args: any[]) => {
				loggedMessages.push({ level: 'warn', message: message, args: args });
			},
			error: (error: string | Error, ...args: any[]) => {
				loggedMessages.push({
					level: 'error',
					message: error instanceof Error ? error.message : error,
					args: args,
				});
			},
		};
	}

	function setupMockLogger(vsCodeLogLevel: number = VSCodeLogLevel.Trace) {
		loggedMessages = [];
		mockChannel = createMockChannel(vsCodeLogLevel);
		mockProvider = {
			name: 'test-provider',
			createChannel: () => mockChannel,
			sanitizeKeys: new Set(['password', 'token']),
		};
	}

	// Reset logger state before each test
	setup(() => {
		setupMockLogger(VSCodeLogLevel.Off);
		Logger.configure(mockProvider, false);
	});

	test('should support trace level logging', () => {
		setupMockLogger(VSCodeLogLevel.Trace);
		Logger.configure(mockProvider, false);

		Logger.trace('test trace message');

		assert.strictEqual(loggedMessages.length, 1);
		assert.strictEqual(loggedMessages[0].level, 'trace');
		assert.strictEqual(loggedMessages[0].message, '  test trace message');
	});

	test('should use VS Code native logging methods', () => {
		setupMockLogger(VSCodeLogLevel.Trace);
		Logger.configure(mockProvider, false);

		Logger.trace('trace message');
		Logger.debug('debug message');
		Logger.info('info message');
		Logger.warn('warn message');
		Logger.error(new Error('test error'));

		assert.strictEqual(loggedMessages.length, 5);
		assert.strictEqual(loggedMessages[0].level, 'trace');
		assert.strictEqual(loggedMessages[1].level, 'debug');
		assert.strictEqual(loggedMessages[2].level, 'info');
		assert.strictEqual(loggedMessages[3].level, 'warn');
		assert.strictEqual(loggedMessages[4].level, 'error');
	});

	test('should respect log levels', () => {
		setupMockLogger(VSCodeLogLevel.Warning);
		Logger.configure(mockProvider, false);

		Logger.trace('trace message');
		Logger.trace('debug message');
		Logger.debug('info message');
		Logger.warn('warn message');
		Logger.error(new Error('error message'));

		// Only warn and error should be logged
		assert.strictEqual(loggedMessages.length, 2);
		assert.strictEqual(loggedMessages[0].level, 'warn');
		assert.strictEqual(loggedMessages[1].level, 'error');
	});

	test('should enable all levels when debugging', () => {
		setupMockLogger(VSCodeLogLevel.Off);
		Logger.configure(mockProvider, true); // debugging = true

		Logger.trace('trace message');
		Logger.debug('debug message');
		Logger.info('info message');
		Logger.warn('warn message');
		Logger.error(new Error('error message'));

		// When debugging, level checks are bypassed so messages go to both console AND output channel
		assert.strictEqual(loggedMessages.length, 5);
		assert.strictEqual(loggedMessages[0].level, 'trace');
		assert.strictEqual(loggedMessages[1].level, 'debug');
		assert.strictEqual(loggedMessages[2].level, 'info');
		assert.strictEqual(loggedMessages[3].level, 'warn');
		assert.strictEqual(loggedMessages[4].level, 'error');
	});

	test('should check if level is enabled', () => {
		setupMockLogger(VSCodeLogLevel.Info);
		Logger.configure(mockProvider, false);

		assert.strictEqual(Logger.enabled('trace'), false);
		assert.strictEqual(Logger.enabled('trace'), false);
		assert.strictEqual(Logger.enabled('info'), true);
		assert.strictEqual(Logger.enabled('warn'), true);
		assert.strictEqual(Logger.enabled('error'), true);
	});

	test('should return correct logLevel string', () => {
		setupMockLogger(VSCodeLogLevel.Debug);
		Logger.configure(mockProvider, false);

		assert.strictEqual(Logger.logLevel, 'debug');
	});
});

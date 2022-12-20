import type { ExtensionContext, OutputChannel } from 'vscode';
import { ExtensionMode, Uri, window } from 'vscode';
import { OutputLevel } from './configuration';

const emptyStr = '';
const outputChannelName = 'GitLens';
const consolePrefix = '[GitLens]';

const gitOutputChannelName = 'GitLens (Git)';
const gitConsolePrefix = '[GitLens (Git)]';

export const enum LogLevel {
	Off = 'off',
	Error = 'error',
	Warn = 'warn',
	Info = 'info',
	Debug = 'debug',
}

export interface LogScope {
	readonly scopeId?: number;
	readonly prefix: string;
	exitDetails?: string;
}

const enum OrderedLevel {
	Off = 0,
	Error = 1,
	Warn = 2,
	Info = 3,
	Debug = 4,
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class Logger {
	static readonly slowCallWarningThreshold = 500;

	private static output: OutputChannel | undefined;
	private static customLoggableFn: ((o: object) => string | undefined) | undefined;

	static configure(context: ExtensionContext, outputLevel: OutputLevel, loggableFn?: (o: any) => string | undefined) {
		this._isDebugging = context.extensionMode === ExtensionMode.Development;
		this.logLevel = outputLevel;
		this.customLoggableFn = loggableFn;
	}

	static enabled(level: LogLevel): boolean {
		return this.level >= toOrderedLevel(level);
	}

	private static _isDebugging: boolean;
	static get isDebugging() {
		return this._isDebugging;
	}

	private static level: OrderedLevel = OrderedLevel.Off;
	private static _logLevel: LogLevel = LogLevel.Off;
	static get logLevel(): LogLevel {
		return this._logLevel;
	}
	static set logLevel(value: LogLevel | OutputLevel) {
		this._logLevel = fromOutputLevel(value);
		this.level = toOrderedLevel(this._logLevel);

		if (value === LogLevel.Off) {
			this.output?.dispose();
			this.output = undefined;
		} else {
			this.output = this.output ?? window.createOutputChannel(outputChannelName);
		}
	}

	static debug(message: string, ...params: any[]): void;
	static debug(scope: LogScope | undefined, message: string, ...params: any[]): void;
	static debug(scopeOrMessage: LogScope | string | undefined, ...params: any[]): void {
		if (this.level < OrderedLevel.Debug && !this.isDebugging) return;

		let message;
		if (typeof scopeOrMessage === 'string') {
			message = scopeOrMessage;
		} else {
			message = params.shift();

			if (scopeOrMessage != null) {
				message = `${scopeOrMessage.prefix} ${message ?? emptyStr}`;
			}
		}

		if (this.isDebugging) {
			console.log(this.timestamp, consolePrefix, message ?? emptyStr, ...params);
		}

		if (this.output == null || this.level < OrderedLevel.Debug) return;
		this.output.appendLine(`${this.timestamp} ${message ?? emptyStr}${this.toLoggableParams(true, params)}`);
	}

	static error(ex: Error | unknown, message?: string, ...params: any[]): void;
	static error(ex: Error | unknown, scope?: LogScope, message?: string, ...params: any[]): void;
	static error(ex: Error | unknown, scopeOrMessage: LogScope | string | undefined, ...params: any[]): void {
		if (this.level < OrderedLevel.Error && !this.isDebugging) return;

		let message;
		if (scopeOrMessage == null || typeof scopeOrMessage === 'string') {
			message = scopeOrMessage;
		} else {
			message = `${scopeOrMessage.prefix} ${params.shift() ?? emptyStr}`;
		}

		if (message == null) {
			const stack = ex instanceof Error ? ex.stack : undefined;
			if (stack) {
				const match = /.*\s*?at\s(.+?)\s/.exec(stack);
				if (match != null) {
					message = match[1];
				}
			}
		}

		if (this.isDebugging) {
			console.error(this.timestamp, consolePrefix, message ?? emptyStr, ...params, ex);
		}

		if (this.output == null || this.level < OrderedLevel.Error) return;
		this.output.appendLine(
			`${this.timestamp} ${message ?? emptyStr}${this.toLoggableParams(false, params)}\n${String(ex)}`,
		);
	}

	static log(message: string, ...params: any[]): void;
	static log(scope: LogScope | undefined, message: string, ...params: any[]): void;
	static log(scopeOrMessage: LogScope | string | undefined, ...params: any[]): void {
		if (this.level < OrderedLevel.Info && !this.isDebugging) return;

		let message;
		if (typeof scopeOrMessage === 'string') {
			message = scopeOrMessage;
		} else {
			message = params.shift();

			if (scopeOrMessage != null) {
				message = `${scopeOrMessage.prefix} ${message ?? emptyStr}`;
			}
		}

		if (this.isDebugging) {
			console.log(this.timestamp, consolePrefix, message ?? emptyStr, ...params);
		}

		if (this.output == null || this.level < OrderedLevel.Info) return;
		this.output.appendLine(`${this.timestamp} ${message ?? emptyStr}${this.toLoggableParams(false, params)}`);
	}

	static warn(message: string, ...params: any[]): void;
	static warn(scope: LogScope | undefined, message: string, ...params: any[]): void;
	static warn(scopeOrMessage: LogScope | string | undefined, ...params: any[]): void {
		if (this.level < OrderedLevel.Warn && !this.isDebugging) return;

		let message;
		if (typeof scopeOrMessage === 'string') {
			message = scopeOrMessage;
		} else {
			message = params.shift();

			if (scopeOrMessage != null) {
				message = `${scopeOrMessage.prefix} ${message ?? emptyStr}`;
			}
		}

		if (this.isDebugging) {
			console.warn(this.timestamp, consolePrefix, message ?? emptyStr, ...params);
		}

		if (this.output == null || this.level < OrderedLevel.Warn) return;
		this.output.appendLine(`${this.timestamp} ${message ?? emptyStr}${this.toLoggableParams(false, params)}`);
	}

	static showOutputChannel(): void {
		this.output?.show();
	}

	static toLoggable(p: any, sanitize?: ((key: string, value: any) => any) | undefined) {
		if (typeof p !== 'object') return String(p);
		if (this.customLoggableFn != null) {
			const loggable = this.customLoggableFn(p);
			if (loggable != null) return loggable;
		}
		if (p instanceof Uri) return `Uri(${p.toString(true)})`;

		try {
			return JSON.stringify(p, sanitize);
		} catch {
			return '<error>';
		}
	}

	private static get timestamp(): string {
		return `[${new Date().toISOString().replace(/T/, ' ').slice(0, -1)}]`;
	}

	private static toLoggableParams(debugOnly: boolean, params: any[]) {
		if (params.length === 0 || (debugOnly && this.level < OrderedLevel.Debug && !this.isDebugging)) {
			return emptyStr;
		}

		const loggableParams = params.map(p => this.toLoggable(p)).join(', ');
		return loggableParams.length !== 0 ? ` \u2014 ${loggableParams}` : emptyStr;
	}

	static gitOutput: OutputChannel | undefined;

	static logGitCommand(command: string, duration: number, ex?: Error): void {
		if (this.level < OrderedLevel.Debug && !this.isDebugging) return;

		const slow = duration > Logger.slowCallWarningThreshold;

		if (this.isDebugging) {
			if (ex != null) {
				console.error(this.timestamp, gitConsolePrefix, command ?? emptyStr, ex);
			} else if (slow) {
				console.warn(this.timestamp, gitConsolePrefix, command ?? emptyStr);
			} else {
				console.log(this.timestamp, gitConsolePrefix, command ?? emptyStr);
			}
		}

		if (this.gitOutput == null) {
			this.gitOutput = window.createOutputChannel(gitOutputChannelName);
		}
		this.gitOutput.appendLine(
			`${this.timestamp} [${slow ? '*' : ' '}${duration.toString().padStart(6)}ms] ${command}${
				ex != null ? `\n\n${ex.toString()}` : emptyStr
			}`,
		);
	}
}

function fromOutputLevel(level: LogLevel | OutputLevel): LogLevel {
	switch (level) {
		case OutputLevel.Silent:
			return LogLevel.Off;
		case OutputLevel.Errors:
			return LogLevel.Error;
		case OutputLevel.Verbose:
			return LogLevel.Info;
		case OutputLevel.Debug:
			return LogLevel.Debug;
		default:
			return level;
	}
}

function toOrderedLevel(logLevel: LogLevel): OrderedLevel {
	switch (logLevel) {
		case LogLevel.Off:
			return OrderedLevel.Off;
		case LogLevel.Error:
			return OrderedLevel.Error;
		case LogLevel.Warn:
			return OrderedLevel.Warn;
		case LogLevel.Info:
			return OrderedLevel.Info;
		case LogLevel.Debug:
			return OrderedLevel.Debug;
		default:
			return OrderedLevel.Off;
	}
}

export function getLoggableName(instance: Function | object) {
	let name: string;
	if (typeof instance === 'function') {
		if (instance.prototype?.constructor == null) return instance.name;

		name = instance.prototype.constructor.name ?? emptyStr;
	} else {
		name = instance.constructor?.name ?? emptyStr;
	}

	// Strip webpack module name (since I never name classes with an _)
	const index = name.indexOf('_');
	return index === -1 ? name : name.substr(index + 1);
}

'use strict';
import { ExtensionContext, OutputChannel, Uri, window } from 'vscode';
import { extensionOutputChannelName } from './constants';
import { getCorrelationContext } from './system';
// import { Telemetry } from './telemetry';

const emptyStr = '';

export enum TraceLevel {
	Silent = 'silent',
	Errors = 'errors',
	Verbose = 'verbose',
	Debug = 'debug'
}

const ConsolePrefix = `[${extensionOutputChannelName}]`;

const isDebuggingRegex = /\bgitlens\b/i;

export interface LogCorrelationContext {
	readonly correlationId?: number;
	readonly prefix: string;
	exitDetails?: string;
}

export class Logger {
	static output: OutputChannel | undefined;
	static customLoggableFn: ((o: object) => string | undefined) | undefined;

	static configure(context: ExtensionContext, level: TraceLevel, loggableFn?: (o: any) => string | undefined) {
		this.customLoggableFn = loggableFn;

		this.level = level;
	}

	private static _level: TraceLevel = TraceLevel.Silent;
	static get level() {
		return this._level;
	}
	static set level(value: TraceLevel) {
		this._level = value;
		if (value === TraceLevel.Silent) {
			if (this.output !== undefined) {
				this.output.dispose();
				this.output = undefined;
			}
		} else {
			this.output = this.output || window.createOutputChannel(extensionOutputChannelName);
		}
	}

	static debug(message: string, ...params: any[]): void;
	static debug(context: LogCorrelationContext | undefined, message: string, ...params: any[]): void;
	static debug(contextOrMessage: LogCorrelationContext | string | undefined, ...params: any[]): void {
		if (this.level !== TraceLevel.Debug && !Logger.isDebugging) return;

		let message;
		if (typeof contextOrMessage === 'string') {
			message = contextOrMessage;
		} else {
			message = params.shift();

			if (contextOrMessage !== undefined) {
				message = `${contextOrMessage.prefix} ${message || emptyStr}`;
			}
		}

		if (Logger.isDebugging) {
			console.log(this.timestamp, ConsolePrefix, message || emptyStr, ...params);
		}

		if (this.output !== undefined && this.level === TraceLevel.Debug) {
			this.output.appendLine(`${this.timestamp} ${message || emptyStr}${this.toLoggableParams(true, params)}`);
		}
	}

	static error(ex: Error, message?: string, ...params: any[]): void;
	static error(ex: Error, context?: LogCorrelationContext, message?: string, ...params: any[]): void;
	static error(ex: Error, contextOrMessage: LogCorrelationContext | string | undefined, ...params: any[]): void {
		if (this.level === TraceLevel.Silent && !Logger.isDebugging) return;

		let message;
		if (contextOrMessage === undefined || typeof contextOrMessage === 'string') {
			message = contextOrMessage;
		} else {
			message = `${contextOrMessage.prefix} ${params.shift() || emptyStr}`;
		}

		if (message === undefined) {
			const stack = ex.stack;
			if (stack) {
				const match = /.*\s*?at\s(.+?)\s/.exec(stack);
				if (match != null) {
					message = match[1];
				}
			}
		}

		if (Logger.isDebugging) {
			console.error(this.timestamp, ConsolePrefix, message || emptyStr, ...params, ex);
		}

		if (this.output !== undefined && this.level !== TraceLevel.Silent) {
			this.output.appendLine(
				`${this.timestamp} ${message || emptyStr}${this.toLoggableParams(false, params)}\n${ex}`
			);
		}

		// Telemetry.trackException(ex);
	}

	static getCorrelationContext() {
		return getCorrelationContext();
	}

	static log(message: string, ...params: any[]): void;
	static log(context: LogCorrelationContext | undefined, message: string, ...params: any[]): void;
	static log(contextOrMessage: LogCorrelationContext | string | undefined, ...params: any[]): void {
		if (this.level !== TraceLevel.Verbose && this.level !== TraceLevel.Debug && !Logger.isDebugging) {
			return;
		}

		let message;
		if (typeof contextOrMessage === 'string') {
			message = contextOrMessage;
		} else {
			message = params.shift();

			if (contextOrMessage !== undefined) {
				message = `${contextOrMessage.prefix} ${message || emptyStr}`;
			}
		}

		if (Logger.isDebugging) {
			console.log(this.timestamp, ConsolePrefix, message || emptyStr, ...params);
		}

		if (this.output !== undefined && (this.level === TraceLevel.Verbose || this.level === TraceLevel.Debug)) {
			this.output.appendLine(`${this.timestamp} ${message || emptyStr}${this.toLoggableParams(false, params)}`);
		}
	}

	static logWithDebugParams(message: string, ...params: any[]): void;
	static logWithDebugParams(context: LogCorrelationContext | undefined, message: string, ...params: any[]): void;
	static logWithDebugParams(contextOrMessage: LogCorrelationContext | string | undefined, ...params: any[]): void {
		if (this.level !== TraceLevel.Verbose && this.level !== TraceLevel.Debug && !Logger.isDebugging) {
			return;
		}

		let message;
		if (typeof contextOrMessage === 'string') {
			message = contextOrMessage;
		} else {
			message = params.shift();

			if (contextOrMessage !== undefined) {
				message = `${contextOrMessage.prefix} ${message || emptyStr}`;
			}
		}

		if (Logger.isDebugging) {
			console.log(this.timestamp, ConsolePrefix, message || emptyStr, ...params);
		}

		if (this.output !== undefined && (this.level === TraceLevel.Verbose || this.level === TraceLevel.Debug)) {
			this.output.appendLine(`${this.timestamp} ${message || emptyStr}${this.toLoggableParams(true, params)}`);
		}
	}

	static warn(message: string, ...params: any[]): void;
	static warn(context: LogCorrelationContext | undefined, message: string, ...params: any[]): void;
	static warn(contextOrMessage: LogCorrelationContext | string | undefined, ...params: any[]): void {
		if (this.level === TraceLevel.Silent && !Logger.isDebugging) return;

		let message;
		if (typeof contextOrMessage === 'string') {
			message = contextOrMessage;
		} else {
			message = params.shift();

			if (contextOrMessage !== undefined) {
				message = `${contextOrMessage.prefix} ${message || emptyStr}`;
			}
		}

		if (Logger.isDebugging) {
			console.warn(this.timestamp, ConsolePrefix, message || emptyStr, ...params);
		}

		if (this.output !== undefined && this.level !== TraceLevel.Silent) {
			this.output.appendLine(`${this.timestamp} ${message || emptyStr}${this.toLoggableParams(false, params)}`);
		}
	}

	static showOutputChannel() {
		if (this.output === undefined) return;

		this.output.show();
	}

	static toLoggable(p: any, sanitize?: ((key: string, value: any) => any) | undefined) {
		if (typeof p !== 'object') return String(p);
		if (this.customLoggableFn !== undefined) {
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

	static toLoggableName(instance: Function | object) {
		let name;
		if (typeof instance === 'function') {
			if (instance.prototype == null || instance.prototype.constructor == null) {
				return instance.name;
			}

			name = instance.prototype.constructor.name;
		} else {
			name = instance.constructor != null ? instance.constructor.name : emptyStr;
		}

		// Strip webpack module name (since I never name classes with an _)
		const index = name.indexOf('_');
		return index === -1 ? name : name.substr(index + 1);
	}

	private static get timestamp(): string {
		const now = new Date();
		return `[${now
			.toISOString()
			.replace(/T/, ' ')
			.replace(/\..+/, emptyStr)}:${`00${now.getUTCMilliseconds()}`.slice(-3)}]`;
	}

	private static toLoggableParams(debugOnly: boolean, params: any[]) {
		if (params.length === 0 || (debugOnly && this.level !== TraceLevel.Debug && !Logger.isDebugging)) {
			return emptyStr;
		}

		const loggableParams = params.map(p => this.toLoggable(p)).join(', ');
		return loggableParams.length !== 0 ? ` \u2014 ${loggableParams}` : emptyStr;
	}

	private static _isDebugging: boolean | undefined;
	static get isDebugging() {
		if (this._isDebugging === undefined) {
			const env = process.env;
			this._isDebugging =
				env && env.VSCODE_DEBUGGING_EXTENSION ? isDebuggingRegex.test(env.VSCODE_DEBUGGING_EXTENSION) : false;
		}

		return this._isDebugging;
	}

	static gitOutput: OutputChannel | undefined;

	static logGitCommand(command: string, ex?: Error): void {
		if (this.level !== TraceLevel.Debug) return;

		if (this.gitOutput === undefined) {
			this.gitOutput = window.createOutputChannel(`${extensionOutputChannelName} (Git)`);
		}
		this.gitOutput.appendLine(`${this.timestamp} ${command}${ex != null ? `\n\n${ex.toString()}` : emptyStr}`);
	}
}

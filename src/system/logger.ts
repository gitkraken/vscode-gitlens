import { LogInstanceNameFn } from './decorators/log';
import type { LogLevel } from './logger.constants';
import type { LogScope } from './logger.scope';
import { padOrTruncateEnd } from './string';

const enum OrderedLevel {
	Off = 0,
	Error = 1,
	Warn = 2,
	Info = 3,
	Debug = 4,
}

export interface LogChannelProvider {
	readonly name: string;
	createChannel(name: string): LogChannel;
	toLoggable?(o: unknown): string | undefined;
	sanitize?: (key: string, value: any) => any;
}

export interface LogChannel {
	readonly name: string;
	appendLine(value: string): void;
	dispose?(): void;
	show?(preserveFocus?: boolean): void;
}

const sanitizedKeys = new Set<string>(['accessToken', 'password', 'token']);
const defaultSanitize = function (key: string, value: any): any {
	return sanitizedKeys.has(key) ? `<${value}>` : value;
};

export const Logger = new (class Logger {
	private output: LogChannel | undefined;
	private provider: LogChannelProvider | undefined;

	configure(provider: LogChannelProvider, logLevel: LogLevel, debugging: boolean = false) {
		this.provider = provider;

		this._isDebugging = debugging;
		this.logLevel = logLevel;
	}

	enabled(level: LogLevel): boolean {
		return this.level >= toOrderedLevel(level);
	}

	private _isDebugging = false;
	get isDebugging() {
		return this._isDebugging;
	}

	private level: OrderedLevel = OrderedLevel.Off;
	private _logLevel: LogLevel = 'off';
	get logLevel(): LogLevel {
		return this._logLevel;
	}
	set logLevel(value: LogLevel) {
		this._logLevel = value;
		this.level = toOrderedLevel(this._logLevel);

		if (value === 'off') {
			this.output?.dispose?.();
			this.output = undefined;
		} else {
			this.output ??= this.provider!.createChannel(this.provider!.name);
		}
	}

	get timestamp(): string {
		return `[${new Date().toISOString().replace(/T/, ' ').slice(0, -1)}]`;
	}

	debug(message: string, ...params: any[]): void;
	debug(scope: LogScope | undefined, message: string, ...params: any[]): void;
	debug(scopeOrMessage: LogScope | string | undefined, ...params: any[]): void {
		if (this.level < OrderedLevel.Debug && !this.isDebugging) return;

		let message;
		if (typeof scopeOrMessage === 'string') {
			message = scopeOrMessage;
		} else {
			message = params.shift();

			if (scopeOrMessage != null) {
				message = `${scopeOrMessage.prefix} ${message ?? ''}`;
			}
		}

		if (this.isDebugging) {
			console.log(`[${padOrTruncateEnd(this.provider!.name, 13)}]`, this.timestamp, message ?? '', ...params);
		}

		if (this.output == null || this.level < OrderedLevel.Debug) return;
		this.output.appendLine(`${this.timestamp} ${message ?? ''}${this.toLoggableParams(true, params)}`);
	}

	error(ex: Error | unknown, message?: string, ...params: any[]): void;
	error(ex: Error | unknown, scope?: LogScope, message?: string, ...params: any[]): void;
	error(ex: Error | unknown, scopeOrMessage: LogScope | string | undefined, ...params: any[]): void {
		if (this.level < OrderedLevel.Error && !this.isDebugging) return;

		let message;
		if (scopeOrMessage == null || typeof scopeOrMessage === 'string') {
			message = scopeOrMessage;
		} else {
			message = `${scopeOrMessage.prefix} ${params.shift() ?? ''}`;
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
			if (ex != null) {
				console.error(
					`[${padOrTruncateEnd(this.provider!.name, 13)}]`,
					this.timestamp,
					message ?? '',
					...params,
					ex,
				);
			} else {
				console.error(
					`[${padOrTruncateEnd(this.provider!.name, 13)}]`,
					this.timestamp,
					message ?? '',
					...params,
				);
			}
		}

		if (this.output == null || this.level < OrderedLevel.Error) return;
		this.output.appendLine(
			`${this.timestamp} ${message ?? ''}${this.toLoggableParams(false, params)}${
				// eslint-disable-next-line @typescript-eslint/no-base-to-string
				ex != null ? `\n${String(ex)}` : ''
			}`,
		);
	}

	log(message: string, ...params: any[]): void;
	log(scope: LogScope | undefined, message: string, ...params: any[]): void;
	log(scopeOrMessage: LogScope | string | undefined, ...params: any[]): void {
		if (this.level < OrderedLevel.Info && !this.isDebugging) return;

		let message;
		if (typeof scopeOrMessage === 'string') {
			message = scopeOrMessage;
		} else {
			message = params.shift();

			if (scopeOrMessage != null) {
				message = `${scopeOrMessage.prefix} ${message ?? ''}`;
			}
		}

		if (this.isDebugging) {
			console.log(`[${padOrTruncateEnd(this.provider!.name, 13)}]`, this.timestamp, message ?? '', ...params);
		}

		if (this.output == null || this.level < OrderedLevel.Info) return;
		this.output.appendLine(`${this.timestamp} ${message ?? ''}${this.toLoggableParams(false, params)}`);
	}

	warn(message: string, ...params: any[]): void;
	warn(scope: LogScope | undefined, message: string, ...params: any[]): void;
	warn(scopeOrMessage: LogScope | string | undefined, ...params: any[]): void {
		if (this.level < OrderedLevel.Warn && !this.isDebugging) return;

		let message;
		if (typeof scopeOrMessage === 'string') {
			message = scopeOrMessage;
		} else {
			message = params.shift();

			if (scopeOrMessage != null) {
				message = `${scopeOrMessage.prefix} ${message ?? ''}`;
			}
		}

		if (this.isDebugging) {
			console.warn(this.timestamp, `[${this.provider!.name}]`, message ?? '', ...params);
		}

		if (this.output == null || this.level < OrderedLevel.Warn) return;
		this.output.appendLine(`${this.timestamp} ${message ?? ''}${this.toLoggableParams(false, params)}`);
	}

	showOutputChannel(preserveFocus?: boolean): void {
		this.output?.show?.(preserveFocus);
	}

	toLoggable(o: any, sanitize?: ((key: string, value: any) => any) | undefined): string {
		if (typeof o !== 'object') return String(o);

		sanitize ??= this.provider!.sanitize ?? defaultSanitize;

		if (Array.isArray(o)) {
			return `[${o.map(i => this.toLoggable(i, sanitize)).join(', ')}]`;
		}

		const loggable = this.provider!.toLoggable?.(o);
		if (loggable != null) return loggable;

		try {
			return JSON.stringify(o, sanitize);
		} catch {
			return '<error>';
		}
	}

	private toLoggableParams(debugOnly: boolean, params: any[]) {
		if (params.length === 0 || (debugOnly && this.level < OrderedLevel.Debug && !this.isDebugging)) {
			return '';
		}

		const loggableParams = params.map(p => this.toLoggable(p)).join(', ');
		return loggableParams.length !== 0 ? ` \u2014 ${loggableParams}` : '';
	}
})();

const maxBufferedLines = 100;

export class BufferedLogChannel implements LogChannel {
	private readonly buffer: string[] = [];
	private bufferTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly channel: RequireSome<LogChannel, 'dispose'> & { append(value: string): void },
		private readonly interval: number = 500,
	) {}

	dispose(): void {
		clearInterval(this.bufferTimer);
		this.bufferTimer = undefined;

		this.flush();
		this.channel.dispose();
	}

	get name(): string {
		return this.channel.name;
	}

	appendLine(value: string) {
		this.buffer.push(value);

		if (this.buffer.length >= maxBufferedLines) {
			this.flush();
		} else {
			this.bufferTimer ??= setInterval(() => this.flush(), this.interval);
		}
	}

	show(preserveFocus?: boolean): void {
		this.channel.show?.(preserveFocus);
	}

	private _emptyCounter = 0;

	private flush() {
		if (this.buffer.length) {
			this._emptyCounter = 0;

			let value = this.buffer.join('\n');
			value += '\n';
			this.buffer.length = 0;

			this.channel.append(value);
		} else {
			this._emptyCounter++;
			if (this._emptyCounter > 10) {
				clearInterval(this.bufferTimer);
				this.bufferTimer = undefined;
				this._emptyCounter = 0;
			}
		}
	}
}

function toOrderedLevel(logLevel: LogLevel): OrderedLevel {
	switch (logLevel) {
		case 'off':
			return OrderedLevel.Off;
		case 'error':
			return OrderedLevel.Error;
		case 'warn':
			return OrderedLevel.Warn;
		case 'info':
			return OrderedLevel.Info;
		case 'debug':
			return OrderedLevel.Debug;
		default:
			return OrderedLevel.Off;
	}
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getLoggableName(instance: Function | object) {
	let ctor;
	if (typeof instance === 'function') {
		if (instance.prototype?.constructor == null) return instance.name;

		ctor = instance.prototype.constructor;
	} else {
		ctor = instance.constructor;
	}

	let name: string = ctor?.name ?? '';

	// Strip webpack module name (since I never name classes with an _)
	const index = name.indexOf('_');
	name = index === -1 ? name : name.substring(index + 1);

	if (ctor?.[LogInstanceNameFn] != null) {
		name = ctor[LogInstanceNameFn](instance, name);
	}

	return name;
}

export interface LogProvider {
	enabled(logLevel: LogLevel): boolean;
	log(logLevel: LogLevel, scope: LogScope | undefined, message: string, ...params: any[]): void;
}

export const defaultLogProvider: LogProvider = {
	enabled: (logLevel: LogLevel) => Logger.enabled(logLevel) || Logger.isDebugging,
	log: (logLevel: LogLevel, scope: LogScope | undefined, message: string, ...params: any[]) => {
		switch (logLevel) {
			case 'error':
				Logger.error(undefined, scope, message, ...params);
				break;
			case 'warn':
				Logger.warn(scope, message, ...params);
				break;
			case 'info':
				Logger.log(scope, message, ...params);
				break;
			default:
				Logger.debug(scope, message, ...params);
				break;
		}
	},
};

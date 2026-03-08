import type { LogLevel } from './logger.constants.js';
import type { ScopedLogger } from './logger.scope.js';
import { padOrTruncateEnd } from './string.js';

const isoTRegex = /T/;
const stackCallerRegex = /.*\s*?at\s(.+?)\s/;
const leadingUnderscoreRegex = /^_+/;

export const OrderedLevel = {
	Off: 0,
	Trace: 1,
	Debug: 2,
	Info: 3,
	Warn: 4,
	Error: 5,
} as const;
export type OrderedLevel = (typeof OrderedLevel)[keyof typeof OrderedLevel];

export interface LogChannelProvider {
	readonly name: string;
	createChannel(name: string): LogChannel;
	toLoggable?(o: unknown): string | undefined;
	hash?(data: string): string;

	sanitizeKeys?: Set<string>;
}

export interface LogChannel {
	readonly name: string;
	readonly logLevel: OrderedLevel;
	readonly onDidChangeLogLevel?: (listener: (level: OrderedLevel) => void) => { dispose(): void };

	dispose?(): void;
	show?(preserveFocus?: boolean): void;

	trace(message: string, ...args: any[]): void;
	debug(message: string, ...args: any[]): void;
	info(message: string, ...args: any[]): void;
	warn(message: string, ...args: any[]): void;
	error(error: string | Error, ...args: any[]): void;
}

const defaultSanitizeKeys = ['accessToken', 'password', 'token'];

class Logger {
	private output: LogChannel | undefined;
	private provider: RequireSome<LogChannelProvider, 'sanitizeKeys'> | undefined;

	configure(provider: LogChannelProvider, debugging: boolean = false) {
		if (provider.sanitizeKeys != null) {
			for (const key of defaultSanitizeKeys) {
				provider.sanitizeKeys.add(key);
			}
		} else {
			provider.sanitizeKeys = new Set(defaultSanitizeKeys);
		}
		this.provider = provider as RequireSome<LogChannelProvider, 'sanitizeKeys'>;

		this._isDebugging = debugging;

		// Create output channel and sync with the host's log level
		this.output = provider.createChannel(provider.name);
		this.level = this.output.logLevel;
		this.output.onDidChangeLogLevel?.(level => {
			this.level = level;
		});
	}

	enabled(level?: Exclude<LogLevel, 'off'>): boolean {
		if (this.isDebugging) return true;
		if (this.level === OrderedLevel.Off) return false;
		if (level == null) return true;

		return this.level <= toOrderedLevel(level);
	}

	private _isDebugging = false;
	get isDebugging() {
		return this._isDebugging;
	}

	private level: OrderedLevel = OrderedLevel.Off;
	get logLevel(): LogLevel {
		return toFriendlyLogLevel(this.level);
	}

	get timestamp(): string {
		return `[${new Date().toISOString().replace(isoTRegex, ' ').slice(0, -1)}]`;
	}

	trace(message: string, ...params: any[]): void;
	trace(scope: ScopedLogger | undefined, message: string, ...params: any[]): void;
	trace(scopeOrMessage: ScopedLogger | string | undefined, ...params: any[]): void {
		if ((this.level === OrderedLevel.Off || this.level > OrderedLevel.Trace) && !this.isDebugging) return;

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
			console.debug(`[${padOrTruncateEnd(this.provider!.name, 13)}]`, this.timestamp, message ?? '', ...params);
		}
		this.output?.trace(`  ${message ?? ''}${this.toLoggableParams(true, params)}`);
	}

	debug(message: string, ...params: any[]): void;
	debug(scope: ScopedLogger | undefined, message: string, ...params: any[]): void;
	debug(scopeOrMessage: ScopedLogger | string | undefined, ...params: any[]): void {
		if ((this.level === OrderedLevel.Off || this.level > OrderedLevel.Debug) && !this.isDebugging) return;

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
			console.debug(`[${padOrTruncateEnd(this.provider!.name, 13)}]`, this.timestamp, message ?? '', ...params);
		}
		this.output?.debug(`  ${message ?? ''}${this.toLoggableParams(false, params)}`);
	}

	info(message: string, ...params: any[]): void;
	info(scope: ScopedLogger | undefined, message: string, ...params: any[]): void;
	info(scopeOrMessage: ScopedLogger | string | undefined, ...params: any[]): void {
		if ((this.level === OrderedLevel.Off || this.level > OrderedLevel.Info) && !this.isDebugging) return;

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
			console.info(`[${padOrTruncateEnd(this.provider!.name, 13)}]`, this.timestamp, message ?? '', ...params);
		}
		this.output?.info(`   ${message ?? ''}${this.toLoggableParams(false, params)}`);
	}

	warn(message: string, ...params: any[]): void;
	warn(scope: ScopedLogger | undefined, message: string, ...params: any[]): void;
	warn(scopeOrMessage: ScopedLogger | string | undefined, ...params: any[]): void {
		if ((this.level === OrderedLevel.Off || this.level > OrderedLevel.Warn) && !this.isDebugging) return;

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
			console.warn(`[${padOrTruncateEnd(this.provider!.name, 13)}]`, this.timestamp, message ?? '', ...params);
		}
		this.output?.warn(`${message ?? ''}${this.toLoggableParams(false, params)}`);
	}

	error(ex: Error | unknown, message?: string, ...params: any[]): void;
	error(ex: Error | unknown, scope?: ScopedLogger, message?: string, ...params: any[]): void;
	error(ex: Error | unknown, scopeOrMessage: ScopedLogger | string | undefined, ...params: any[]): void {
		if ((this.level === OrderedLevel.Off || this.level > OrderedLevel.Error) && !this.isDebugging) return;

		let message;
		if (scopeOrMessage == null || typeof scopeOrMessage === 'string') {
			message = scopeOrMessage;
		} else {
			message = `${scopeOrMessage.prefix} ${params.shift() ?? ''}`;
		}

		if (message == null) {
			const stack = ex instanceof Error ? ex.stack : undefined;
			if (stack) {
				const match = stackCallerRegex.exec(stack);
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

		const errorMessage = `  ${message ?? ''}${this.toLoggableParams(false, params)}`;
		if (ex != null) {
			// eslint-disable-next-line @typescript-eslint/no-base-to-string
			this.output?.error(String(ex), errorMessage);
		} else {
			this.output?.error(errorMessage);
		}
	}

	showOutputChannel(preserveFocus?: boolean): void {
		this.output?.show?.(preserveFocus);
	}

	toLoggable(o: any, name?: string): string {
		if (name != null) {
			const sanitized = this.sanitize(name, o);
			if (sanitized != null) return sanitized;
		}

		if (typeof o === 'function') return '<function>';
		if (o == null || typeof o !== 'object') return String(o);

		if (o instanceof Error) return String(o);

		if (Array.isArray(o)) {
			return `[${o.map(i => this.toLoggable(i)).join(', ')}]`;
		}

		const loggable = this.provider!.toLoggable?.(o);
		if (loggable != null) return loggable;

		try {
			return JSON.stringify(o, (key: string, value: unknown): unknown => {
				if (key.charCodeAt(0) === 95) return undefined; // skip '_'-prefixed keys
				if (this.provider!.sanitizeKeys.has(key)) return this.sanitize(key, value);

				if (key !== '' && typeof value === 'object' && value != null && !Array.isArray(value)) {
					if (value instanceof Error) return String(value);
					return this.provider!.toLoggable?.(value) ?? value;
				}

				return value;
			});
		} catch {
			debugger;
			return '<error>';
		}
	}

	sanitize(key: string, value: unknown): string | undefined {
		// Nothing to redact if the value is null/undefined
		if (value == null) return undefined;

		// Strip leading underscores so `_token` matches `token` in sanitizeKeys
		const sanitizeKey = key.replace(leadingUnderscoreRegex, '') || key;
		if (!this.provider?.sanitizeKeys?.has(sanitizeKey)) return undefined;

		if (this.provider.hash != null) {
			return `<${sanitizeKey}:${this.provider.hash(typeof value === 'string' ? value : JSON.stringify(value))}>`;
		}
		return `<${sanitizeKey}>`;
	}

	private toLoggableParams(debugOnly: boolean, params: any[]) {
		if (
			params.length === 0 ||
			(debugOnly && (this.level === OrderedLevel.Off || this.level > OrderedLevel.Debug) && !this.isDebugging)
		) {
			return '';
		}

		const loggableParams = params.map(p => this.toLoggable(p)).join(', ');
		return loggableParams.length !== 0 ? ` \u2014 ${loggableParams}` : '';
	}
}

const _logger = new Logger();
export { _logger as Logger };

function toOrderedLevel(logLevel: LogLevel): OrderedLevel {
	switch (logLevel) {
		case 'off':
			return OrderedLevel.Off;
		case 'trace':
			return OrderedLevel.Trace;
		case 'debug':
			return OrderedLevel.Debug;
		case 'info':
			return OrderedLevel.Info;
		case 'warn':
			return OrderedLevel.Warn;
		case 'error':
			return OrderedLevel.Error;
		default:
			return OrderedLevel.Off;
	}
}

function toFriendlyLogLevel(level: OrderedLevel): LogLevel {
	switch (level) {
		case OrderedLevel.Off:
			return 'off';
		case OrderedLevel.Trace:
			return 'trace';
		case OrderedLevel.Debug:
			return 'debug';
		case OrderedLevel.Info:
			return 'info';
		case OrderedLevel.Warn:
			return 'warn';
		case OrderedLevel.Error:
			return 'error';
		default:
			return 'off';
	}
}

export const customLoggableNameFns = new WeakMap<object, (instance: any, name: string) => string>();

export function getLoggableName(instance: object): string {
	let ctor;
	if (typeof instance === 'function') {
		ctor = instance.prototype?.constructor;
		if (ctor == null) return instance.name;
	} else {
		ctor = instance.constructor;
	}

	let name: string = ctor?.name ?? '';
	// Strip webpack module name (since I never name classes with an _)
	const index = name.indexOf('_');
	if (index !== -1) {
		name = name.substring(index + 1);
	}

	// Walk the prototype chain to find a custom name function (supports @logName on base classes)
	let proto = ctor;
	while (proto != null) {
		const customNameFn = customLoggableNameFns.get(proto);
		if (customNameFn != null) {
			return customNameFn(instance, name);
		}
		proto = Object.getPrototypeOf(proto);
	}

	return name;
}

export interface LogProvider {
	enabled(logLevel: Exclude<LogLevel, 'off'>): boolean;
	log(logLevel: LogLevel, scope: ScopedLogger | undefined, message: string, ...params: any[]): void;
}

export const defaultLogProvider: LogProvider = {
	enabled: (logLevel: Exclude<LogLevel, 'off'>) => _logger.enabled(logLevel),
	log: (logLevel: LogLevel, scope: ScopedLogger | undefined, message: string, ...params: any[]) => {
		switch (logLevel) {
			case 'error':
				_logger.error(undefined, scope, message, ...params);
				break;
			case 'warn':
				scope?.warn(message, ...params);
				break;
			case 'info':
				scope?.info(message, ...params);
				break;
			case 'debug':
				scope?.debug(message, ...params);
				break;
			case 'trace':
				scope?.trace(message, ...params);
				break;
			default:
				scope?.debug(message, ...params);
				break;
		}
	},
};

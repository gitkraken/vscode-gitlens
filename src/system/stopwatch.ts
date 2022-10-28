import { hrtime } from '@env/hrtime';
import { GlyphChars } from '../constants';
import type { LogScope } from '../logger';
import { Logger, LogLevel } from '../logger';
import { getNextLogScopeId } from '../system/decorators/log';

type StopwatchLogOptions = { message?: string; suffix?: string };
type StopwatchOptions = {
	log?: boolean | StopwatchLogOptions;
	logLevel?: StopwatchLogLevel;
};
type StopwatchLogLevel = Exclude<LogLevel, LogLevel.Off>;

export class Stopwatch {
	private readonly instance = `[${String(getNextLogScopeId()).padStart(5)}] `;
	private readonly logLevel: StopwatchLogLevel;
	private time: [number, number];

	constructor(public readonly scope: string | LogScope | undefined, options?: StopwatchOptions, ...params: any[]) {
		let logScope;
		if (typeof scope !== 'string') {
			logScope = scope;
			scope = '';
			this.instance = '';
		}

		let logOptions: StopwatchLogOptions | undefined;
		if (typeof options?.log === 'boolean') {
			logOptions = options.log ? {} : undefined;
		} else {
			logOptions = options?.log ?? {};
		}

		this.logLevel = options?.logLevel ?? LogLevel.Info;
		this.time = hrtime();

		if (logOptions != null) {
			if (!Logger.enabled(this.logLevel)) return;

			if (params.length) {
				log(
					this.logLevel,
					logScope,
					`${this.instance}${scope}${logOptions.message ?? ''}${logOptions.suffix ?? ''}`,
					...params,
				);
			} else {
				log(
					this.logLevel,
					logScope,
					`${this.instance}${scope}${logOptions.message ?? ''}${logOptions.suffix ?? ''}`,
				);
			}
		}
	}

	elapsed(): number {
		const [secs, nanosecs] = hrtime(this.time);
		return secs * 1000 + Math.floor(nanosecs / 1000000);
	}

	log(options?: StopwatchLogOptions): void {
		this.logCore(this.scope, options, false);
	}

	restart(options?: StopwatchLogOptions): void {
		this.logCore(this.scope, options, true);
		this.time = hrtime();
	}

	stop(options?: StopwatchLogOptions): void {
		this.restart(options);
	}

	private logCore(
		scope: string | LogScope | undefined,
		options: StopwatchLogOptions | undefined,
		logTotalElapsed: boolean,
	): void {
		if (!Logger.enabled(this.logLevel)) return;

		let logScope;
		if (typeof scope !== 'string') {
			logScope = scope;
			scope = '';
		}

		if (!logTotalElapsed) {
			log(this.logLevel, logScope, `${this.instance}${scope}${options?.message ?? ''}${options?.suffix ?? ''}`);

			return;
		}

		const [secs, nanosecs] = hrtime(this.time);
		const ms = secs * 1000 + Math.floor(nanosecs / 1000000);

		const prefix = `${this.instance}${scope}${options?.message ?? ''}`;
		log(
			ms > 250 ? LogLevel.Warn : this.logLevel,
			logScope,
			`${prefix ? `${prefix} ${GlyphChars.Dot} ` : ''}${ms} ms${options?.suffix ?? ''}`,
		);
	}

	private static readonly watches = new Map<string, Stopwatch>();

	static start(key: string, options?: StopwatchOptions, ...params: any[]): void {
		Stopwatch.watches.get(key)?.log();
		Stopwatch.watches.set(key, new Stopwatch(key, options, ...params));
	}

	static log(key: string, options?: StopwatchLogOptions): void {
		Stopwatch.watches.get(key)?.log(options);
	}

	static stop(key: string, options?: StopwatchLogOptions): void {
		Stopwatch.watches.get(key)?.stop(options);
		Stopwatch.watches.delete(key);
	}
}

function log(logLevel: StopwatchLogLevel, scope: LogScope | undefined, message: string, ...params: any[]) {
	switch (logLevel) {
		case LogLevel.Error:
			Logger.error('', scope, message, ...params);
			break;
		case LogLevel.Warn:
			Logger.warn(scope, message, ...params);
			break;
		case LogLevel.Info:
			Logger.log(scope, message, ...params);
			break;
		default:
			Logger.debug(scope, message, ...params);
			break;
	}
}

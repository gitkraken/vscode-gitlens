import { hrtime } from '@env/hrtime';
import { GlyphChars } from '../constants';
import type { LogProvider } from './logger';
import { defaultLogProvider } from './logger';
import { LogLevel } from './logger.constants';
import type { LogScope } from './logger.scope';
import { getNextLogScopeId } from './logger.scope';

type StopwatchLogOptions = { message?: string; suffix?: string };
type StopwatchOptions = {
	log?: boolean | StopwatchLogOptions;
	logLevel?: StopwatchLogLevel;
	provider?: LogProvider;
};
type StopwatchLogLevel = Exclude<LogLevel, LogLevel.Off>;

export class Stopwatch {
	private readonly instance = `[${String(getNextLogScopeId()).padStart(5)}] `;
	private readonly logLevel: StopwatchLogLevel;
	private readonly logProvider: LogProvider;

	private _time: [number, number];
	get startTime() {
		return this._time;
	}

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
		this.logProvider = options?.provider ?? defaultLogProvider;
		this._time = hrtime();

		if (logOptions != null) {
			if (!this.logProvider.enabled(this.logLevel)) return;

			if (params.length) {
				this.logProvider.log(
					this.logLevel,
					logScope,
					`${this.instance}${scope}${logOptions.message ?? ''}${logOptions.suffix ?? ''}`,
					...params,
				);
			} else {
				this.logProvider.log(
					this.logLevel,
					logScope,
					`${this.instance}${scope}${logOptions.message ?? ''}${logOptions.suffix ?? ''}`,
				);
			}
		}
	}

	elapsed(): number {
		const [secs, nanosecs] = hrtime(this._time);
		return secs * 1000 + Math.floor(nanosecs / 1000000);
	}

	log(options?: StopwatchLogOptions): void {
		this.logCore(this.scope, options, false);
	}

	restart(options?: StopwatchLogOptions): void {
		this.logCore(this.scope, options, true);
		this._time = hrtime();
	}

	stop(options?: StopwatchLogOptions): void {
		this.restart(options);
	}

	private logCore(
		scope: string | LogScope | undefined,
		options: StopwatchLogOptions | undefined,
		logTotalElapsed: boolean,
	): void {
		if (!this.logProvider.enabled(this.logLevel)) return;

		let logScope;
		if (typeof scope !== 'string') {
			logScope = scope;
			scope = '';
		}

		if (!logTotalElapsed) {
			this.logProvider.log(
				this.logLevel,
				logScope,
				`${this.instance}${scope}${options?.message ?? ''}${options?.suffix ?? ''}`,
			);

			return;
		}

		const [secs, nanosecs] = hrtime(this._time);
		const ms = secs * 1000 + Math.floor(nanosecs / 1000000);

		const prefix = `${this.instance}${scope}${options?.message ?? ''}`;
		this.logProvider.log(
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

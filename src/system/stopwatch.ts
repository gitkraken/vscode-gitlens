import { hrtime } from '@env/hrtime';
import type { LogProvider } from './logger';
import { defaultLogProvider } from './logger';
import type { LogLevel } from './logger.constants';
import type { LogScope } from './logger.scope';
import { getNextLogScopeId } from './logger.scope';

type StopwatchLogOptions = { message?: string; suffix?: string };
type StopwatchOptions = {
	log?: boolean | StopwatchLogOptions;
	logLevel?: StopwatchLogLevel;
	provider?: LogProvider;
};
type StopwatchLogLevel = Exclude<LogLevel, 'off'>;

export class Stopwatch {
	private readonly instance = `[${String(getNextLogScopeId()).padStart(5)}] `;
	private readonly logLevel: StopwatchLogLevel;
	private readonly logProvider: LogProvider;

	private _time: [number, number];
	get startTime() {
		return this._time;
	}

	constructor(
		private readonly scope: string | LogScope | undefined,
		options?: StopwatchOptions,
		...params: any[]
	) {
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

		this.logLevel = options?.logLevel ?? 'info';
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
			ms > 250 ? 'warn' : this.logLevel,
			logScope,
			`${prefix ? `${prefix} ` : ''}[${ms}ms]${options?.suffix ?? ''}`,
		);
	}
}

export function maybeStopWatch(
	scope: string | LogScope | undefined,
	options?: StopwatchOptions,
	...params: any[]
): Stopwatch | undefined {
	return (options?.provider ?? defaultLogProvider).enabled(options?.logLevel ?? 'info')
		? new Stopwatch(scope, options, ...params)
		: undefined;
}

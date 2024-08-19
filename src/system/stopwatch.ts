import { hrtime } from '@env/hrtime';
import type { LogProvider } from './logger';
import { defaultLogProvider } from './logger';
import type { LogLevel } from './logger.constants';
import type { LogScope } from './logger.scope';
import { getNewLogScope } from './logger.scope';

(Symbol as any).dispose ??= Symbol('Symbol.dispose');
(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

type StopwatchLogOptions = { message?: string; suffix?: string };
type StopwatchOptions = {
	log?: boolean | StopwatchLogOptions;
	logLevel?: StopwatchLogLevel;
	provider?: LogProvider;
};
type StopwatchLogLevel = Exclude<LogLevel, 'off'>;

export class Stopwatch implements Disposable {
	private readonly logScope: LogScope;
	private readonly logLevel: StopwatchLogLevel;
	private readonly logProvider: LogProvider;

	private _time: [number, number];
	get startTime() {
		return this._time;
	}

	private _stopped = false;

	constructor(scope: string | LogScope | undefined, options?: StopwatchOptions, ...params: any[]) {
		this.logScope = scope != null && typeof scope !== 'string' ? scope : getNewLogScope(scope ?? '', false);

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
					this.logScope,
					`${logOptions.message ?? ''}${logOptions.suffix ?? ''}`,
					...params,
				);
			} else {
				this.logProvider.log(
					this.logLevel,
					this.logScope,
					`${logOptions.message ?? ''}${logOptions.suffix ?? ''}`,
				);
			}
		}
	}

	[Symbol.dispose](): void {
		this.stop();
	}

	elapsed(): number {
		const [secs, nanosecs] = hrtime(this._time);
		return secs * 1000 + Math.floor(nanosecs / 1000000);
	}

	log(options?: StopwatchLogOptions): void {
		this.logCore(options, false);
	}

	restart(options?: StopwatchLogOptions): void {
		this.logCore(options, true);
		this._time = hrtime();
		this._stopped = false;
	}

	stop(options?: StopwatchLogOptions): void {
		if (this._stopped) return;

		this.restart(options);
		this._stopped = true;
	}

	private logCore(options: StopwatchLogOptions | undefined, logTotalElapsed: boolean): void {
		if (!this.logProvider.enabled(this.logLevel)) return;

		if (!logTotalElapsed) {
			this.logProvider.log(this.logLevel, this.logScope, `${options?.message ?? ''}${options?.suffix ?? ''}`);

			return;
		}

		const [secs, nanosecs] = hrtime(this._time);
		const ms = secs * 1000 + Math.floor(nanosecs / 1000000);

		const prefix = options?.message ?? '';
		this.logProvider.log(
			ms > 250 ? 'warn' : this.logLevel,
			this.logScope,
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

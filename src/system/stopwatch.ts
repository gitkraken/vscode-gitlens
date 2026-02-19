import { hrtime } from '@env/hrtime.js';
import type { LogLevel } from './logger.constants.js';
import type { LogProvider } from './logger.js';
import { defaultLogProvider } from './logger.js';
import type { ScopedLogger } from './logger.scope.js';
import { getNewLogScope } from './logger.scope.js';

(Symbol as any).dispose ??= Symbol('Symbol.dispose');
(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

type StopwatchLogLevel = Exclude<LogLevel, 'off'>;
type StopwatchLogOptions = {
	level?: StopwatchLogLevel;
	message?: string;
	suffix?: string;
	onlyExit?: true;
};
type StopwatchOptions = {
	log?: boolean | StopwatchLogOptions;
	provider?: LogProvider;
	scopeLabel?: string;
};

export class Stopwatch implements Disposable {
	private readonly logScope: ScopedLogger;
	private readonly logLevel: StopwatchLogLevel;
	private readonly logProvider: LogProvider;

	private _time: [number, number];
	get startTime(): [number, number] {
		return this._time;
	}

	private _stopped = false;

	constructor(scope: string | ScopedLogger | undefined, options?: StopwatchOptions, ...params: any[]) {
		this.logScope =
			scope != null && typeof scope !== 'string'
				? scope
				: getNewLogScope(scope ?? '', false, options?.scopeLabel);

		const log = options?.log;
		let logEntry: { message?: string; suffix?: string } | undefined;
		if (log == null || log === true) {
			logEntry = {};
		} else if (log === false) {
			logEntry = undefined;
		} else {
			logEntry = log.onlyExit ? undefined : log;
		}

		this.logLevel = (typeof log === 'object' ? log.level : undefined) ?? 'debug';
		this.logProvider = options?.provider ?? defaultLogProvider;
		this._time = hrtime();

		if (logEntry != null) {
			if (!this.logProvider.enabled(this.logLevel)) return;

			if (params.length) {
				this.logProvider.log(
					this.logLevel,
					this.logScope,
					`${logEntry.message ?? ''}${logEntry.suffix ?? ''}`,
					...params,
				);
			} else {
				this.logProvider.log(this.logLevel, this.logScope, `${logEntry.message ?? ''}${logEntry.suffix ?? ''}`);
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

	log(options?: { message?: string; suffix?: string }): void {
		this.logCore(options, false);
	}

	restart(options?: { message?: string; suffix?: string }): void {
		this.logCore(options, true);
		this._time = hrtime();
		this._stopped = false;
	}

	stop(options?: { message?: string; suffix?: string }): void {
		if (this._stopped) return;

		this.restart(options);
		this._stopped = true;
	}

	private logCore(options: { message?: string; suffix?: string } | undefined, logTotalElapsed: boolean): void {
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
	scope: string | ScopedLogger | undefined,
	options?: StopwatchOptions,
	...params: any[]
): Stopwatch | undefined {
	const level = (typeof options?.log === 'object' ? options.log.level : undefined) ?? 'info';
	return (options?.provider ?? defaultLogProvider).enabled(level)
		? new Stopwatch(scope, options, ...params)
		: undefined;
}

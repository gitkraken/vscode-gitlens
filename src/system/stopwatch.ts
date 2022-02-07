import { hrtime } from '@env/hrtime';
import { GlyphChars } from '../constants';
import { LogCorrelationContext, Logger, LogLevel } from '../logger';
import { getNextCorrelationId } from '../system/decorators/log';

type StopwatchLogOptions = { message?: string; suffix?: string };
type StopwatchOptions = {
	log?: boolean | StopwatchLogOptions;
	logLevel?: StopwatchLogLevel;
};
type StopwatchLogLevel = Exclude<LogLevel, LogLevel.Off>;

export class Stopwatch {
	private readonly instance = `[${String(getNextCorrelationId()).padStart(5)}] `;
	private readonly logLevel: StopwatchLogLevel;
	private time: [number, number];

	constructor(public readonly context: string | LogCorrelationContext, options?: StopwatchOptions, ...params: any[]) {
		let cc;
		if (typeof context !== 'string') {
			cc = context;
			context = '';
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
					cc,
					`${this.instance}${context}${logOptions.message ?? ''}${logOptions.suffix ?? ''}`,
					...params,
				);
			} else {
				log(
					this.logLevel,
					cc,
					`${this.instance}${context}${logOptions.message ?? ''}${logOptions.suffix ?? ''}`,
				);
			}
		}
	}

	log(options?: StopwatchLogOptions): void {
		this.logCore(this.context, options, false);
	}

	restart(options?: StopwatchLogOptions): void {
		this.logCore(this.context, options, true);
		this.time = hrtime();
	}

	stop(options?: StopwatchLogOptions): void {
		this.restart(options);
	}

	private logCore(
		context: string | LogCorrelationContext,
		options: StopwatchLogOptions | undefined,
		logTotalElapsed: boolean,
	): void {
		if (!Logger.enabled(this.logLevel)) return;

		let cc;
		if (typeof context !== 'string') {
			cc = context;
			context = '';
		}

		if (!logTotalElapsed) {
			log(this.logLevel, cc, `${this.instance}${context}${options?.message ?? ''}${options?.suffix ?? ''}`);

			return;
		}

		const [secs, nanosecs] = hrtime(this.time);
		const ms = secs * 1000 + Math.floor(nanosecs / 1000000);

		const prefix = `${this.instance}${context}${options?.message ?? ''}`;
		log(
			ms > 250 ? LogLevel.Warn : this.logLevel,
			cc,
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

function log(logLevel: StopwatchLogLevel, cc: LogCorrelationContext | undefined, message: string, ...params: any[]) {
	switch (logLevel) {
		case LogLevel.Error:
			Logger.error('', cc, message, ...params);
			break;
		case LogLevel.Warn:
			Logger.warn(cc, message, ...params);
			break;
		case LogLevel.Info:
			Logger.log(cc, message, ...params);
			break;
		default:
			Logger.debug(cc, message, ...params);
			break;
	}
}

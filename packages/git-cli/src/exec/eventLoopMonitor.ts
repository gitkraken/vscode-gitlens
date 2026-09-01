/** A single recorded event-loop stall. */
type LagSample = { readonly endMs: number; readonly lagMs: number };

const tickIntervalMs = 250;
const lagRecordThresholdMs = 50;
const ringCapacity = 480;

/**
 * Detects event-loop stalls via heartbeat drift: a repeating timer whose actual fire time lags its
 * expected time by roughly the stall length. Cheaper than `perf_hooks.monitorEventLoopDelay`, which
 * runs a native timer at a resolution far finer than needed to catch a stall worth annotating.
 *
 * Only ticks while running; callers `start()`/`stop()` around the window they care about rather than
 * running this for the lifetime of the process.
 */
export class EventLoopMonitor {
	private timer: ReturnType<typeof setInterval> | undefined;
	private expectedMonoMs = 0;
	private readonly ring: LagSample[] = [];

	/** Idempotent. */
	start(): void {
		if (this.timer != null) return;

		this.expectedMonoMs = performance.now() + tickIntervalMs;
		const timer = setInterval(() => this.tick(), tickIntervalMs);
		timer.unref?.();
		this.timer = timer;
	}

	/** Idempotent; clears the timer and any recorded samples. */
	stop(): void {
		if (this.timer != null) {
			clearInterval(this.timer);
			this.timer = undefined;
		}

		this.ring.length = 0;
	}

	dispose(): void {
		this.stop();
	}

	/** Max observed event-loop stall (ms) among samples ending at or after {@link sinceEpochMs}. 0 when none, or not running. */
	maxDelaySince(sinceEpochMs: number): number {
		let max = 0;
		for (const sample of this.ring) {
			if (sample.endMs >= sinceEpochMs && sample.lagMs > max) {
				max = sample.lagMs;
			}
		}

		return max;
	}

	/** Split out from {@link tick} so tests can inject samples directly, without driving a real timer. */
	private record(endMs: number, lagMs: number): void {
		if (lagMs < lagRecordThresholdMs) return;

		this.ring.push({ endMs: endMs, lagMs: lagMs });
		if (this.ring.length > ringCapacity) {
			this.ring.shift();
		}
	}

	// Lag is measured on the MONOTONIC clock so a wall-clock step (NTP correction, manual change) or a
	// suspend/resume can't be recorded as a stall; the wall clock is only the ring's correlation key,
	// since {@link maxDelaySince} callers window by their own `Date.now()`-based start times.
	private tick(): void {
		const monoMs = performance.now();
		const lagMs = Math.round(monoMs - this.expectedMonoMs);
		this.expectedMonoMs = monoMs + tickIntervalMs;

		this.record(Date.now(), lagMs);
	}
}

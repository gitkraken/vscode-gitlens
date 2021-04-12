'use strict';

export class Stopwatch {
	private static readonly timers = new Map<string, [number, number]>();

	static start(id: string) {
		if (Stopwatch.timers.has(id)) {
			this.log(id);
		}

		Stopwatch.timers.set(id, process.hrtime());
	}

	static log(id: string, message?: string) {
		const [secs, nanosecs] = process.hrtime(Stopwatch.timers.get(id));
		const ms = secs * 1000 + Math.floor(nanosecs / 1000000);

		console.log(`${id}${message ? `(${message})` : ''} took ${ms} ms`);
	}

	static stop(id: string, message?: string) {
		if (!Stopwatch.timers.has(id)) return;

		this.log(id, message);
		Stopwatch.timers.delete(id);
	}
}

import { hrtime } from '#env/hrtime.js';

export { hrtime };

export function getDurationMilliseconds(start: [number, number]): number {
	const [secs, nanosecs] = hrtime(start);
	return secs * 1000 + Math.floor(nanosecs / 1000000);
}

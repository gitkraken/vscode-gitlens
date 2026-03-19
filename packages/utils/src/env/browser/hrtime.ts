export function hrtime(time?: [number, number]): [number, number] {
	const now = performance.now() * 1e-3;
	let seconds = Math.floor(now);
	let nanoseconds = Math.floor((now % 1) * 1e9);
	if (time !== undefined) {
		seconds = seconds - time[0];
		nanoseconds = nanoseconds - time[1];
		if (nanoseconds < 0) {
			seconds--;
			nanoseconds += 1e9;
		}
	}
	return [seconds, nanoseconds];
}

const millisecondsPerMinute = 60 * 1000;
const millisecondsPerHour = 60 * 60 * 1000;
export const millisecondsPerDay = 24 * 60 * 60 * 1000;

export function getLastFetchedUpdateInterval(lastFetched: number): number {
	const timeDiff = Date.now() - lastFetched;
	return timeDiff < millisecondsPerDay
		? (timeDiff < millisecondsPerHour ? millisecondsPerMinute : millisecondsPerHour) / 2
		: 0;
}

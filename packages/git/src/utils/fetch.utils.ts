const millisecondsPerMinute = 60 * 1000;
const millisecondsPerHour = 60 * 60 * 1000;
export const millisecondsPerDay = 24 * 60 * 60 * 1000;

/**
 * Calculates the update interval for fetch status based on how long ago the last fetch occurred.
 * Uses stepped intervals to prevent thrashing from frequent recalculations.
 *
 * @param lastFetched - Timestamp (in milliseconds) of the last fetch
 * @returns Update interval in milliseconds
 *
 * Interval schedule:
 * - < 15 minutes ago: refresh every 5 minutes
 * - < 30 minutes ago: refresh every 10 minutes
 * - < 1 hour ago: refresh every 20 minutes
 * - < 3 hours ago: refresh every 1 hour
 * - < 6 hours ago: refresh every 2 hours
 * - < 12 hours ago: refresh every 4 hours
 * - < 2 days ago: refresh every 8 hours
 * - ≥ 2 days ago: refresh every 1 day
 */
export function getLastFetchedUpdateInterval(lastFetched: number): number {
	const timeDiff = Date.now() - lastFetched;

	// Stepped intervals to prevent thrashing
	if (timeDiff < 15 * millisecondsPerMinute) {
		return 5 * millisecondsPerMinute;
	}
	if (timeDiff < 30 * millisecondsPerMinute) {
		return 10 * millisecondsPerMinute;
	}
	if (timeDiff < millisecondsPerHour) {
		return 20 * millisecondsPerMinute;
	}
	if (timeDiff < 3 * millisecondsPerHour) {
		return millisecondsPerHour;
	}
	if (timeDiff < 6 * millisecondsPerHour) {
		return 2 * millisecondsPerHour;
	}
	if (timeDiff < 12 * millisecondsPerHour) {
		return 4 * millisecondsPerHour;
	}
	if (timeDiff < 2 * millisecondsPerDay) {
		return 8 * millisecondsPerHour;
	}
	return millisecondsPerDay;
}

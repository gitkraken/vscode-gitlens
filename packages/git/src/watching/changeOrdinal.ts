let ordinal = 0;

/**
 * The next value of a process-wide counter, which orders when a watch session observed a change against when a cache
 * evicted an entry. Each call advances it, so no two calls share a value. A counter rather than a clock, so the order
 * is exact and holds under fake timers
 */
export function nextChangeOrdinal(): number {
	return ++ordinal;
}

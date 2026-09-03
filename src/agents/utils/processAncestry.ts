/** Walks `pid`'s parent chain through a process-table snapshot, returning its ancestor pids
 *  nearest-first (bounded, cycle-guarded). Empty when `pid` has no parent in the snapshot. */
export function walkAncestorChain(pid: number, parentPidMap: Map<number, number>): number[] {
	const maxHops = 8;
	const chain: number[] = [];
	const visited = new Set<number>([pid]);

	let current = parentPidMap.get(pid);
	while (current != null && chain.length < maxHops && !visited.has(current)) {
		chain.push(current);
		visited.add(current);
		current = parentPidMap.get(current);
	}

	return chain;
}

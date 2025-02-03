import type { GraphRefOptData } from '@gitkraken/gitkraken-components';

// copied from GitkrakenComponents to keep refs order the same as in the graph
export function compareGraphRefOpts(a: GraphRefOptData, b: GraphRefOptData): number {
	const comparationResult = a.name.localeCompare(b.name);
	if (comparationResult === 0) {
		// If names are equals
		if (a.type === 'remote') {
			return -1;
		}
	}
	return comparationResult;
}

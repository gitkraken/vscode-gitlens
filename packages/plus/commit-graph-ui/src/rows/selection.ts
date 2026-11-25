import type { GraphChangeSelectionDetail } from '../contracts/events.js';
import type { GraphSelectedRows } from '../contracts/state.js';

export function applyGraphSelectionChange(
	current: GraphSelectedRows | undefined,
	change: GraphChangeSelectionDetail,
): GraphSelectedRows {
	const sha = change.sha;
	if (sha == null) return {};

	const next: GraphSelectedRows = {};
	if (change.mode === 'range') {
		for (const rangeSha of change.rangeShas ?? []) {
			next[rangeSha] = true;
		}
	} else if (change.mode === 'toggle') {
		for (const selectedSha of Object.keys(current ?? {})) {
			if (selectedSha === sha) continue;

			next[selectedSha] = true;
		}
		if (current?.[sha] !== true) {
			next[sha] = true;
		}
	}

	return Object.keys(next).length > 0 ? next : { [sha]: true };
}

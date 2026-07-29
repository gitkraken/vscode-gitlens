import type { GraphComponentConfig } from '../../../../plus/graph/protocol.js';

/**
 * Resolves whether the minimap should be showing, from the `gitlens.graph.minimap.enabled` policy
 * and the stored per-workspace panel value.
 *
 * The policy governs only when there's no stored value — except under `auto`, where a stored
 * `false` isn't an override but simply falls through to the search-driven behavior. That's what
 * keeps `auto` reachable from the header button: pin (`true`) → unpin (`false`) → back to auto.
 *
 * | policy   | stored      | result          |
 * | -------- | ----------- | --------------- |
 * | `true`   | unset/`true`| shown           |
 * | `true`   | `false`     | hidden          |
 * | `'auto'` | `true`      | shown (pinned)  |
 * | `'auto'` | unset/`false`| on search      |
 * | `false`  | `true`      | shown           |
 * | `false`  | unset/`false`| hidden         |
 *
 * `dismissed` covers hiding an auto-shown minimap: it suppresses only the current search, so the
 * next one brings it back.
 */
export function resolveMinimapShown(
	policy: NonNullable<GraphComponentConfig['minimap']>,
	stored: boolean | undefined,
	searchActive: boolean,
	dismissed: boolean,
): boolean {
	if (policy === 'auto') {
		if (stored === true) return true;

		return searchActive && !dismissed;
	}

	return stored ?? policy;
}

import type { GraphComponentConfig } from '../../../../plus/graph/protocol.js';

/**
 * Resolves whether an *available* minimap should be showing, from the
 * `gitlens.graph.minimap.defaultVisibility` policy and the stored per-workspace panel value.
 * Availability itself (`gitlens.graph.minimap.enabled`) is a separate gate the callers apply
 * first — when it's off there's no header toggle, so no stored value can be created.
 *
 * The policy sets the starting state and the stored value overrides it — except under `onSearch`,
 * where a stored `false` isn't an override but simply falls through to the search-driven behavior.
 * That's what keeps `onSearch` reachable from the header button: pin (`true`) → unpin (`false`) →
 * back to on-search.
 *
 * | policy       | stored       | result         |
 * | ------------ | ------------ | -------------- |
 * | `'always'`   | unset/`true` | shown          |
 * | `'always'`   | `false`      | hidden         |
 * | `'onSearch'` | `true`       | shown (pinned) |
 * | `'onSearch'` | unset/`false`| on search      |
 * | `'hidden'`   | `true`       | shown (pinned) |
 * | `'hidden'`   | unset/`false`| hidden         |
 *
 * `dismissed` covers hiding an auto-shown minimap: it suppresses only the current search, so the
 * next one brings it back.
 */
export function resolveMinimapShown(
	policy: NonNullable<GraphComponentConfig['minimapDefaultVisibility']>,
	stored: boolean | undefined,
	searchActive: boolean,
	dismissed: boolean,
): boolean {
	if (policy === 'onSearch') {
		if (stored === true) return true;

		return searchActive && !dismissed;
	}

	return stored ?? policy === 'always';
}

import type { RowAdornment, RowAdornmentProvider } from '@gitkraken/commit-graph/engine/adornments.js';
import type { ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { TemplateResult } from 'lit';
import { html, nothing } from 'lit';
import type { StyleInfo } from '../../../../shared/components/csp-style-map.directive.js';
import { cspStyleMap } from '../../../../shared/components/csp-style-map.directive.js';
import '../../../../shared/components/commit/commit-stats.js';

/**
 * Pure Lit port of the React `WipStatsAdornmentProvider`. Emits a working-changes stats badge on
 * workdir rows so users see uncommitted-changes magnitude at a glance without selecting the row.
 *
 * Uses the shared `<commit-stats symbol="icons" appearance="pill">` element — the SAME pill the WIP
 * header / overview / Home cards render — so all working-tree stats look identical. When stats are
 * empty (all zeros) the provider renders nothing so a quiet working tree stays quiet.
 *
 * Placement is `'refs'`; the badge right-aligns within the Refs column (see `.gl-graph__wip-stats`
 * in graph.scss) so it sits at the column's trailing edge.
 */

/**
 * Stats payload for a single workdir/WIP row. Matches the legacy `WorkDirStats` shape so
 * consumers can pass through the host-supplied stats without translation.
 */
export interface WipStats {
	added?: number;
	modified?: number;
	deleted?: number;
	renamed?: number;
	/** When true, render the badge in a "fetching fresh stats" muted state. */
	stale?: boolean;
}

export interface WipStatsAdornmentOptions {
	/**
	 * Stats keyed by row sha. Provide entries only for workdir rows that have stats to show.
	 * Omit emails / non-workdir rows entirely — the provider doesn't render anything for them.
	 */
	statsBySha: ReadonlyMap<Sha, WipStats>;
}

export function createWipStatsAdornmentProvider(
	options: WipStatsAdornmentOptions,
): RowAdornmentProvider<TemplateResult, WipStats> {
	return {
		// WIP rows carry no refs, so render their working-tree stats in the refs zone — they show in
		// the Refs column when it's its own column (otherwise empty for WIP rows), and follow refs
		// inline otherwise. Keeps the stats grouped with the lane/refs region rather than the message.
		zone: 'ref',
		provideRowAdornment: function (row: ProcessedGraphRow): RowAdornment<WipStats> | undefined {
			if (row.kind !== 'workdir') return undefined;

			const stats = options.statsBySha.get(row.sha);
			if (stats == null) return undefined;

			return { context: stats, dynamic: true };
		},

		resolveAdornment: function (_row: ProcessedGraphRow, stats?: WipStats): TemplateResult | null {
			if (!stats) {
				return null;
			}

			const added = stats.added ?? 0;
			const modified = stats.modified ?? 0;
			const deleted = stats.deleted ?? 0;
			const renamed = stats.renamed ?? 0;
			if (added === 0 && modified === 0 && deleted === 0 && renamed === 0) {
				return null;
			}

			return renderWipStatsBadge(stats);
		},

		describeForA11y: function (_row: ProcessedGraphRow, stats?: WipStats): string | null {
			if (!stats) {
				return null;
			}

			const parts: string[] = [];
			if ((stats.added ?? 0) > 0) {
				parts.push(`${stats.added} added`);
			}

			if ((stats.modified ?? 0) > 0) {
				parts.push(`${stats.modified} modified`);
			}

			if ((stats.deleted ?? 0) > 0) {
				parts.push(`${stats.deleted} deleted`);
			}

			if ((stats.renamed ?? 0) > 0) {
				parts.push(`${stats.renamed} renamed`);
			}

			if (parts.length === 0) {
				return null;
			}

			return parts.join(', ');
		},
	};
}

function renderWipStatsBadge(stats: WipStats): TemplateResult {
	const added = stats.added ?? 0;
	// Renames are folded into modified — the shared `<commit-stats>` (add/edit/remove, like the rest of
	// GitLens) has no separate rename slot, and a rename is a modification for at-a-glance magnitude.
	const modified = (stats.modified ?? 0) + (stats.renamed ?? 0);
	const deleted = stats.deleted ?? 0;

	const total = added + modified + deleted;
	const label = `Working tree: ${total} change${total === 1 ? '' : 's'}`;

	// Right-aligned wrapper (see graph.scss); the dynamic `stale` opacity is the only inline style.
	const wrapStyle: StyleInfo = { opacity: stats.stale ? 0.55 : 1, transition: 'opacity 200ms linear' };

	return html`<span class="gl-graph__wip-stats" style=${cspStyleMap(wrapStyle)} aria-label=${label}>
		<commit-stats
			added=${added || nothing}
			modified=${modified || nothing}
			removed=${deleted || nothing}
			symbol="icons"
			appearance="pill"
			no-tooltip
		></commit-stats>
	</span>`;
}

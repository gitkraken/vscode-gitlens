import { colorForColumn } from '@gitkraken/commit-graph/colors.js';
import type { RowAdornment, RowAdornmentProvider } from '@gitkraken/commit-graph/engine/adornments.js';
import type { LaneSegment, ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { TemplateResult } from 'lit';
import { html } from 'lit';
import { cspStyleMap } from '../../../../shared/components/csp-style-map.directive.js';
import '../../../../shared/components/code-icon.js';

export interface LaneCollapseChipContext {
	segment: LaneSegment;
	branchHint?: string;
	column: number;
	isCollapsed: boolean;
	/** Actual number of commits currently hidden by this segment when collapsed. Differs
	 *  from `segment.commitShas.length - 1` when junction-preserving keeps some body
	 *  commits visible (e.g. fork points for other still-expanded lanes). When the segment
	 *  is expanded, this equals the number of commits that WOULD be hidden on collapse. */
	hiddenCount: number;
}

export interface LaneCollapseAdornmentOptions {
	/** Every collapsible segment, keyed by tip-commit sha. Includes both currently-collapsed
	 *  segments and currently-expanded segments — the provider emits a fold affordance for
	 *  both so the user always sees a discoverable click target on collapsible rows. */
	segmentsByTipSha: ReadonlyMap<Sha, LaneSegment>;
	/** Subset of `segmentsByTipSha` keys that are currently rendered as collapsed. */
	collapsedTips: ReadonlySet<Sha>;
	/** Per-segment-tip count of body commits that WOULD be hidden on collapse (or ARE
	 *  hidden right now, if the tip is in `collapsedTips`). Junction-preserving lowers
	 *  this below `commitShas.length - 1` when other lanes fork off inside the body. */
	hiddenCountByTipSha?: ReadonlyMap<Sha, number>;
	/** Optional branch-hint resolver — typically the segment tip's branch name when reffed. */
	branchHint?: (tipSha: Sha) => string | undefined;
}

/**
 * Adornment provider that places a fold chevron on every collapsible-segment tip row —
 * mirroring the IDE code-folding pattern (`▾` open, `▸` closed). Discoverable at rest
 * because the chevron is always visible on rows that can fold; familiar because the
 * symbol matches every other fold control users already know.
 *
 * Rendered placement is `'fold'` — the host paints these chevrons in a dedicated fold strip
 * on the left edge of the lanes (IDE code-folding gutter style). The toggle button carries
 * `data-lane-toggle-tip=${tipSha}`; the host resolves it via event delegation (walking
 * `composedPath`) and performs the expand/collapse — this provider stays a pure render
 * function and attaches no per-element listeners.
 *
 * The chevron is lane-colored so the eye traces lane → fold affordance. The hidden commit
 * count + (when known) branch name live in the tooltip — the narrow fold strip stays a clean
 * column of chevrons rather than a row of count chips.
 */
export function createLaneCollapseAdornmentProvider(
	options: LaneCollapseAdornmentOptions,
): RowAdornmentProvider<TemplateResult, LaneCollapseChipContext> {
	return {
		// 'fold' zone — the host renders these in the dedicated fold strip at the lanes' left edge.
		zone: 'fold',
		provideRowAdornment: function (row: ProcessedGraphRow): RowAdornment<LaneCollapseChipContext> | undefined {
			const segment = options.segmentsByTipSha.get(row.sha);
			if (segment === undefined) return undefined;

			const fallback = segment.commitShas.length - 1;
			const hiddenCount = options.hiddenCountByTipSha?.get(row.sha) ?? fallback;
			return {
				context: {
					segment: segment,
					branchHint: options.branchHint?.(segment.tipSha),
					column: row.column,
					isCollapsed: options.collapsedTips.has(row.sha),
					hiddenCount: hiddenCount,
				},
				dynamic: true,
			};
		},

		resolveAdornment: function (_row: ProcessedGraphRow, ctx?: LaneCollapseChipContext): TemplateResult | null {
			if (!ctx) {
				return null;
			}

			// Nothing to fold (every body commit is being preserved as a junction): suppress
			// the chevron entirely so we don't show a no-op control.
			if (ctx.hiddenCount <= 0) {
				return null;
			}

			return renderLaneFoldChevron(ctx);
		},

		describeForA11y: function (_row: ProcessedGraphRow, ctx?: LaneCollapseChipContext): string | null {
			if (!ctx) {
				return null;
			}

			if (ctx.hiddenCount <= 0) {
				return null;
			}

			const hidden = ctx.hiddenCount;
			const noun = hidden === 1 ? 'commit' : 'commits';
			if (ctx.isCollapsed) {
				return ctx.branchHint != null
					? `lane collapsed: ${hidden} ${noun} hidden in ${ctx.branchHint}`
					: `lane collapsed: ${hidden} ${noun} hidden`;
			}

			return ctx.branchHint != null
				? `lane expanded: ${hidden} ${noun} from ${ctx.branchHint} can be folded`
				: `lane expanded: ${hidden} ${noun} can be folded`;
		},
	};
}

function renderLaneFoldChevron(ctx: LaneCollapseChipContext): TemplateResult {
	const hidden = ctx.hiddenCount;
	const noun = hidden === 1 ? 'commit' : 'commits';
	const color = colorForColumn(ctx.column);
	const tipSha = ctx.segment.tipSha;

	// IDE code-folding gutter style: a single compact chevron in either state (right = collapsed,
	// down = expanded). The hidden-count + branch name go in the tooltip, not a visible chip — the
	// fold strip is only wide enough for the chevron.
	const label = ctx.isCollapsed
		? ctx.branchHint != null
			? `Click to expand ${hidden} hidden ${noun} from ${ctx.branchHint}`
			: `Click to expand ${hidden} hidden ${noun}`
		: ctx.branchHint != null
			? `Click to fold ${hidden} ${noun} in ${ctx.branchHint}`
			: `Click to fold ${hidden} ${noun} in this lane`;
	const ariaLabel = ctx.isCollapsed
		? ctx.branchHint != null
			? `Expand collapsed lane ${ctx.branchHint} (${hidden} ${noun} hidden)`
			: `Expand collapsed lane (${hidden} ${noun} hidden)`
		: ctx.branchHint != null
			? `Fold lane ${ctx.branchHint} (${hidden} ${noun})`
			: `Fold lane (${hidden} ${noun})`;

	return html`<button
		type="button"
		class=${ctx.isCollapsed ? 'lane-fold-chevron is-collapsed' : 'lane-fold-chevron'}
		tabindex="-1"
		data-lane-toggle-tip=${tipSha}
		data-tooltip=${label}
		aria-label=${ariaLabel}
		aria-expanded=${ctx.isCollapsed ? 'false' : 'true'}
		style=${cspStyleMap({ color: color })}
	>
		<code-icon icon=${ctx.isCollapsed ? 'chevron-right' : 'chevron-down'} aria-hidden="true"></code-icon>
	</button>`;
}

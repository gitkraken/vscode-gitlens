import { colorForColumn, contrastColor, withAlpha } from '@gitkraken/commit-graph/colors.js';
import type { RowAdornment, RowAdornmentProvider } from '@gitkraken/commit-graph/engine/adornments.js';
import type { ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import { relativeTime } from '@gitkraken/commit-graph/view.js';
import type { TemplateResult } from 'lit';
import { html, nothing } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GkProviderId } from '@gitlens/git/models/repositoryIdentities.js';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '@gitlens/git/utils/branch.utils.js';
import type {
	GraphDownstreams,
	GraphExcludeRefs,
	GraphExcludeTypes,
	IssueMetadata,
	PullRequestMetadata,
} from '../../../../../plus/graph/protocol.js';
import type { StyleInfo } from '../../../../shared/components/csp-style-map.directive.js';
import { cspStyleMap } from '../../../../shared/components/csp-style-map.directive.js';
import type { AutolinkIconStatus } from '../../../../shared/components/rich/utils.js';
import { getAutolinkIcon } from '../../../../shared/components/rich/utils.js';
import { refContextPinKey, refPillKey } from '../../utils/refKey.utils.js';
import type { RowMarkerRole, RowMarkerTips } from '../../utils/rowMarker.utils.js';
import { primaryRowMarkerRole, rowMarkerRolesFor, shortRefName } from '../../utils/rowMarker.utils.js';
import type { GraphCommitRef, GraphCommitView, RowRefOrder } from '../graph-commit.js';
import { isRefHidden, isUpstreamRemoteOf, sortRowRefs } from '../graph-commit.js';
import '../../../../shared/components/code-icon.js';
import '../../../../shared/components/overlays/popover.js';
import '../../../../shared/components/pills/tracking.js';

/** The pill's view model. Field names mirror `GraphCommitRef` so the shared ref helpers
 *  (`sortRowRefs`, `isUpstreamRemoteOf`) accept either shape without an adapter. */
export interface ParsedRef {
	kind: 'head' | 'remote' | 'tag';
	name: string;
	/** Stable ref id — keys upstream tracking metadata + locates the ref's row for the jump. */
	id?: string;
	/** True when this head is the current checkout (HEAD). */
	current?: boolean;
	/** Set when kind === 'remote'; the remote alias (e.g. "origin"). */
	owner?: string;
	/** The head's upstream branch identifier (drives the upstream ordering tiers). */
	upstreamName?: string;
	/** A head's upstream ref id — links a local branch to the remote it tracks (split pill). */
	upstreamId?: string;
	/** Set when this head is checked out in another worktree. */
	secondaryWorktreeId?: string;
	/** True when this head is the repo's default branch. */
	isDefault?: boolean;
	/** Remote-only: the hosting provider, when known — drives the ref pill's provider icon. */
	hostingServiceType?: GkProviderId;
	/** JSON-stringified `data-vscode-context` for this ref's pill. */
	context?: string;
}

/**
 * Live hooks the graph supplies so a tracked branch pill can render its upstream "split" segment
 * (ahead/behind stats) and jump to the linked ref's row. All read live graph state (metadata arrives
 * async; row positions change), so they're getters — never baked into the cached ref projection.
 */
export interface RefPillHooks {
	/** Ahead/behind for a tracked ref (from the lazily-fetched upstream metadata), or undefined if not
	 *  loaded. A remote resolves to its tracking local's metadata, read from the remote's perspective. */
	getUpstream: (ref: ParsedRef) => { ahead: number; behind: number } | undefined;
	/** The linked ref's row to jump to (a head's upstream remote, or a remote's tracking local) + the
	 *  vertical direction to it relative to `fromSha`'s row + the target's display name (for the tooltip).
	 *  Undefined when there's no linked row in view. */
	resolveJump: (ref: ParsedRef, fromSha: Sha) => { sha: Sha; direction: 'up' | 'down'; name?: string } | undefined;
	/** Scroll the target row into view and select it. */
	onJumpToRef: (sha: Sha) => void;
	/** The ref's associated pull requests (from the lazily-fetched metadata), keyed by the ref's own id
	 *  (a remote branch resolves its own PRs too — the host nulls whatever doesn't apply). */
	getPullRequests: (ref: ParsedRef) => PullRequestMetadata[] | undefined;
	/** The ref's associated issues (from the lazily-fetched metadata), keyed by the ref's own id. */
	getIssues: (ref: ParsedRef) => IssueMetadata[] | undefined;
	/** The id whose `refsMetadata` entry carries this ref's ahead/behind (a head's own id, or — for a
	 *  remote — its tracking local's id). Same id `getUpstream` resolves against; drives the upstream
	 *  segment's `data-ref-id` so a double-click there can look the raw metadata object back up. */
	getUpstreamMetadataId: (ref: ParsedRef) => string | undefined;
	/** `gitlens.graph.showRemoteNames` — when false (the default), a remote pill's label is the bare
	 *  branch name instead of `remote/name`. Read fresh (config can change at runtime). */
	getShowRemoteNames: () => boolean;
	/** `gitlens.graph.refs.maxInline` — maximum number of ref pills shown inline per row before the rest
	 *  collapse behind a +N counter, already RESOLVED (the `'auto'` setting derives this from the
	 *  available width; this hook always returns the resolved number). Read fresh (config/width can
	 *  change at runtime); the consumer clamps values to >= 1. Takes the row so a caller whose cap varies
	 *  PER ROW (the refs-own-line consumer: promoted rows resolve an 'auto' cap against the message zone's
	 *  width regardless of the setting; other rows keep the plain resolved value) can tell them apart —
	 *  a caller with one render-global cap simply ignores the argument. */
	getMaxInlineRefs?: (row: ProcessedGraphRow) => number;
	/** Id of the ref pinned to the edge (`gitlens.graph.pinBranchToEdge`), read live so a pin/unpin shows
	 *  up without a rebuild. Distinct from the CLICK-pinned ref (`getPinnedRefKey`) — that one is transient
	 *  focus, this one is persisted host state. Its pill takes the pin indicator + unpin control. */
	getPinnedRefId?: () => string | undefined;
	/** Clear the edge pin. Invoked from the pinned pill's own pin zone. */
	onUnpinRef?: () => void;
	/** The current worktree's row-marker tips (HEAD / upstream / merge-target shas + target name), read
	 *  live. A pill on a tip row takes that role's emphasis (`--row-marker-<role>` class); the HEAD pill also
	 *  gets the merge-target jump segment. Undefined until the client builds the tips. */
	getRowMarkerTips?: () => RowMarkerTips | undefined;
	/** Pill key (see {@link refPillKey}) of the ref the find widget last landed on, read live. That pill
	 *  wears the selected/hover fill for as long as the widget is open, so the ref you asked for is
	 *  identifiable among the others sharing its row. */
	getFindHitRefKey?: () => string | undefined;
	/** Pill key of the CLICK-pinned ref, read live. That pill stays expanded (`.is-pinned`) and keeps its
	 *  ancestry-chain highlight regardless of hover, until the pin is cleared or moved. */
	getPinnedRefKey?: () => string | undefined;
	/** {@link refContextPinKey} of the ref pill pinned open by a native context menu, read live. That pill
	 *  stays expanded (`.is-context-pinned`) for as long as the menu is up — the menu steals `:hover`, so
	 *  without this the pill would collapse mid-interaction. Distinct from `getPinnedRefKey`: transient to
	 *  the menu's lifetime, no ancestry-chain highlight, and jump-sha-qualified so the WIP-row proxy pill
	 *  and the real pill it mirrors stay distinguishable. */
	getContextPinnedRefKey?: () => string | undefined;
}

// Map the structured commit refs to the pill's view model, ALREADY in display order. A plain
// projection — NO lossy parsing of git-log token strings (the old `parseRefs` heuristic is gone); the
// metadata arrives intact from `toGraphCommit`, so the primary-ref ordering can be exact.
//
// Ordering happens HERE rather than at render so it rides the per-commit projection cache (once per
// commit, not once per render) and every consumer of the projection — pills, popover, the a11y
// description, the lane-tip ghost ref — sees the same order for free. `order` carries the inputs that
// AREN'T ref data (the two pins, HEAD's upstream); the caller must bust its cache when that object
// changes, which `createRefAdornmentProvider` does by identity.
//
// Exported for the WIP row's row-marker pill (`buildWipRowMarkerPill`), which projects the HEAD row's refs.
export function toParsedRefs(refs: readonly GraphCommitRef[], order?: RowRefOrder): ParsedRef[] {
	return sortRowRefs(refs, order).map(r => ({
		kind: r.kind,
		name: r.name,
		id: r.id,
		current: r.kind === 'head' ? r.current : undefined,
		owner: r.kind === 'remote' ? r.owner : undefined,
		upstreamName: r.upstreamName,
		upstreamId: r.upstreamId,
		secondaryWorktreeId: r.secondaryWorktreeId,
		isDefault: r.isDefault,
		hostingServiceType: r.hostingServiceType,
		context: r.context,
	}));
}

/** Live ref-visibility filter state (Hide branch / Hide Remotes·Tags), read fresh each rebuild.
 *  `downstreams` excepts a tracked-upstream remote from the type-level "Hide Remote Branches" toggle
 *  (see `isRefHidden`). */
export type RefExcludeState =
	| { excludeTypes?: GraphExcludeTypes; excludeRefs?: GraphExcludeRefs; downstreams?: GraphDownstreams }
	| undefined;

function hasActiveRefFilter(state: RefExcludeState): boolean {
	if (state == null) return false;

	const t = state.excludeTypes;
	if (t != null && (t.heads === true || t.remotes === true || t.tags === true)) return true;
	return state.excludeRefs != null && Object.keys(state.excludeRefs).length > 0;
}

/**
 * @param getRefOrder Returns the live ordering inputs that aren't ref data — the click pin, the edge
 * pin, and the current branch's upstream name. Ordering is tiered (see `sortRowRefs`): the click pin
 * and the current checkout both outrank the edge pin, so the edge-pinned ref is NOT guaranteed the
 * inline pill. Its indicator renders wherever it lands — the primary pill's leading slot, a +N
 * popover row, or the combined pill's upstream segment when it's an in-sync upstream. The host
 * recomputes adornments on pin/unpin and on a branch change so this re-applies.
 * @param getExcludeState Returns the active ref-visibility filters, read fresh on each adornments
 * rebuild. Hidden refs (by type or by id; current HEAD always kept) are filtered out of each row's
 * pills. The host recomputes adornments when these change so the filter re-applies.
 * @param getCommit Resolves a row's commit payload (rows are topology-only) — the structured refs
 * the pills render from live on the commit, not the engine row.
 */
export function createRefAdornmentProvider(
	getRefOrder: (() => RowRefOrder | undefined) | undefined,
	hooks: RefPillHooks | undefined,
	getExcludeState: (() => RefExcludeState) | undefined,
	getCommit: (sha: Sha) => GraphCommitView | undefined,
): RowAdornmentProvider<TemplateResult, ParsedRef[]> {
	// Cache the projection by the structured-refs array reference. `commitRefs` is stable per commit
	// (built once in toGraphCommit), so this avoids re-allocating the view model on every adornments
	// rebuild (which happens whenever a new provider list is built upstream — e.g. agent updates).
	let cache = new WeakMap<readonly GraphCommitRef[], ParsedRef[]>();
	// The ORDER is baked into the projection, and `commitRefs` survives a click-pin or branch change
	// untouched (only the edge pin rebuilds rows) — so the whole cache is dropped when the order object
	// changes. Identity is the signal: the client rebuilds it only when an input actually moved.
	let cachedOrder: RowRefOrder | undefined;
	const projectCached = (refs: readonly GraphCommitRef[]): ParsedRef[] => {
		const order = getRefOrder?.();
		if (order !== cachedOrder) {
			cache = new WeakMap();
			cachedOrder = order;
		}

		const hit = cache.get(refs);
		if (hit) return hit;

		const parsed = toParsedRefs(refs, order);
		cache.set(refs, parsed);
		return parsed;
	};

	return {
		zone: 'ref',
		provideRowAdornment: function (row: ProcessedGraphRow): RowAdornment<ParsedRef[]> | undefined {
			let refs = getCommit(row.sha)?.commitRefs;
			if (refs == null || refs.length === 0) return undefined;

			// When no filter is active the full per-commit array is reused (cache-friendly); otherwise
			// hidden refs are filtered out (fresh array per adorned row — refs are sparse across rows).
			const exclude = getExcludeState?.();
			if (hasActiveRefFilter(exclude)) {
				refs = refs.filter(
					r => !isRefHidden(r, exclude?.excludeTypes, exclude?.excludeRefs, exclude?.downstreams),
				);
				if (refs.length === 0) return undefined;
			}

			return { context: projectCached(refs) };
		},

		resolveAdornment: function (row: ProcessedGraphRow, parsed?: ParsedRef[]): TemplateResult | null {
			if (!parsed || parsed.length === 0) return null;

			// A row always shows at least one pill, whatever the setting says.
			const cap = Math.max(1, hooks?.getMaxInlineRefs?.(row) ?? 1);
			return renderRefPill(parsed, colorForColumn(row.column), row.sha, hooks, undefined, cap);
		},

		describeForA11y: function (_row: ProcessedGraphRow, parsed?: ParsedRef[]): string | null {
			if (!parsed || parsed.length === 0) return null;

			// Announce in the SAME order the pills render — `parsed` arrives fully display-sorted, pins
			// included, so a screen reader hears the pinned ref first exactly as it's drawn.
			return parsed.map(r => describeRef(r, hooks)).join(', ');
		},
	};
}

/**
 * Lane-colored chip styling, expressed as CSS custom properties (NOT direct color/bg/border) so
 * the stylesheet owns the resting AND hover states — an inline `color`/`background` would beat the
 * `:hover` rule. `graph.scss` reads `--ref-color` / `--ref-bg` / `--ref-border` (the hover state's
 * readable text is handled in CSS via white + a text-shadow outline, so no per-ref contrast color
 * is computed here). Returned as a `StyleInfo` for `styleMap` (the graph webview CSP forbids inline
 * `style` attrs; `styleMap` writes through the CSSOM). HEAD-marked refs get a filled tint + solid
 * lane border; others get a transparent fill with a softer lane border. Pills + popover rows share
 * the same border strength so the popover items read as the same outlined chips as the inline pill.
 */
function refStyle(color: string, isHead: boolean, _variant: 'pill' | 'row'): StyleInfo {
	return {
		'--ref-color': color,
		// Black/white contrast color for text/icons on the FILLED expand overlay (no halo needed).
		'--ref-on-color': contrastColor(color),
		'--ref-bg': isHead ? withAlpha(color, 0.15) : 'transparent',
		'--ref-border': isHead ? color : withAlpha(color, 0.6),
	};
}

// Glyph + tone for a pull request, from the shared resolver every other surface uses. Kept behind a local
// wrapper only to normalize `state`: `PullRequestMetadata.state` is widened to `string`, so the case has to
// be pinned somewhere — doing it here means the resolver still sees the union it expects.
//
// On the PILL the glyph carries state ALONE: the chip sits on the ref's fill, which is the branch's lane
// color, so a tinted icon there is a contrast lottery. The hover card, on the tooltip's own background,
// does take the tone.
//
// An absent state pins to 'opened': the resolver's own default is 'merged' (see pr-icon.ts's identical guard).
function pullRequestGlyph(pr: PullRequestMetadata): { icon: string; modifier: string } {
	return getAutolinkIcon('pr', (pr.state?.toLowerCase() as AutolinkIconStatus) ?? 'opened', pr.isDraft);
}

/**
 * First PR/issue metadata item for a pill, resolved from whichever ref actually carries it: the
 * primary ref, or — mirroring `renderUpstreamSegment`'s pairing — its in-sync upstream counterpart
 * on this row (a remote-only branch's PR/issue metadata is keyed on the remote's own id).
 */
function firstRefMetadata<T>(
	hooks: RefPillHooks | undefined,
	getList: (hooks: RefPillHooks, ref: ParsedRef) => T[] | undefined,
	primary: ParsedRef,
	pairedUpstream?: ParsedRef,
): { ref: ParsedRef; item: T } | undefined {
	if (hooks == null) return undefined;

	const primaryList = getList(hooks, primary);
	if (primaryList != null && primaryList.length > 0) return { ref: primary, item: primaryList[0] };

	if (pairedUpstream != null) {
		const pairedList = getList(hooks, pairedUpstream);
		if (pairedList != null && pairedList.length > 0) return { ref: pairedUpstream, item: pairedList[0] };
	}
	return undefined;
}

// PR/issue chips: a compact, same-height addendum to the pill (mirrors `.gl-graph__ref-pill-upstream`'s
// divider treatment). `expanded` false (resting pill) renders icon-only — the id/label text only shows
// in the hover-expand overlay copy (`expanded: true`) — but the aria-label and ALL data attributes stay
// on both copies (double-click routing + a11y never depend on which copy is on screen). Data attributes
// match the pill's own (`data-ref-name`/`-kind`/`-remote`/`-is-head`/`-vscode-context`) plus a
// `data-ref-metadata-type` discriminator, so a later double-click-routing pass can resolve both the
// metadata item AND the owning ref (host guard needs `ref.context`) from this chip.

/**
 * The pull-request hover card. Rendered by the graph's ONE delegated tooltip rather than by a popover per
 * chip — the chip only marks itself with `data-ref-metadata-type` + `data-ref-id`, and the host looks the
 * metadata back up. Exported for that resolver.
 */
export function renderPullRequestTooltipCard(pr: PullRequestMetadata): TemplateResult {
	const label = `#${pr.id}`;
	const { icon, modifier } = pullRequestGlyph(pr);
	// The date is whichever of merged/closed/updated applies (see the producer), so it MUST be labelled by
	// state — unlabelled, the same "2 hours ago" silently means three different things. Likewise the name
	// is the pull request's author, never an assignee, and "Opened by" holds for every state.
	const verb = modifier === 'pr-merged' ? 'merged' : modifier === 'pr-closed' ? 'closed' : 'updated';
	const author = pr.author ? `Opened by ${pr.author}` : undefined;
	const when =
		pr.date != null
			? // Reads as one sentence after the author; capitalized only when it has to lead the line.
				`${author == null ? `${verb[0].toUpperCase()}${verb.slice(1)}` : verb} ${relativeTime(pr.date)}`
			: undefined;
	const meta = [author, when].filter((v): v is string => v != null && v.length > 0);

	return html`<div class="gl-graph__ref-metadata-card">
		<div class="gl-graph__ref-metadata-card-head">
			<code-icon
				class="gl-graph__ref-metadata-card-icon gl-graph__ref-metadata-card-icon--${modifier}"
				icon=${icon}
			></code-icon>
			<span class="gl-graph__ref-metadata-card-title">${pr.title}</span>
			<span class="gl-graph__ref-metadata-card-id">${label}</span>
		</div>
		${meta.length > 0 ? html`<div class="gl-graph__ref-metadata-card-meta">${meta.join(' · ')}</div>` : nothing}
		${
			pr.stack != null
				? html`<div class="gl-graph__ref-metadata-card-stack">
						<code-icon icon="layers"></code-icon>Stack #${pr.stack.number}<span
							class="gl-graph__ref-metadata-card-stack-box"
							>${pr.stack.position}/${pr.stack.size}</span
						>
					</div>`
				: nothing
		}
	</div>`;
}

/** The issue hover card. Same delegated-tooltip contract as {@link renderPullRequestTooltipCard}. */
export function renderIssueTooltipCard(issue: IssueMetadata): TemplateResult {
	return html`<div class="gl-graph__ref-metadata-card">
		<div class="gl-graph__ref-metadata-card-head">
			<code-icon class="gl-graph__ref-metadata-card-icon" icon="issues"></code-icon>
			<span class="gl-graph__ref-metadata-card-title">${issue.title}</span>
			<span class="gl-graph__ref-metadata-card-id">${issue.displayId}</span>
		</div>
		<div class="gl-graph__ref-metadata-card-meta">${issue.issueTrackerType}</div>
	</div>`;
}

function renderPrChip(pr: PullRequestMetadata, ref: ParsedRef, expanded: boolean): TemplateResult {
	const label = `#${pr.id}`;
	return html`<span
		class="gl-graph__ref-pill-pr"
		role="button"
		tabindex=${
			// Only the in-flow copy roves; the expanded-twin copy sits in an aria-hidden subtree, where a
			// click-focusable element would put focus inside hidden-from-AT content.
			expanded ? nothing : '-1'
		}
		aria-label=${
			pr.stack != null
				? `Pull request ${label}, layer ${pr.stack.position} of ${pr.stack.size}`
				: `Pull request ${label}`
		}
		data-ref-metadata-type="pullRequest"
		data-ref-id=${ref.id ?? nothing}
		data-ref-name=${ref.name}
		data-ref-kind=${ref.kind}
		data-ref-remote=${ref.owner ?? nothing}
		data-ref-is-head=${ref.current ? 'true' : nothing}
		data-vscode-context=${ref.context ?? nothing}
	>
		<code-icon icon=${pullRequestGlyph(pr).icon}></code-icon
		>${expanded ? html`<span class="gl-graph__ref-pill-chip-id">${label}</span>` : nothing}${
			// Icon, id, then the layer count, hard against each other — the three read as one identifier
			// rather than as a pill with something appended to it.
			pr.stack != null
				? html`<span class="gl-graph__ref-pill-stack" aria-hidden="true"
						>${pr.stack.position}/${pr.stack.size}</span
					>`
				: nothing
		}
	</span>`;
}

function renderIssueChip(issue: IssueMetadata, ref: ParsedRef, expanded: boolean): TemplateResult {
	const label = issue.displayId;
	return html`<span
		class="gl-graph__ref-pill-issue"
		role="button"
		tabindex=${
			// Same as the PR chip: rove only the in-flow copy, never the aria-hidden expanded twin.
			expanded ? nothing : '-1'
		}
		aria-label="Issue ${label}"
		data-ref-metadata-type="issue"
		data-ref-id=${ref.id ?? nothing}
		data-ref-name=${ref.name}
		data-ref-kind=${ref.kind}
		data-ref-remote=${ref.owner ?? nothing}
		data-ref-is-head=${ref.current ? 'true' : nothing}
		data-vscode-context=${ref.context ?? nothing}
	>
		<code-icon icon="issues"></code-icon>${
			expanded ? html`<span class="gl-graph__ref-pill-chip-id">${label}</span>` : nothing
		}
	</span>`;
}

/** RowMarker options for the pill. `role` forces the role emphasis (the WIP-row pill, which sits on a
 *  different sha than HEAD, passes `'head'`); otherwise the role is derived from `fromSha` against the
 *  live tips. `expandAnchor: 'right'` right-anchors the hover-expand overlay (the WIP row's far-right slot
 *  clips a left-anchored one). `muted` softens the role emphasis to a tint (the WIP-row pill, so it reads
 *  as secondary to the real on-tip-row pill). `jumpSha` makes a plain click JUMP to that sha (scroll +
 *  select) instead of pinning — rendered as `data-jump-sha`, which onClick handles early (jump +
 *  stopPropagation), so the WIP pill navigates to the branch tip without opening its sheet. */
export interface RefPillRowMarker {
	role?: RowMarkerRole;
	expandAnchor?: 'left' | 'right';
	muted?: boolean;
	jumpSha?: Sha;
	/** Names the branch's tracked upstream (provider glyph + remote) in place of the ahead/behind segment.
	 *  The WIP-row pill is a navigation proxy, so it says WHERE the branch pushes rather than how far it's
	 *  drifted — the counts belong to the row's hover. Same treatment as the overview bar's upstream leg.
	 *  `hostingServiceType` is only known once the upstream's row has paged in; without it the segment falls
	 *  back to the generic cloud glyph rather than waiting. `jumpSha` (the upstream tip, likewise only once
	 *  loaded) turns the segment into a jump button. */
	upstream?: { name: string; hostingServiceType?: GkProviderId; jumpSha?: Sha };
	/** Suppresses the pinned-ref indicator / unpin control in the leading glyph slot. Set by the WIP-row
	 *  proxy pill, whose contract is jump-ONLY: a second interactive zone there would give a pill that exists
	 *  to navigate a competing action, and it would unpin from a surface that never offered to pin. The
	 *  graph's own row pills are where the edge pin is shown and cleared. */
	suppressPinControl?: boolean;
	/** Icons-only: no label text, ever, and no hover-expand overlay. The name lives only in the tooltip
	 *  (`data-tooltip` on `.gl-graph__ref-pill-main`). Set by the WIP-row proxy pill. */
	iconsOnly?: boolean;
}

/** A resting pill's typical footprint (icon + a medium branch name), in CSS px. A heuristic, not a
 *  measurement — no pill is actually laid out to derive this. CSS shrinks pills under real crowding, so
 *  both under- and over-estimates are absorbed by that shrink rather than causing overflow. */
const assumedRefPillWidth = 110;

/** Derives `gitlens.graph.refs.maxInline`'s `'auto'` cap from the width available to ref pills: how many
 *  {@link assumedRefPillWidth}-wide pills fit, clamped to the setting's [1, 10] range. Non-finite or
 *  non-positive widths (not yet measured) fall back to 1 rather than 0, so a row always shows its top ref. */
export function resolveAutoRefPillCap(availableWidth: number): number {
	if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 1;

	return Math.min(10, Math.max(1, Math.floor(availableWidth / assumedRefPillWidth)));
}

/** One pill's refs: the ref that names it, plus the in-sync upstream remote folded into its upstream
 *  segment (see {@link partitionRowRefs}). */
export interface RowRefUnit {
	ref: ParsedRef;
	upstreamOnRow: ParsedRef | undefined;
}

/**
 * Split a row's ordered refs into the pills that render inline and the refs that collapse behind the +N
 * badge. `parsed` arrives fully ordered (see `toParsedRefs` → `sortRowRefs`), pins included — nothing is
 * reordered here; `cap` (`gitlens.graph.refs.maxInline`) only decides how many refs get their own pill.
 *
 * In-sync combine: when a head's upstream remote is ALSO on this row (same commit ⇒ in sync), it's
 * absorbed into that head's upstream segment instead of being listed separately, so the pair reads as one
 * combined pill. Absorption is ONE pass over the whole list — heads ascending, each taking the first
 * not-yet-absorbed remote it tracks — so an inline pill and a `+N` popover row pair up by the same rule.
 * The refs left over are the "units": the first `cap` render as sibling pills, the rest fold into the
 * badge, each still carrying its absorbed remote (`upstreamFor`) so the expanded rows combine too.
 *
 * ⚠ The ref at index 0 is never absorbed. `sortRowRefs` already ranks an in-sync remote by its LOCAL (see
 * `carrierFor`), so a remote that still lands first is one the row is explicitly focused on — a
 * click-pinned remote, which is ranked by ITSELF. Folding it into a lower-ranked local would demote the
 * very ref the click asked for.
 *
 * An UNTRACKED head matches any co-located remote sharing its bare name (`isUpstreamRemoteOf`'s last
 * fallback), so several refs on this row can satisfy the predicate — a fork topology with both
 * `origin/main` and `upstream/main` on an untracked local `main`. `sortRowRefs` resolved the find hit
 * against a specific ref; picking a different one for the FIRST pill would leave the searched remote
 * outside the combined pill entirely, rendered as an unmarked `+N` row. So that pill prefers the searched
 * ref when it's one of the candidates. Deeper heads take first-match instead: their absorbed remote has
 * nowhere to wear the find fill (a popover row is marked by its OWN key, see `renderPopoverRefRow`), so
 * the searched ref is better off listed on its own.
 */
export function partitionRowRefs(
	parsed: ParsedRef[],
	cap: number,
	findHitRefKey: string | undefined,
): { visible: RowRefUnit[]; rest: ParsedRef[]; upstreamFor: Map<ParsedRef, ParsedRef> } {
	const upstreamFor = new Map<ParsedRef, ParsedRef>();
	const absorbed = new Set<ParsedRef>();
	for (let i = 0; i < parsed.length; i++) {
		const head = parsed[i];
		if (head.kind !== 'head') continue;

		const preferFindHit = i === 0 && findHitRefKey != null;
		let match: ParsedRef | undefined;
		// From index 1: the row's top-ranked ref is never absorbed.
		for (let j = 1; j < parsed.length; j++) {
			const remote = parsed[j];
			if (absorbed.has(remote) || !isUpstreamRemoteOf(remote, head)) continue;

			if (!preferFindHit) {
				match = remote;
				break;
			}

			// The first pill scans past a match for the searched ref; every other head takes the first.
			if (refPillKey(remote) === findHitRefKey) {
				match = remote;
				break;
			}

			match ??= remote;
		}
		if (match == null) continue;

		upstreamFor.set(head, match);
		absorbed.add(match);
	}

	const units = absorbed.size > 0 ? parsed.filter(r => !absorbed.has(r)) : parsed;
	const rest = units.slice(cap);

	return {
		visible: units.slice(0, cap).map(r => ({ ref: r, upstreamOnRow: upstreamFor.get(r) })),
		rest: rest,
		upstreamFor: upstreamFor,
	};
}

/** The per-pill inputs {@link renderOnePill} can't derive from its own ref. The ROW-level pieces are each
 *  assigned to a single pill by {@link renderRefPill}: the row-marker emphasis + merge-target segment ride
 *  the FIRST visible pill (the row sits on one tip, not one per ref), the overflow badge and the popover's
 *  `aria-haspopup` the LAST. */
interface RefPillOptions {
	/** The in-sync upstream remote absorbed into this pill's upstream segment. */
	upstreamOnRow: ParsedRef | undefined;
	showRemoteNames: boolean;
	edgePinnedId: string | undefined;
	findHitRefKey: string | undefined;
	emphasisRole: RowMarkerRole | undefined;
	targetSha: Sha | undefined;
	targetName: string | undefined;
	/** The +N/tag badge, rendered in the in-flow pill AND its expand-overlay copy. */
	moreBadge: TemplateResult | typeof nothing;
	/** Whether this pill anchors the +N popover. */
	hasPopover: boolean;
	/** The WIP-row proxy pill's contract (jump / icons-only / pin suppression) — that path renders a single
	 *  pill, so this never reaches a secondary one. */
	rowMarker: RefPillRowMarker | undefined;
}

export function renderRefPill(
	parsed: ParsedRef[],
	color: string,
	fromSha?: Sha,
	hooks?: RefPillHooks,
	rowMarker?: RefPillRowMarker,
	cap = 1,
): TemplateResult {
	const findHitRefKey = hooks?.getFindHitRefKey?.();
	const { visible, rest, upstreamFor } = partitionRowRefs(parsed, cap, findHitRefKey);
	const restCount = rest.length;
	const edgePinnedId = hooks?.getPinnedRefId?.();

	// RowMarker role emphasis: a pill on a HEAD / upstream / merge-target tip row takes that role's fill
	// (color via the `--row-marker-<role>` class in graph.scss; the border stays the lane color). Derived from
	// `fromSha` against the live tips, unless the caller forces it (the WIP-row pill).
	const tips = hooks?.getRowMarkerTips?.();
	const derivedRoleMask =
		rowMarker?.role == null && tips != null && fromSha != null ? rowMarkerRolesFor(fromSha, tips) : 0;
	const role = rowMarker?.role ?? (derivedRoleMask !== 0 ? primaryRowMarkerRole(derivedRoleMask) : undefined);
	// The HEAD pill also carries the merge-target jump segment (the current branch's target, from the tips).
	const targetSha = role === 'head' ? tips?.targetSha : undefined;
	// Only HEAD and upstream take the colored emphasis — a merge-target (or base) row's pill stays an ORDINARY
	// lane-colored ref pill. Those rows are already called out by the rail + their marker chip, and recoloring
	// the branch pill there implied the pill itself was the target rather than just sitting on that commit.
	const emphasisRole = role === 'head' || role === 'upstream' ? role : undefined;

	// +N badge(s): hidden TAGS are counted separately from other hidden refs so the tag count is
	// unambiguous (`🏷+1` = exactly one tag) rather than lumped into a generic total that reads as "+N
	// tags". Non-tag overflow keeps the plain `+N`; a tag badge (tag glyph + count) is appended when the
	// group hides any tags. Both render together when the group hides a mix.
	const tagCount = rest.reduce((n, r) => (r.kind === 'tag' ? n + 1 : n), 0);
	const otherCount = restCount - tagCount;
	// Wrapped in a group so a single divider rule separates the overflow badges from the rest of the pill.
	const moreBadge =
		otherCount > 0 || tagCount > 0
			? html`<span class="gl-graph__ref-pill-more-group" aria-hidden="true"
					>${otherCount > 0 ? html`<span class="gl-graph__ref-pill-more">+${otherCount}</span>` : nothing}${
						tagCount > 0
							? html`<span class="gl-graph__ref-pill-more gl-graph__ref-pill-more--tags"
									><code-icon icon="tag"></code-icon>+${tagCount}</span
								>`
							: nothing
					}</span
				>`
			: nothing;

	// The visible refs render as sibling pills (`.gl-graph__refs` is the flex row that spaces them).
	const showRemoteNames = hooks?.getShowRemoteNames() === true;
	const last = visible.length - 1;
	// The head-role emphasis (and its merge-target segment) rides the CURRENT branch's pill when that pill
	// is visible — a click pin can promote another ref to the first slot, and painting THAT pill as HEAD
	// while the real HEAD pill sits beside it reads as the wrong branch being checked out. Falls back to
	// the first pill when the current branch is folded or hidden. The upstream role stays on the first
	// pill: on the upstream tip row `sortRowRefs` ranks the tracked remote near the top, so the first slot
	// is that remote in every ordinary layout, and the tips carry no name to match a deeper pill by.
	const emphasisIndex =
		role === 'head'
			? Math.max(
					0,
					visible.findIndex(u => u.ref.current === true),
				)
			: 0;
	const pills = visible.map((unit, i) =>
		renderOnePill(unit.ref, color, fromSha, hooks, {
			upstreamOnRow: unit.upstreamOnRow,
			showRemoteNames: showRemoteNames,
			edgePinnedId: edgePinnedId,
			findHitRefKey: findHitRefKey,
			emphasisRole: i === emphasisIndex ? emphasisRole : undefined,
			targetSha: i === emphasisIndex ? targetSha : undefined,
			targetName: tips?.targetName,
			moreBadge: i === last ? moreBadge : nothing,
			hasPopover: i === last && restCount > 0,
			rowMarker: i === 0 ? rowMarker : undefined,
		}),
	);

	// Nothing hidden → bare pills. A pill's hover-expand overlay is absolutely positioned and must escape
	// the row to paint over the message; a wrapping <gl-popover>'s shadow DOM clips it (that was the
	// "pills don't expand" regression). Branch focus lives on the branch sheet (click the pill), so a pill
	// that hides nothing needs no popover — which is why only the LAST one below is ever wrapped.
	if (restCount === 0) return last === 0 ? pills[0] : html`${pills}`;

	// Match the React HoverCard timings: openDelay 120ms, closeDelay 180ms. `hoist` lets the
	// popover escape the row's `contain: layout`. stopPropagation on the content keeps clicks
	// from bubbling to the row (selection / context menu).
	return html`${pills.slice(0, last)}<gl-popover
			class="gl-graph__ref-popover"
			hoist
			.arrow=${false}
			placement="bottom-start"
			trigger="hover focus"
			.distance=${1}
			style=${cspStyleMap({ '--show-delay': '120ms', '--hide-delay': '180ms', '--wa-tooltip-padding': '0' })}
		>
			<span slot="anchor" class="gl-graph__ref-popover-anchor">${pills[last]}</span>
			<div slot="content" class="gl-graph__ref-popover-list" role="menu" @mousedown=${stopEvent}>
				${rest.map(r =>
					renderPopoverRefRow(
						r,
						color,
						r.context,
						fromSha,
						hooks,
						upstreamFor.get(r),
						edgePinnedId != null && r.id === edgePinnedId && rowMarker?.suppressPinControl !== true,
					),
				)}
			</div>
		</gl-popover>`;
}

function renderOnePill(
	ref: ParsedRef,
	color: string,
	fromSha: Sha | undefined,
	hooks: RefPillHooks | undefined,
	options: RefPillOptions,
): TemplateResult {
	const { upstreamOnRow, rowMarker } = options;
	const isHead = ref.current === true;
	// The pill's leading glyph becomes the pin when its ref is pinned to the edge (see `renderLeadingSlot`).
	// Only ever true for one ref in the graph.
	const edgePinned =
		options.edgePinnedId != null && ref.id === options.edgePinnedId && rowMarker?.suppressPinControl !== true;

	const targetSegment =
		options.targetSha != null ? renderTargetSegment(options.targetSha, options.targetName, hooks, false) : nothing;
	const targetSegmentExpanded =
		options.targetSha != null ? renderTargetSegment(options.targetSha, options.targetName, hooks, true) : nothing;

	// The find-hit class marks the PILL that contains the matched ref. That's normally the ref naming the
	// pill, but `sortRowRefs` carries an in-sync remote match on its LOCAL (so the pair still combines into
	// one pill) — the class then has to match against the absorbed remote's key instead, via `upstreamOnRow`.
	// The WIP-row proxy pill (`rowMarker.jumpSha` set) is excluded for the same reason as the pins below: it
	// re-renders the HEAD row's refs under the SAME key, so a hit on the current branch would mark a SECOND
	// pill the finder never landed on — and, since `--find-hit` now forces the expand overlay open, leave it
	// expanded over the WIP row's message for the finder's whole session.
	const isFindHit =
		rowMarker?.jumpSha == null &&
		options.findHitRefKey != null &&
		(options.findHitRefKey === refPillKey(ref) ||
			(upstreamOnRow != null && options.findHitRefKey === refPillKey(upstreamOnRow)));
	// The click-pinned ref only ever lands on the FIRST pill (unlike the find hit / edge pin, it has no
	// carrier substitution — `sortRowRefs` ranks a pinned remote by itself, so it's promoted outright), but
	// the key match is per-pill either way. The WIP-row proxy pill (`rowMarker.jumpSha` set) is excluded: it
	// renders the HEAD row's refs under the SAME pill key, and its contract is jump-only — it never earned
	// the pin.
	const isPinned =
		rowMarker?.jumpSha == null && hooks?.getPinnedRefKey?.() != null && hooks.getPinnedRefKey() === refPillKey(ref);
	// Unlike the click pin, the WIP-row proxy pill is NOT excluded: it is right-clickable and must stay
	// expanded for its own menu's lifetime. Matched through `refContextPinKey`, which qualifies the key by
	// the jump sha, so the proxy and the real HEAD-row pill (identical `refPillKey`) can't be confused for
	// one another.
	const isContextPinned =
		hooks?.getContextPinnedRefKey?.() != null &&
		hooks.getContextPinnedRefKey() === refContextPinKey(refPillKey(ref), rowMarker?.jumpSha);
	const rowMarkerClass = `${
		options.emphasisRole != null ? ` gl-graph__ref-pill--row-marker-${options.emphasisRole}` : ''
	}${options.emphasisRole != null && rowMarker?.muted === true ? ' gl-graph__ref-pill--row-marker-muted' : ''}${
		rowMarker?.expandAnchor === 'right' ? ' gl-graph__ref-pill--expand-right' : ''
	}${isFindHit ? ' gl-graph__ref-pill--find-hit' : ''}${isPinned ? ' is-pinned' : ''}${
		isContextPinned ? ' is-context-pinned' : ''
	}${rowMarker?.iconsOnly === true ? ' gl-graph__ref-pill--icons-only' : ''}`;
	// Split-pill upstream segment: the ref's tracked counterpart — its upstream remote when in sync
	// on this row (combined, no jump), or on ANOTHER row when out of sync (ahead/behind + a jump button).
	// A row-marker pill that carries `upstream` opts out of both and just NAMES the remote instead.
	let upstreamSegment: TemplateResult | typeof nothing;
	if (rowMarker?.upstream != null) {
		upstreamSegment = renderNamedUpstreamSegment(ref, rowMarker.upstream, hooks, rowMarker?.iconsOnly === true);
	} else {
		upstreamSegment =
			fromSha != null
				? renderUpstreamSegment(
						ref,
						fromSha,
						hooks,
						upstreamOnRow,
						undefined,
						rowMarker?.suppressPinControl !== true,
					)
				: nothing;
	}

	// PR/issue chips: first item only — a pill has room for a single badge of each kind.
	// Rendered twice — icon-only for the resting pill, icon+label for the hover-expand overlay copy below.
	const prMeta = firstRefMetadata(hooks, (h, r) => h.getPullRequests(r), ref, upstreamOnRow);
	const prChip = prMeta != null ? renderPrChip(prMeta.item, prMeta.ref, false) : nothing;
	const prChipExpanded = prMeta != null ? renderPrChip(prMeta.item, prMeta.ref, true) : nothing;
	const issueMeta = firstRefMetadata(hooks, (h, r) => h.getIssues(r), ref, upstreamOnRow);
	const issueChip = issueMeta != null ? renderIssueChip(issueMeta.item, issueMeta.ref, false) : nothing;
	const issueChipExpanded = issueMeta != null ? renderIssueChip(issueMeta.item, issueMeta.ref, true) : nothing;

	// Icon and label form a shrinkable group so a long branch name truncates. The +N badge sits
	// outside the truncating group with flex-shrink:0 — the name ellipsises but the badge stays.
	// When the pill is shrunk to its icon, hovering reveals the full name (+ the +N badge, on the pill
	// carrying it) via an absolutely-positioned overlay (`-expand`) that sits ON TOP of the message
	// (no reflow — the in-flow box is untouched). The overlay renders for EVERY pill so its own ref's
	// name always expands on hover; the popover (on the last pill) lists the refs that don't fit.
	//
	// The WIP-row pill is a PROXY for the HEAD branch pill shown on the WIP row: `data-jump-sha` makes a click
	// JUMP to the HEAD tip (scroll + select) via the same `gl-jump-to-commit` path the WIP details header's
	// jump button uses — onClick handles it early (jump + stopPropagation), so the pill navigates to the branch WITHOUT pinning
	// or opening its sheet. That makes the NAME half a jump zone in its own right, so it takes the same lit-up
	// band + "Jump to …" tooltip the upstream/merge-target segments carry — otherwise the pill's largest zone
	// was the only one that never signalled where it goes. Tooltip wording mirrors the overview bar's legs.
	const nameJump = rowMarker?.jumpSha != null;
	const nameTip = nameJump ? `Jump to HEAD (${ref.name})` : undefined;
	// The overlay copy's name zone needs the same wrapper to hang that band on (the resting pill has `-main`);
	// only built for the jump case so every other pill's overlay markup is untouched.
	// Rendered into BOTH the in-flow pill and the hover-expand overlay — the overlay is `pointer-events:
	// auto` and covers the pill once hovered, so a control present only in the pill could never be clicked.
	// Same duplication the upstream / target / PR / issue segments already rely on.
	const leadingSlot = renderLeadingSlot(ref, edgePinned, hooks);
	const expandName = html`${leadingSlot}<span class="gl-graph__ref-pill-expand-label"
			>${chipLabel(ref, options.showRemoteNames)}</span
		>`;
	return html`<span
		class="gl-graph__ref-pill${rowMarkerClass}"
		style=${cspStyleMap(refStyle(color, isHead, 'pill'))}
		role="button"
		tabindex="-1"
		aria-label=${describeRef(ref, hooks)}
		aria-haspopup=${options.hasPopover ? 'menu' : nothing}
		data-jump-sha=${rowMarker?.jumpSha ?? nothing}
		data-ref-name=${ref.name}
		data-ref-key=${refPillKey(ref)}
		data-ref-kind=${ref.kind}
		data-ref-remote=${ref.owner ?? nothing}
		data-ref-is-head=${ref.current ? 'true' : nothing}
		data-vscode-context=${ref.context ?? nothing}
	>
		<span
			class="gl-graph__ref-pill-main${nameJump ? ' gl-graph__ref-pill-main--jump' : ''}"
			data-tooltip=${nameTip ?? nothing}
		>
			${leadingSlot}${
				rowMarker?.iconsOnly === true
					? nothing
					: html`<span class="gl-graph__ref-pill-label">${chipLabel(ref, options.showRemoteNames)}</span>`
			}
		</span>
		${upstreamSegment}${targetSegment}${prChip}${issueChip}${options.moreBadge}
		${
			rowMarker?.iconsOnly === true
				? nothing
				: html`<span class="gl-graph__ref-pill-expand" aria-hidden="true"
						>${
							nameJump
								? html`<span
										class="gl-graph__ref-pill-expand-name gl-graph__ref-pill-main--jump"
										data-tooltip=${nameTip}
										>${expandName}</span
									>`
								: expandName
						}${upstreamSegment}${targetSegmentExpanded}${prChipExpanded}${issueChipExpanded}${
							options.moreBadge
						}</span
					>`
		}
	</span>`;
}

// Contextual jump tooltip, returned in two forms:
//  - `label`: the VISUAL tooltip body shown after "Jump to <cloud|vm icon>" — the branch + the non-zero
//    ahead/behind summary (behind first, matching the stats pill), e.g. "origin/main · 18 behind, 1 ahead".
//  - `aria`: the accessible name (the icon isn't readable), spelling the side out — e.g. "Jump to Upstream
//    origin/main · 18 behind, 1 ahead". Diverged branches list both counts; clean ones just one.
function jumpTooltip(
	targetType: 'Upstream' | 'Local',
	name: string | undefined,
	stats: { ahead: number; behind: number } | undefined,
): { label: string; aria: string } {
	const branch = name != null && name.length > 0 ? name : `${targetType.toLowerCase()} branch`;
	const parts: string[] = [];
	if (stats != null) {
		if (stats.behind > 0) {
			parts.push(`${stats.behind} behind`);
		}
		if (stats.ahead > 0) {
			parts.push(`${stats.ahead} ahead`);
		}
	}
	const label = parts.length > 0 ? `${branch} · ${parts.join(', ')}` : branch;
	return { label: label, aria: `Jump to ${targetType} ${label}` };
}

// Tooltip for the non-interactive ahead/behind status (counterpart not reachable for a jump) — same
// "<branch> · N behind, M ahead" body as the jump tooltip but WITHOUT the "Jump to" action.
function upstreamStatusTooltip(
	targetType: 'Upstream' | 'Local',
	name: string | undefined,
	stats: { ahead: number; behind: number } | undefined,
): { label: string; aria: string } {
	const branch = name != null && name.length > 0 ? name : `${targetType.toLowerCase()} branch`;
	const parts: string[] = [];
	if (stats != null) {
		if (stats.behind > 0) {
			parts.push(`${stats.behind} behind`);
		}
		if (stats.ahead > 0) {
			parts.push(`${stats.ahead} ahead`);
		}
	}
	const label = parts.length > 0 ? `${branch} · ${parts.join(', ')}` : branch;
	return { label: label, aria: `${targetType} ${label}` };
}

/**
 * The split pill's upstream segment, linking the primary ref to its tracked counterpart:
 *  - IN SYNC (`upstreamOnRow` set — the upstream remote sits on this same row): a static combined
 *    segment with the cloud glyph + a sync indicator, NOT clickable (nothing to navigate to).
 *  - OUT OF SYNC, counterpart reachable (via `resolveJump`): the WHOLE segment is a button (cloud/local
 *    glyph + ahead/behind stats + a directional arrow) that jumps to the counterpart's row.
 *  - OUT OF SYNC, counterpart NOT loaded/displayed: a NON-interactive status span (glyph + ahead/behind
 *    stats, no jump arrow). The ahead/behind comes from `getUpstream` and must NOT vanish just because
 *    the jump target scrolled out of the loaded set (that was the "stats disappear on scroll" bug).
 * Renders nothing only when the ref has neither ahead/behind stats nor a reachable counterpart.
 */
function renderUpstreamSegment(
	ref: ParsedRef,
	fromSha: Sha,
	hooks?: RefPillHooks,
	upstreamOnRow?: ParsedRef,
	jumpId?: string,
	pinControl?: boolean,
): TemplateResult | typeof nothing {
	if (hooks == null) return nothing;

	// In sync: the upstream remote is co-located on this row → same commit ⇒ always in sync, so no
	// sync/ahead-behind indicator is needed. Instead label the cloud with the remote it tracks: the owner
	// alone when the branch names match (`origin`), or the full `owner/branch` when the upstream branch
	// name differs (`origin/trunk`).
	if (upstreamOnRow != null) {
		const owner = upstreamOnRow.owner ?? '';
		const full = owner.length > 0 ? `${owner}/${upstreamOnRow.name}` : upstreamOnRow.name;
		const label = upstreamOnRow.name === ref.name ? owner : full;
		// An absorbed upstream is neither the primary pill nor a popover row, so this segment is the ONLY
		// place its edge-pin can surface. Interactive on the primary pill; a bare glyph in a popover row,
		// which is `role="menuitem"` where a nested button is invalid and unreachable under roving focus.
		const pinnedRefId = hooks.getPinnedRefId?.();
		const edgePinned = pinnedRefId != null && upstreamOnRow.id === pinnedRefId;
		return renderNamedSegment(
			remoteRefIcon(upstreamOnRow.hostingServiceType),
			label,
			edgePinned ? `Up to date with ${full} · Pinned to Edge` : `Up to date with ${full}`,
			undefined,
			edgePinned
				? pinControl === true
					? renderPinControl(hooks.onUnpinRef, 'gl-graph__ref-pill-icon--pin-upstream')
					: html`<code-icon
							class="gl-graph__ref-pill-upstream-icon gl-graph__ref-pill-upstream-pin"
							icon="gl-pinned-filled"
							aria-hidden="true"
						></code-icon>`
				: undefined,
		);
	}

	const stats = hooks.getUpstream(ref);
	const jump = hooks.resolveJump(ref, fromSha);
	// Nothing to show: no ahead/behind AND no reachable counterpart to jump to.
	const hasStats = stats != null && (stats.ahead > 0 || stats.behind > 0);
	if (!hasStats && jump == null) return nothing;

	// The id the RAW upstream metadata object is keyed on (same one `getUpstream` reads) — lets a
	// double-click on this segment resolve the full object back up (pull/push routing on the host).
	const metadataId = hooks.getUpstreamMetadataId(ref);

	// Leading glyph = the LINKED ref's kind: a head links to its remote upstream (cloud); a remote links
	// to the local branch tracking it (the local-branch `vm` glyph).
	const linkIcon = ref.kind === 'head' ? 'cloud' : 'vm';
	const trackingPill =
		stats != null && (stats.ahead > 0 || stats.behind > 0)
			? html`<gl-tracking-pill
					class="gl-graph__ref-pill-tracking"
					ahead=${stats.ahead}
					behind=${stats.behind}
					colorized
				></gl-tracking-pill>`
			: nothing;

	// Counterpart not in the loaded/displayed set → no jump, but STILL show the ahead/behind (it comes
	// from `getUpstream`, not from what's scrolled into view). A non-interactive status span with the
	// linked-ref glyph + stats; the jump button (below) only renders when the target is reachable.
	if (jump == null) {
		const statusTip = upstreamStatusTooltip(
			ref.kind === 'head' ? 'Upstream' : 'Local',
			ref.kind === 'head' ? ref.upstreamName : undefined,
			stats,
		);
		return html`<span
			class="gl-graph__ref-pill-upstream"
			aria-label=${statusTip.aria}
			data-tooltip=${statusTip.label}
			data-ref-metadata-type="upstream"
			data-ref-id=${metadataId ?? nothing}
		>
			<code-icon class="gl-graph__ref-pill-upstream-icon" icon=${linkIcon}></code-icon>
			${trackingPill}
		</span>`;
	}

	const tip = jumpTooltip(ref.kind === 'head' ? 'Upstream' : 'Local', jump.name, stats);
	// The whole segment is the jump affordance (button): the linked-ref glyph + the download jump glyph
	// sit ADJACENT (the affordance reads as one unit), then the ahead/behind status follows. The tooltip
	// renders "Jump to <cloud|vm icon> <branch>" inline (data-tooltip-action + -icon); the aria-label
	// spells the side out (Upstream/Local) for screen readers, since the glyph isn't readable.
	return html`<button
		id=${jumpId ?? nothing}
		class="gl-graph__ref-pill-upstream gl-graph__ref-pill-upstream--jump"
		type="button"
		tabindex="-1"
		aria-label=${tip.aria}
		data-tooltip-action="Jump to"
		data-tooltip-icon=${linkIcon}
		data-tooltip=${tip.label}
		data-ref-metadata-type="upstream"
		data-ref-id=${metadataId ?? nothing}
		@click=${(e: Event) => {
			e.stopPropagation();
			hooks.onJumpToRef(jump.sha);
		}}
	>
		<code-icon class="gl-graph__ref-pill-upstream-icon" icon=${linkIcon}></code-icon>
		<code-icon
			class="gl-graph__ref-pill-jump-arrow"
			icon="download"
			flip=${ifDefined(jump.direction === 'up' ? 'block' : undefined)}
		></code-icon>
		${trackingPill}
	</button>`;
}

/**
 * A static upstream segment that NAMES the remote instead of measuring the divergence — the shape shared by
 * the in-sync combine and the WIP row's row-marker pill. Provider glyph (GitHub/GitLab/…) when the remote's
 * hosting service is known, exactly like the standalone remote pill's own icon (`renderRefIcon` →
 * `remoteRefIcon`) — this segment IS that remote, so it shouldn't fall back to the generic cloud when we can
 * be specific. `remoteRefIcon` already returns `cloud` when the provider is unknown.
 */
function renderNamedSegment(
	icon: string,
	label: string,
	tip: string,
	onJump?: () => void,
	leading?: TemplateResult,
): TemplateResult {
	const glyph = html`<code-icon class="gl-graph__ref-pill-upstream-icon" icon=${icon}></code-icon>`;
	// A `leading` pin shares the glyph's grid track rather than taking one of its own: the labelled shape is a
	// two-column grid (see `:has(> …-label)` in graph.scss), so a third child would wrap the label to a second row.
	const content = html`${
		leading != null ? html`<span class="gl-graph__ref-pill-upstream-lead">${leading}${glyph}</span>` : glyph
	}
	${label.length > 0 ? html`<span class="gl-graph__ref-pill-upstream-label">${label}</span>` : nothing}`;
	// `leading` only rides the static form — the jump form is itself a <button>, which can't nest one.
	if (onJump == null) {
		return html`<span class="gl-graph__ref-pill-upstream" aria-label=${tip} data-tooltip=${tip}>${content}</span>`;
	}

	return html`<button
		class="gl-graph__ref-pill-upstream gl-graph__ref-pill-upstream--jump"
		type="button"
		tabindex="-1"
		aria-label=${tip}
		data-tooltip=${tip}
		@click=${(e: Event) => {
			e.stopPropagation();
			onJump();
		}}
	>
		${content}
	</button>`;
}

/**
 * The row-marker pill's upstream segment (see `RefPillRowMarker.upstream`): the tracked remote alone
 * (`origin`) when the upstream is same-named — the pill already shows that name — else the full
 * `origin/other`. Same rule as the in-sync combine and the overview bar's upstream leg, so all three agree.
 * With the upstream tip loaded it's a jump button (the `--jump` chrome brings the lit-up sub-zone band);
 * without one it degrades to a static indicator, exactly like the overview bar's leg.
 */
function renderNamedUpstreamSegment(
	ref: ParsedRef,
	upstream: { name: string; hostingServiceType?: GkProviderId; jumpSha?: Sha },
	hooks: RefPillHooks | undefined,
	iconOnly: boolean,
): TemplateResult {
	const full = shortRefName(upstream.name);
	const remote = getRemoteNameFromBranchName(full);
	const label = remote.length > 0 && getBranchNameWithoutRemote(full) === ref.name ? remote : full;
	const icon = remoteRefIcon(upstream.hostingServiceType);
	const sha = upstream.jumpSha;
	if (sha == null) return renderNamedSegment(icon, iconOnly ? '' : label, `Upstream (${full})`);

	return renderNamedSegment(icon, iconOnly ? '' : label, `Jump to Upstream (${full})`, () => hooks?.onJumpToRef(sha));
}

/**
 * The HEAD pill's merge-target segment (the split-pill idiom, purple `--row-marker-target` styling): at rest
 * the `gl-merge-target` glyph alone; the hover-expand overlay copy (`expanded`) reveals the target's name.
 * The whole segment is a jump button to the target tip (`hooks.onJumpToRef`) — the target sha comes from
 * the load-time scope pull, so there's no hover-fetch. Reuses the `-upstream` classes for its divider +
 * sizing; the `-target` class recolors it.
 */
function renderTargetSegment(
	sha: Sha,
	name: string | undefined,
	hooks: RefPillHooks | undefined,
	expanded: boolean,
): TemplateResult {
	const short = name != null && name.length > 0 ? shortRefName(name) : undefined;
	const label = short ?? 'Merge Target';
	// Named in the same "Jump to <role> (<ref>)" shape as the overview bar's legs — and NOT via
	// `data-tooltip-action`, which the tooltip resolver only honours alongside a `data-tooltip-icon` (without
	// one it fell through and the tooltip read as the bare ref name).
	const tip = short != null ? `Jump to Merge Target (${short})` : 'Jump to Merge Target';
	return html`<button
		class="gl-graph__ref-pill-upstream gl-graph__ref-pill-upstream--jump gl-graph__ref-pill-target"
		type="button"
		tabindex="-1"
		aria-label=${tip}
		data-ref-metadata-type="target"
		data-tooltip=${tip}
		@click=${(e: Event) => {
			e.stopPropagation();
			hooks?.onJumpToRef(sha);
		}}
	>
		<code-icon class="gl-graph__ref-pill-upstream-icon" icon="gl-merge-target"></code-icon>${
			expanded ? html`<span class="gl-graph__ref-pill-target-label">${label}</span>` : nothing
		}
	</button>`;
}

function renderPopoverRefRow(
	parsed: ParsedRef,
	color: string,
	context?: string,
	fromSha?: Sha,
	hooks?: RefPillHooks,
	upstreamOnRow?: ParsedRef,
	edgePinned?: boolean,
): TemplateResult {
	const isHead = parsed.current === true;
	const describe = describeRef(parsed, hooks);
	// Same split/combine treatment as the primary pill: in-sync upstream folds in (cloud + sync), an
	// out-of-sync counterpart shows ahead/behind + a jump button.
	const upstreamSegment =
		fromSha != null
			? renderUpstreamSegment(parsed, fromSha, hooks, upstreamOnRow, `ref-menuitem-${refPillKey(parsed)}-jump`)
			: nothing;

	// A find hit normally wins the primary slot outright (`sortRowRefs`' find tier), but not when it's an
	// in-sync remote carried by its local — then the match lists here instead, and without this the ref you
	// searched for is the one thing on the row with nothing marking it.
	const isFindHit = hooks?.getFindHitRefKey?.() === refPillKey(parsed);

	return html`<div
		class="gl-graph__ref-popover-row${isFindHit ? ' gl-graph__ref-popover-row--find-hit' : ''}"
		style=${cspStyleMap(refStyle(color, isHead, 'row'))}
		role="menuitem"
		id=${`ref-menuitem-${refPillKey(parsed)}`}
		aria-label=${edgePinned === true ? `${describe} · Pinned to Edge` : describe}
		data-ref-name=${parsed.name}
		data-ref-key=${refPillKey(parsed)}
		data-ref-kind=${parsed.kind}
		data-ref-remote=${parsed.owner ?? nothing}
		data-ref-is-head=${parsed.current ? 'true' : nothing}
		data-vscode-context=${context ?? nothing}
	>
		${
			// Indicator ONLY, and it PRECEDES the kind glyph rather than replacing it — the glyph is what says
			// whether a local, remote or tag is pinned. A row is `role="menuitem"`, where a nested button is
			// invalid and unreachable under roving focus, so Unpin stays on the row's context menu.
			edgePinned === true
				? html`<code-icon
						class="gl-graph__ref-popover-row-pin"
						icon="gl-pinned-filled"
						aria-hidden="true"
					></code-icon>`
				: nothing
		}${renderRefIcon(parsed)}
		<span class="gl-graph__ref-popover-row-label">${chipLabel(parsed, hooks?.getShowRemoteNames() === true)}</span>
		${upstreamSegment}
	</div>`;
}

// A remote's hosting provider glicon, when known; `cloud` for an unrecognized/absent provider.
function remoteRefIcon(hostingServiceType: GkProviderId | undefined): string {
	switch (hostingServiceType) {
		case 'github':
		case 'githubEnterprise':
			return 'gl-provider-github';
		case 'gitlab':
		case 'gitlabSelfHosted':
			return 'gl-provider-gitlab';
		case 'bitbucket':
		case 'bitbucketServer':
			return 'gl-provider-bitbucket';
		case 'azureDevops':
			return 'gl-provider-azdo';
		default:
			return 'cloud';
	}
}

// Ref codicons: `vm` for a local branch/HEAD (the "local machine" counterpart to the remote cloud),
// `cloud`/a provider glicon for remote, `tag` for tags. The CURRENT head (`current`) uses `vm-active` so the
// current branch stands out (on top of the filled pill); a NON-current head checked out in another worktree swaps
// to the worktree glyph (`secondaryWorktreeId`, derived from `GitGraphRowHead.worktree`). `code-icon`
// inherits the pill's color (lane / white-on-hover).
/**
 * The pill's leading glyph slot: normally the kind/state icon, but the pin + unpin control when this ref is
 * pinned to the edge.
 *
 * Placed here rather than as a trailing chip because this slot is the pill's one FIXED position — the
 * trailing region is a variable run of segments (upstream / merge-target / PR / issue / +N), so a control
 * there lands somewhere different on every pill. The slot is already state-carrying (`vm-active` for current,
 * `gl-worktree-filled` for another worktree, a provider glyph for remotes), so the pin joins that vocabulary
 * and costs no width — the pill's geometry is identical pinned or not.
 *
 * ⚠ Hover is scoped to the ZONE, not the pill: the unpin action belongs to the pin, so mousing over the
 * branch name must not offer to unpin it. The zone carries its own lit band (`--pin` in graph.scss, same
 * recipe as `--jump`) so it reads as a button in its own right rather than relying on the glyph swap alone.
 *
 * ⚠ The hover glyph is `close`, NOT an outline pin. There is no matched filled/outline pin pair available:
 * `gl-pinned-filled` is upright, codicon `pinned` is diagonal, and codicon `pin` is a horizontal outline —
 * so swapping between any two reads as a different object rather than a state change.
 *
 * `tabindex="-1"` matches every other interactive segment on the pill (see `renderNamedSegment`) and the
 * graph's roving-focus model; keyboard users reach Unpin through the pill's context menu.
 */
function renderLeadingSlot(ref: ParsedRef, edgePinned: boolean, hooks?: RefPillHooks): TemplateResult {
	if (!edgePinned) return html`<span class="gl-graph__ref-pill-icon">${renderRefIcon(ref)}</span>`;

	// The pin JOINS the kind glyph instead of replacing it: that glyph is the only thing saying WHAT is
	// pinned (local / remote / tag / worktree), so swapping it out left a pinned pill unable to identify
	// itself. Wrapped as ONE element because `-main` is a two-column grid — icon slot, then label.
	return html`<span class="gl-graph__ref-pill-pinned-slot"
		>${renderPinControl(hooks?.onUnpinRef)}<span class="gl-graph__ref-pill-icon">${renderRefIcon(ref)}</span></span
	>`;
}

/** The edge-pin control — the pinned glyph at rest, swapping to `close` on hover. Shared by the primary
 *  pill's leading slot and the combined pill's upstream segment (an absorbed pinned upstream). */
function renderPinControl(onUnpin: (() => void) | undefined, extraClass?: string): TemplateResult {
	return html`<button
		class="gl-graph__ref-pill-icon gl-graph__ref-pill-icon--pin${extraClass != null ? ` ${extraClass}` : ''}"
		type="button"
		tabindex="-1"
		aria-label="Unpin Branch from Edge"
		data-tooltip="Unpin Branch from Edge"
		@click=${(e: Event) => {
			// Must not bubble to the pill (which selects the row / opens the branch sheet).
			e.stopPropagation();
			onUnpin?.();
		}}
	>
		<code-icon class="gl-graph__ref-pill-pin-rest" icon="gl-pinned-filled"></code-icon
		><code-icon class="gl-graph__ref-pill-pin-hover" icon="close"></code-icon>
	</button>`;
}

function renderRefIcon(ref: ParsedRef): TemplateResult {
	let icon: string;
	if (ref.kind === 'tag') {
		icon = 'tag';
	} else if (ref.kind === 'remote') {
		icon = remoteRefIcon(ref.hostingServiceType);
	} else if (ref.secondaryWorktreeId != null && ref.current !== true) {
		icon = 'gl-worktree-filled';
	} else if (ref.current === true) {
		icon = 'vm-active';
	} else {
		icon = 'vm';
	}
	return html`<code-icon icon=${icon}></code-icon>`;
}

// `gitlens.graph.showRemoteNames` (default off): a remote pill shows its bare branch name unless the
// setting is on, in which case it's qualified with the remote (`origin/main`). `describeRef`'s a11y
// description always keeps the full qualifier regardless — screen readers should keep it unambiguous.
function chipLabel(ref: ParsedRef, showRemoteNames: boolean): string {
	if (ref.kind === 'remote' && showRemoteNames) return `${ref.owner}/${ref.name}`;

	return ref.name;
}

function describeRef(ref: ParsedRef, hooks?: RefPillHooks): string {
	let description: string;
	if (ref.kind === 'tag') {
		description = `tag ${ref.name}`;
	} else if (ref.kind === 'remote') {
		description = `remote ${ref.owner}/${ref.name}`;
	} else {
		description = ref.current ? `HEAD on ${ref.name}` : `branch ${ref.name}`;
	}

	const pr = hooks?.getPullRequests(ref)?.[0];
	if (pr != null) {
		description += `, pull request #${pr.id}${pr.state ? ` ${pr.state}` : ''}`;
	}
	const issue = hooks?.getIssues(ref)?.[0];
	if (issue != null) {
		description += `, issue ${issue.displayId}`;
	}
	return description;
}

function stopEvent(e: Event): void {
	e.stopPropagation();
}

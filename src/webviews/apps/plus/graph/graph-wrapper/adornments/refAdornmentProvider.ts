import { colorForColumn, contrastColor, withAlpha } from '@gitkraken/commit-graph/colors.js';
import type { RowAdornment, RowAdornmentProvider } from '@gitkraken/commit-graph/engine/adornments.js';
import type { ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import { relativeTime } from '@gitkraken/commit-graph/view.js';
import type { TemplateResult } from 'lit';
import { html, nothing } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GkProviderId } from '@gitlens/git/models/repositoryIdentities.js';
import type {
	GraphDownstreams,
	GraphExcludeRefs,
	GraphExcludeTypes,
	IssueMetadata,
	PullRequestMetadata,
} from '../../../../../plus/graph/protocol.js';
import type { StyleInfo } from '../../../../shared/components/csp-style-map.directive.js';
import { cspStyleMap } from '../../../../shared/components/csp-style-map.directive.js';
import type { GraphCommitRef, GraphCommitView } from '../graph-commit.js';
import { isRefHidden } from '../graph-commit.js';
import '../../../../shared/components/code-icon.js';
import '../../../../shared/components/overlays/popover.js';
import '../../../../shared/components/pills/tracking.js';

export interface ParsedRef {
	kind: 'head' | 'remote' | 'tag';
	name: string;
	/** Stable ref id — keys upstream tracking metadata + locates the ref's row for the jump. */
	id?: string;
	/** True when this head is the current checkout (HEAD). */
	isHead?: boolean;
	/** Set when kind === 'remote'; the remote alias (e.g. "origin"). */
	remote?: string;
	/** The head's upstream branch identifier (drives the upstream ordering tiers). */
	upstreamName?: string;
	/** A head's upstream ref id — links a local branch to the remote it tracks (split pill). */
	upstreamId?: string;
	/** Set when this head is checked out in another worktree. */
	worktreeId?: string;
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
}

// Map the structured commit refs to the pill's view model. A plain projection — NO lossy parsing of
// git-log token strings (the old `parseRefs` heuristic is gone); the metadata arrives intact from
// `toGraphCommit`, so the primary-ref ordering can be exact.
function toParsedRefs(refs: readonly GraphCommitRef[]): ParsedRef[] {
	return refs.map(r => ({
		kind: r.kind,
		name: r.name,
		id: r.id,
		isHead: r.kind === 'head' ? r.current : undefined,
		remote: r.kind === 'remote' ? r.owner : undefined,
		upstreamName: r.upstreamName,
		upstreamId: r.upstreamId,
		worktreeId: r.worktreeId,
		isDefault: r.isDefault,
		hostingServiceType: r.hostingServiceType,
		context: r.context,
	}));
}

/**
 * Stable, UNIQUE per-ref key (a local branch and the remote it tracks share a `name`, e.g. `main` vs
 * `origin/main`, so name alone can't identify a pill — that broke click-pinning a split pill). Kind +
 * remote owner + name disambiguates: `head:main`, `remote:origin/main`, `tag:v1`.
 */
export function refPillKey(ref: { kind: string; name: string; remote?: string | null }): string {
	return ref.kind === 'remote' ? `remote:${ref.remote ?? ''}/${ref.name}` : `${ref.kind}:${ref.name}`;
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
 * @param getPinnedRefKey Returns the currently click-pinned ref's `refPillKey` (if any). When a row
 * carries that ref, it's promoted to the inline pill (the displaced primary drops into the +N popover)
 * so the pinned ref stays visible at a glance until it's unpinned. The host recomputes adornments on
 * pin/unpin so this re-applies.
 * @param getExcludeState Returns the active ref-visibility filters, read fresh on each adornments
 * rebuild. Hidden refs (by type or by id; current HEAD always kept) are filtered out of each row's
 * pills. The host recomputes adornments when these change so the filter re-applies.
 * @param getCommit Resolves a row's commit payload (rows are topology-only) — the structured refs
 * the pills render from live on the commit, not the engine row.
 */
export function createRefAdornmentProvider(
	getPinnedRefKey: (() => string | undefined) | undefined,
	hooks: RefPillHooks | undefined,
	getExcludeState: (() => RefExcludeState) | undefined,
	getCommit: (sha: Sha) => GraphCommitView | undefined,
): RowAdornmentProvider<TemplateResult, ParsedRef[]> {
	// Cache the projection by the structured-refs array reference. `commitRefs` is stable per commit
	// (built once in toGraphCommit), so this avoids re-allocating the view model on every adornments
	// rebuild (which happens whenever a new provider list is built upstream — e.g. agent updates).
	const cache = new WeakMap<readonly GraphCommitRef[], ParsedRef[]>();
	const projectCached = (refs: readonly GraphCommitRef[]): ParsedRef[] => {
		const hit = cache.get(refs);
		if (hit) return hit;

		const parsed = toParsedRefs(refs);
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

			return renderRefPill(parsed, colorForColumn(row.column), getPinnedRefKey?.(), row.sha, hooks);
		},

		describeForA11y: function (_row: ProcessedGraphRow, parsed?: ParsedRef[]): string | null {
			if (!parsed || parsed.length === 0) return null;

			return parsed.map(r => describeRef(r, hooks)).join(', ');
		},
	};
}

/**
 * Pick the row's primary ref (shown on the pill; the rest go in the popover). Priority, primary
 * first: current ref → current upstream → worktree ref → worktree upstream → default branch → local
 * → remote → tag. Ties break by name for a stable pick. The upstream tiers match a remote ref to the
 * current/worktree head's upstream; they (and the worktree/default tiers) activate as the host
 * carries `Head.upstream` / `worktreeId` / a default flag (additive, legacy-safe) — until then those
 * refs simply fall through to local/remote/tag.
 */
// True when `remote` is the upstream that `head` tracks. Prefers the exact ref-id match (a local and
// its remote share a `name`, so the id disambiguates); falls back to the full `owner/name` for legacy
// rows that don't carry ids. Used both for primary-ref tiering and to combine an in-sync pair's pills.
function isUpstreamRemoteOf(remote: ParsedRef, head: ParsedRef | undefined): boolean {
	if (head == null || remote.kind !== 'remote' || head.kind !== 'head') return false;
	if (head.upstreamId != null && remote.id != null) return head.upstreamId === remote.id;
	if (head.upstreamName == null) return false;

	const full = remote.remote != null ? `${remote.remote}/${remote.name}` : remote.name;
	return head.upstreamName === full || head.upstreamName === remote.name;
}

function pickPrimaryFirst(parsed: ParsedRef[], showRemoteNames: boolean): ParsedRef[] {
	const currentHead = parsed.find(r => r.kind === 'head' && r.isHead);
	const worktreeHeads = parsed.filter(r => r.kind === 'head' && r.worktreeId != null);
	const isUpstreamOf = isUpstreamRemoteOf;
	const tier = (r: ParsedRef): number => {
		if (r.kind === 'head') {
			if (r.isHead) return 0; // the current checkout
			if (r.worktreeId != null) return 2; // checked out in another worktree
			if (r.isDefault) return 4; // the repo's default branch
			return 5; // local branch
		}
		if (r.kind === 'remote') {
			if (isUpstreamOf(r, currentHead)) return 1; // upstream of the current branch
			if (worktreeHeads.some(h => isUpstreamOf(r, h))) return 3; // upstream of a worktree branch
			if (r.isDefault) return 4; // the repo's default branch (remote-only — no local checkout)
			return 6; // remote branch
		}

		return 7; // tag
	};

	return parsed.toSorted(
		(a, b) => tier(a) - tier(b) || chipLabel(a, showRemoteNames).localeCompare(chipLabel(b, showRemoteNames)),
	);
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

/**
 * Move the click-pinned ref to the front so it becomes the inline pill (the previous primary drops
 * into the +N popover). No-op when nothing is pinned, the pinned ref isn't on this row, or it's
 * already primary. Matches by name (the pin model is name-keyed).
 */
function promotePinned(sorted: ParsedRef[], pinnedRefKey?: string): ParsedRef[] {
	if (pinnedRefKey == null || sorted.length < 2) return sorted;

	const idx = sorted.findIndex(r => refPillKey(r) === pinnedRefKey);
	if (idx <= 0) return sorted;

	const promoted = sorted.slice();
	const [ref] = promoted.splice(idx, 1);
	promoted.unshift(ref);
	return promoted;
}

// PR chip icon by state (case-insensitive — the host's `state` string isn't a strict union); merged/
// closed get a distinct glyph, everything else (open, draft, unknown) reads as an open pull request.
function pullRequestIcon(state: string | undefined): string {
	switch (state?.toLowerCase()) {
		case 'merged':
			return 'git-merge';
		case 'closed':
			return 'git-pull-request-closed';
		default:
			return 'git-pull-request';
	}
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
function renderPrChip(pr: PullRequestMetadata, ref: ParsedRef, expanded: boolean): TemplateResult {
	const label = `#${pr.id}`;
	const meta = [pr.state, pr.author, pr.date != null ? relativeTime(pr.date) : undefined].filter(
		(v): v is string => v != null && v.length > 0,
	);
	return html`<gl-popover
		class="gl-graph__ref-pill-pr"
		hoist
		.arrow=${false}
		placement="bottom-start"
		trigger="hover focus"
		.distance=${1}
		style=${cspStyleMap({ '--show-delay': '120ms', '--hide-delay': '180ms' })}
	>
		<span
			slot="anchor"
			aria-label="Pull request ${label}"
			data-ref-metadata-type="pullRequest"
			data-ref-id=${ref.id ?? nothing}
			data-ref-name=${ref.name}
			data-ref-kind=${ref.kind}
			data-ref-remote=${ref.remote ?? nothing}
			data-ref-is-head=${ref.isHead ? 'true' : nothing}
			data-vscode-context=${ref.context ?? nothing}
		>
			<code-icon icon=${pullRequestIcon(pr.state)}></code-icon>${expanded ? html`<span>${label}</span>` : nothing}
		</span>
		<div slot="content" class="gl-graph__ref-metadata-card" @mousedown=${stopEvent}>
			<div class="gl-graph__ref-metadata-card-title">${pr.title}</div>
			${meta.length > 0 ? html`<div class="gl-graph__ref-metadata-card-meta">${meta.join(' · ')}</div>` : nothing}
		</div>
	</gl-popover>`;
}

function renderIssueChip(issue: IssueMetadata, ref: ParsedRef, expanded: boolean): TemplateResult {
	const label = issue.displayId;
	return html`<gl-popover
		class="gl-graph__ref-pill-issue"
		hoist
		.arrow=${false}
		placement="bottom-start"
		trigger="hover focus"
		.distance=${1}
		style=${cspStyleMap({ '--show-delay': '120ms', '--hide-delay': '180ms' })}
	>
		<span
			slot="anchor"
			aria-label="Issue ${label}"
			data-ref-metadata-type="issue"
			data-ref-id=${ref.id ?? nothing}
			data-ref-name=${ref.name}
			data-ref-kind=${ref.kind}
			data-ref-remote=${ref.remote ?? nothing}
			data-ref-is-head=${ref.isHead ? 'true' : nothing}
			data-vscode-context=${ref.context ?? nothing}
		>
			<code-icon icon="issues"></code-icon>${expanded ? html`<span>${label}</span>` : nothing}
		</span>
		<div slot="content" class="gl-graph__ref-metadata-card" @mousedown=${stopEvent}>
			<div class="gl-graph__ref-metadata-card-title">${issue.title}</div>
			<div class="gl-graph__ref-metadata-card-meta">${issue.issueTrackerType}</div>
		</div>
	</gl-popover>`;
}

function renderRefPill(
	parsed: ParsedRef[],
	color: string,
	pinnedRefKey?: string,
	fromSha?: Sha,
	hooks?: RefPillHooks,
): TemplateResult {
	const showRemoteNames = hooks?.getShowRemoteNames() === true;
	const sorted = promotePinned(pickPrimaryFirst(parsed, showRemoteNames), pinnedRefKey);
	const primary = sorted[0];
	const isHead = primary.isHead === true;
	const primaryContext = primary.context;
	// In-sync combine: when a head's upstream remote is ALSO on this row (same commit ⇒ in sync), fold it
	// into that head's upstream segment instead of listing it separately — so the pair reads as one
	// combined pill. Applied to the PRIMARY pill and (below) to each head in the +N popover alike.
	const upstreamOnRow = sorted.find((r, i) => i > 0 && isUpstreamRemoteOf(r, primary));
	const afterPrimary = upstreamOnRow != null ? sorted.slice(1).filter(r => r !== upstreamOnRow) : sorted.slice(1);
	// Within the popover, pair each head with its in-sync upstream remote (if also listed) and absorb that
	// remote into the head's row, so the expanded rows combine just like the primary pill.
	const popoverUpstreamFor = new Map<ParsedRef, ParsedRef>();
	const absorbed = new Set<ParsedRef>();
	for (const r of afterPrimary) {
		if (r.kind !== 'head') continue;

		const up = afterPrimary.find(x => !absorbed.has(x) && isUpstreamRemoteOf(x, r));
		if (up != null) {
			popoverUpstreamFor.set(r, up);
			absorbed.add(up);
		}
	}
	const rest = afterPrimary.filter(r => !absorbed.has(r));
	const restCount = rest.length;
	// Split-pill upstream segment: the primary's tracked counterpart — its upstream remote when in sync
	// on this row (combined, no jump), or on ANOTHER row when out of sync (ahead/behind + a jump button).
	const upstreamSegment = fromSha != null ? renderUpstreamSegment(primary, fromSha, hooks, upstreamOnRow) : nothing;

	// PR/issue chips: first item only (parity with the legacy graph, which shows a single badge per pill).
	// Rendered twice — icon-only for the resting pill, icon+label for the hover-expand overlay copy below.
	const prMeta = firstRefMetadata(hooks, (h, r) => h.getPullRequests(r), primary, upstreamOnRow);
	const prChip = prMeta != null ? renderPrChip(prMeta.item, prMeta.ref, false) : nothing;
	const prChipExpanded = prMeta != null ? renderPrChip(prMeta.item, prMeta.ref, true) : nothing;
	const issueMeta = firstRefMetadata(hooks, (h, r) => h.getIssues(r), primary, upstreamOnRow);
	const issueChip = issueMeta != null ? renderIssueChip(issueMeta.item, issueMeta.ref, false) : nothing;
	const issueChipExpanded = issueMeta != null ? renderIssueChip(issueMeta.item, issueMeta.ref, true) : nothing;

	// Icon and label form a shrinkable group so a long branch name truncates. The +N badge sits
	// outside the truncating group with flex-shrink:0 — the name ellipsises but the badge stays.
	// When the pill is shrunk to its icon, hovering reveals the full name (+ the +N badge, for a
	// grouped pill) via an absolutely-positioned overlay (`-expand`) that sits ON TOP of the message
	// (no reflow — the in-flow box is untouched). The overlay renders for BOTH single and multi-ref
	// pills so the PRIMARY ref's name always expands on hover; the popover (multi-ref) lists the rest.
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
					>${otherCount > 0
						? html`<span class="gl-graph__ref-pill-more">+${otherCount}</span>`
						: nothing}${tagCount > 0
						? html`<span class="gl-graph__ref-pill-more gl-graph__ref-pill-more--tags"
								><code-icon icon="tag"></code-icon>+${tagCount}</span
							>`
						: nothing}</span
				>`
			: nothing;
	const pill = html`<span
		class="gl-graph__ref-pill"
		style=${cspStyleMap(refStyle(color, isHead, 'pill'))}
		data-ref-name=${primary.name}
		data-ref-key=${refPillKey(primary)}
		data-ref-kind=${primary.kind}
		data-ref-remote=${primary.remote ?? nothing}
		data-ref-is-head=${primary.isHead ? 'true' : nothing}
		data-vscode-context=${primaryContext ?? nothing}
	>
		<span class="gl-graph__ref-pill-main">
			<span class="gl-graph__ref-pill-icon">${renderRefIcon(primary)}</span>
			<span class="gl-graph__ref-pill-label">${chipLabel(primary, showRemoteNames)}</span>
		</span>
		${upstreamSegment}${prChip}${issueChip}${moreBadge}
		<span class="gl-graph__ref-pill-expand" aria-hidden="true"
			><span class="gl-graph__ref-pill-icon">${renderRefIcon(primary)}</span
			><span class="gl-graph__ref-pill-expand-label">${chipLabel(primary, showRemoteNames)}</span
			>${upstreamSegment}${prChipExpanded}${issueChipExpanded}${moreBadge}</span
		>
	</span>`;

	// A single ref → bare pill. Its hover-expand overlay is absolutely positioned and must escape the
	// row to paint over the message; a wrapping <gl-popover>'s shadow DOM clips it (that was the
	// "pills don't expand" regression). Branch focus now lives on the branch sheet (click the pill),
	// so single pills no longer need a popover. Only MULTI-ref pills keep one — to list the extras.
	if (restCount === 0) return pill;

	// Match the React HoverCard timings: openDelay 120ms, closeDelay 180ms. `hoist` lets the
	// popover escape the row's `contain: layout`. stopPropagation on the content keeps clicks
	// from bubbling to the row (selection / context menu).
	return html`<gl-popover
		class="gl-graph__ref-popover"
		hoist
		.arrow=${false}
		placement="bottom-start"
		trigger="hover focus"
		.distance=${1}
		style=${cspStyleMap({ '--show-delay': '120ms', '--hide-delay': '180ms', '--wa-tooltip-padding': '0' })}
	>
		<span slot="anchor" class="gl-graph__ref-popover-anchor">${pill}</span>
		<div slot="content" class="gl-graph__ref-popover-list" @mousedown=${stopEvent}>
			${rest.map(r => renderPopoverRefRow(r, color, r.context, fromSha, hooks, popoverUpstreamFor.get(r)))}
		</div>
	</gl-popover>`;
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
): TemplateResult | typeof nothing {
	if (hooks == null) return nothing;

	// In sync: the upstream remote is co-located on this row → same commit ⇒ always in sync, so no
	// sync/ahead-behind indicator is needed. Instead label the cloud with the remote it tracks: the owner
	// alone when the branch names match (`origin`), or the full `owner/branch` when the upstream branch
	// name differs (`origin/trunk`).
	if (upstreamOnRow != null) {
		const owner = upstreamOnRow.remote ?? '';
		const full = owner.length > 0 ? `${owner}/${upstreamOnRow.name}` : upstreamOnRow.name;
		const label = upstreamOnRow.name === ref.name ? owner : full;
		const tip = `Up to date with ${full}`;
		return html`<span class="gl-graph__ref-pill-upstream" aria-label=${tip} data-tooltip=${tip}>
			<code-icon class="gl-graph__ref-pill-upstream-icon" icon="cloud"></code-icon>
			${label.length > 0 ? html`<span class="gl-graph__ref-pill-upstream-label">${label}</span>` : nothing}
		</span>`;
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
		class="gl-graph__ref-pill-upstream gl-graph__ref-pill-upstream--jump"
		type="button"
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

function renderPopoverRefRow(
	parsed: ParsedRef,
	color: string,
	context?: string,
	fromSha?: Sha,
	hooks?: RefPillHooks,
	upstreamOnRow?: ParsedRef,
): TemplateResult {
	const isHead = parsed.isHead === true;
	// Same split/combine treatment as the primary pill: in-sync upstream folds in (cloud + sync), an
	// out-of-sync counterpart shows ahead/behind + a jump button.
	const upstreamSegment = fromSha != null ? renderUpstreamSegment(parsed, fromSha, hooks, upstreamOnRow) : nothing;

	return html`<div
		class="gl-graph__ref-popover-row"
		style=${cspStyleMap(refStyle(color, isHead, 'row'))}
		aria-label=${describeRef(parsed, hooks)}
		data-ref-name=${parsed.name}
		data-ref-key=${refPillKey(parsed)}
		data-ref-kind=${parsed.kind}
		data-ref-remote=${parsed.remote ?? nothing}
		data-ref-is-head=${parsed.isHead ? 'true' : nothing}
		data-vscode-context=${context ?? nothing}
	>
		${renderRefIcon(parsed)}
		<span class="gl-graph__ref-popover-row-label">${chipLabel(parsed, hooks?.getShowRemoteNames() === true)}</span>
		${upstreamSegment}
		${isHead ? html`<span class="gl-graph__ref-popover-row-head" aria-hidden="true">HEAD</span>` : nothing}
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
// `cloud`/a provider glicon for remote, `tag` for tags. The CURRENT head (isHead) keeps the plain `vm`
// glyph (conveyed instead by the filled pill); a NON-current head checked out in another worktree swaps
// to the worktree glyph (old-engine parity: `worktreeId` — see `GitGraphRowHead.worktreeId` — is what
// GKC's bundled renderer reads to make the same swap). `code-icon` inherits the pill's color (lane /
// white-on-hover).
function renderRefIcon(ref: ParsedRef): TemplateResult {
	let icon: string;
	if (ref.kind === 'tag') {
		icon = 'tag';
	} else if (ref.kind === 'remote') {
		icon = remoteRefIcon(ref.hostingServiceType);
	} else if (ref.worktreeId != null && ref.isHead !== true) {
		icon = 'gl-worktree-filled';
	} else {
		icon = 'vm';
	}
	return html`<code-icon icon=${icon}></code-icon>`;
}

// `gitlens.graph.showRemoteNames` (default off): a remote pill shows its bare branch name unless the
// setting is on, in which case it's qualified with the remote (`origin/main`). `describeRef`'s a11y
// description always keeps the full qualifier regardless — screen readers should keep it unambiguous.
function chipLabel(ref: ParsedRef, showRemoteNames: boolean): string {
	if (ref.kind === 'remote' && showRemoteNames) return `${ref.remote}/${ref.name}`;

	return ref.name;
}

function describeRef(ref: ParsedRef, hooks?: RefPillHooks): string {
	let description: string;
	if (ref.kind === 'tag') {
		description = `tag ${ref.name}`;
	} else if (ref.kind === 'remote') {
		description = `remote ${ref.remote}/${ref.name}`;
	} else {
		description = ref.isHead ? `HEAD on ${ref.name}` : `branch ${ref.name}`;
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

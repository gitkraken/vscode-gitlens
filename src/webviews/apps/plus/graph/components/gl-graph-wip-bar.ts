import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { AgentSessionCategory } from '../../../shared/agentUtils.js';
import { getAgentCategoryLabel } from '../../../shared/agentUtils.js';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase } from '../../../shared/components/styles/lit/base.css.js';
import { ContextMenuProxyController } from '../../../shared/controllers/context-menu-proxy.js';
import { wipBarStyles } from './gl-graph-wip-bar.css.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/overlays/tooltip.js';

export interface WipBarItem {
	/** The WIP's sha (`uncommitted` for the primary worktree; `worktree-wip::<path>` for secondaries). */
	id: string;
	/** User-visible branch name (already extracted from refs / falls back to worktree label). */
	branch: string;
	/** Worktree's repo path — passed back in the select event so the host can route without re-resolving. */
	repoPath: string;
	/** Whether the worktree has working (uncommitted) changes — drives the `●` dot independent of
	 *  whether `files` has been fetched yet (a dirty worktree shows the dot before its breakdown lands). */
	hasWorkingChanges?: boolean;
	/** Whether the worktree has unpushed commits — drives the `↑` indicator. */
	hasUnpushed?: boolean;
	/** Count of commits ahead of the upstream — shown in the hover only, and only for tracked branches.
	 *  Absent for local-only branches (no upstream): the `↑` shows, but the hover omits a precise count. */
	ahead?: number;
	/** Changed-file counts (counts of added/modified/deleted FILES, not line diffstats). `files` is
	 *  their sum. Optional: a pill is surfaced from the worktree's cheap clean/dirty signal, and the
	 *  full breakdown is fetched lazily on hover — so these are absent until that request lands. */
	files?: number;
	added?: number;
	modified?: number;
	deleted?: number;
	/** True when an on-demand stats fetch settled without producing a breakdown (the request failed
	 *  or was cancelled). Lets the hover show a terminal "Couldn't load changes" instead of a
	 *  perpetual "Loading changes…". Only meaningful while `files` is absent. */
	statsUnavailable?: boolean;
	/** Optional — surfaced when available (e.g., from a running agent session); otherwise omitted from the row. */
	lastActivity?: string;
	agent?: AgentSessionCategory;
	isPrimary?: boolean;
	/** Serialized `data-vscode-context` for this WIP's right-click menu — `gitlens:wip` for the primary
	 *  worktree, `gitlens:wip+worktree` for a secondary. Built host-side (see `serializeWipContext`) so a
	 *  pill opens the identical menu as the in-graph WIP row and the details header. */
	context?: string;
}

export interface WipBarSelectDetail {
	id: string;
	branch: string;
	repoPath: string;
}

export interface WipBarStatsNeededDetail {
	/** The hovered/focused pill's WIP sha — the host computes its full breakdown on demand. */
	id: string;
}

@customElement('gl-graph-wip-bar')
export class GlGraphWipBar extends LitElement {
	static override styles = [boxSizingBase, focusableBaseStyles, wipBarStyles];

	@property({ attribute: false }) items: readonly WipBarItem[] = [];
	@property({ attribute: false }) selectedId: string | undefined;
	/** False = host's `graph.showWorktreeWipStats` opt-out: don't fetch stats on hover (no
	 *  per-worktree `git status`); show a static "has changes" tooltip, not "Loading…". Breakdown
	 *  appears on click. Primary pill unaffected (always has stats). */
	@property({ type: Boolean }) statsOnHover = true;

	@state() private focusedPillIndex = 0;

	private pendingFocusUpdate = false;

	// Right-click a pill → open the WIP's native context menu. Pills carry `data-vscode-context` in this
	// component's shadow DOM, but VS Code reads the attribute from light DOM, so the proxy copies it onto
	// this host (a light-DOM child of the graph app) as the contextmenu event bubbles out. Mirrors the
	// in-graph WIP row and the details-header kebab, which open the same menu from the same context.
	private readonly _contextMenuProxy = new ContextMenuProxyController(this);

	private readonly onItemClick = (e: MouseEvent): void => {
		const id = (e.currentTarget as HTMLElement).dataset.id;
		if (id == null) return;

		this.selectWipById(id, e);
	};

	private readonly onItemKeyDown = (e: KeyboardEvent): void => {
		if (e.key !== 'Enter' && e.key !== ' ') return;

		if (e.key === ' ') {
			e.preventDefault();
		}
		const id = (e.currentTarget as HTMLElement).dataset.id;
		if (id == null) return;

		this.selectWipById(id, e);
	};

	private selectWipById(id: string, e: Event): void {
		e.stopPropagation();
		const item = this.items.find(i => i.id === id);
		if (item == null) return;

		this.selectedId = id;
		this.dispatchEvent(
			new CustomEvent<WipBarSelectDetail>('gl-graph-wip-bar-select', {
				detail: { id: item.id, branch: item.branch, repoPath: item.repoPath },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Hover/focus on a stats-less pill → ask the host to compute them. Fires on the leading edge
	 *  (before the tooltip's open delay) so the breakdown is ready when the tooltip shows; graph-app
	 *  dedups per worktree. Suppressed when `statsOnHover` is off so passive hover never costs a
	 *  per-worktree `git status` (revealed on click instead). */
	private readonly onPillHover = (e: Event): void => {
		if (!this.statsOnHover) return;

		const id = (e.currentTarget as HTMLElement).dataset.id;
		if (id == null) return;

		const item = this.items.find(i => i.id === id);
		// Nothing to fetch when stats are already present, or when the pill has no working changes at all
		// (an unpushed-only worktree) — its breakdown would be empty, so don't spend a `git status` on it.
		if (item == null || item.files != null || item.hasWorkingChanges !== true) return;

		this.dispatchEvent(
			new CustomEvent<WipBarStatsNeededDetail>('gl-graph-wip-bar-stats-needed', {
				detail: { id: id },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private readonly onPillsKeyDown = (e: KeyboardEvent): void => {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

		const count = this.items.length;
		if (count === 0) return;

		e.preventDefault();
		const dir = e.key === 'ArrowLeft' ? -1 : 1;
		this.focusedPillIndex = (this.focusedPillIndex + dir + count) % count;
		this.pendingFocusUpdate = true;
	};

	protected override willUpdate(changedProperties: PropertyValues<this>): void {
		// Keep the roving tab stop valid and aligned with selection. Without this, two states break
		// keyboard access: (1) when `items` shrinks below `focusedPillIndex`, no pill matches the
		// index so every pill renders `tabindex="-1"` and the listbox drops out of the Tab order; and
		// (2) the tab stop should land on the selected pill (WAI-ARIA APG), not always index 0. Only
		// the tab stop moves here — actual focus is moved solely by arrow-key navigation (`updated`).
		if (changedProperties.has('selectedId') && this.selectedId != null) {
			const selectedIndex = this.items.findIndex(i => i.id === this.selectedId);
			if (selectedIndex >= 0) {
				this.focusedPillIndex = selectedIndex;
			}
		}
		if (this.focusedPillIndex > this.items.length - 1) {
			// The focused pill fell out of range — its item was removed. If focus was actually on a
			// pill inside the bar, move it to the re-homed tab stop so keyboard focus isn't dropped
			// to <body>. Guard on `:focus-within` so we never steal focus when the user is elsewhere
			// (e.g. the host changed `selectedId` while focus is in the editor).
			if (this.matches(':focus-within')) {
				this.pendingFocusUpdate = true;
			}
			this.focusedPillIndex = Math.max(0, this.items.length - 1);
		}
	}

	protected override updated(): void {
		if (!this.pendingFocusUpdate) return;

		const el = this.shadowRoot?.querySelector<HTMLElement>(`.pill[data-index="${this.focusedPillIndex}"]`);
		el?.focus();
		this.pendingFocusUpdate = false;
	}

	override render(): unknown {
		// The label is decorative: the listbox's `aria-label` ("Working changes") already conveys the
		// region to AT, so hiding "WIP" avoids a redundant (and likely mispronounced) announcement.
		// It sits inside the scroll container — so it can stick — but outside the listbox, which may
		// only contain options.
		// Roving tabindex (one focusable item at a time) is the chosen listbox keyboard pattern;
		// see WAI-ARIA APG. Don't mix with aria-activedescendant.
		return html`
			<div class="bar">
				<span class="label" aria-hidden="true">WIP</span>
				<div
					class="pills"
					role="listbox"
					aria-orientation="horizontal"
					aria-label="Working changes"
					@keydown=${this.onPillsKeyDown}
				>
					${repeat(
						this.items,
						item => item.id,
						(item, index) => this.renderPill(item, index),
					)}
				</div>
			</div>
		`;
	}

	private renderPill(item: WipBarItem, index: number): unknown {
		const isFocused = index === this.focusedPillIndex;
		const isSelected = this.selectedId === item.id;
		const hasAgent = item.agent != null;
		const isDirty = item.hasWorkingChanges === true;
		const isUnpushed = item.hasUnpushed === true;
		const classes = classMap({
			pill: true,
			...(item.agent != null && { [`pill--agent-${item.agent}`]: true }),
			'pill--primary': item.isPrimary === true,
			'pill--unpushed': isUnpushed,
			'pill--selected': isSelected,
		});
		// All indicators lead the branch name in a fixed order — working-changes dot, unpushed arrow,
		// agent robot — so a pill's signals always read in the same left-to-right sequence regardless of
		// which combination is present. Counts live in the hover (per design); the pill arrow is number-less.
		return html`
			<gl-tooltip placement="bottom">
				<span
					class=${classes}
					data-id=${item.id}
					data-index=${index}
					data-vscode-context=${ifDefined(item.context)}
					@click=${this.onItemClick}
					@keydown=${this.onItemKeyDown}
					@mouseenter=${this.onPillHover}
					@focus=${this.onPillHover}
					role="option"
					aria-selected=${isSelected}
					tabindex=${isFocused ? '0' : '-1'}
				>
					${isDirty ? html`<span class="pill__dot"></span>` : nothing}${isUnpushed
						? html`<code-icon class="pill__unpushed-icon" icon="arrow-up" size="11"></code-icon>`
						: nothing}${hasAgent
						? html`<code-icon class="pill__agent-icon" icon="robot" size="11"></code-icon>`
						: nothing}${item.branch}
				</span>
				<div slot="content">${this.renderHoverDetail(item)}</div>
			</gl-tooltip>
		`;
	}

	private renderHoverDetail(item: WipBarItem): unknown {
		return html`
			<div class="pill-hover">
				<div class="pill-hover__branch">
					<code-icon icon="gl-worktree"></code-icon>
					<span>${item.branch}</span>
				</div>
				${item.hasWorkingChanges === true
					? html`<div class="pill-hover__row">
							${item.files != null
								? html`
										<span class="pill-hover__files">${pluralize('file', item.files)} changed</span>
										<commit-stats
											added=${item.added || nothing}
											modified=${item.modified || nothing}
											removed=${item.deleted || nothing}
											symbol="icons"
											no-tooltip
										></commit-stats>
									`
								: item.statsUnavailable === true
									? html`<span class="pill-hover__files">Couldn't load changes</span>`
									: this.statsOnHover
										? html`<span class="pill-hover__files">Loading changes…</span>`
										: html`<span class="pill-hover__files">Has working changes</span>`}
						</div>`
					: nothing}
				${item.hasUnpushed === true
					? html`<div class="pill-hover__row">
							<span class="pill-hover__unpushed">
								<code-icon icon="arrow-up"></code-icon>
								${item.ahead != null && item.ahead > 0
									? `${pluralize('commit', item.ahead)} to push`
									: 'Unpushed commits · no upstream'}
							</span>
						</div>`
					: nothing}
				<div class="pill-hover__row">
					${item.agent != null
						? html`
								<span class="pill-hover__agent pill-hover__agent--${item.agent}">
									<code-icon icon="robot"></code-icon>
									Agent · ${getAgentCategoryLabel(item.agent)}
								</span>
							`
						: nothing}
					${item.lastActivity != null
						? html`<span class="pill-hover__time">Updated ${item.lastActivity} ago</span>`
						: nothing}
				</div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-wip-bar': GlGraphWipBar;
	}
}

import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { getBranchId } from '@gitlens/git/utils/branch.utils.js';
import { serializeWebviewItemContext } from '../../../../../system/webview.js';
import type { GraphItemContext, GraphScopeBranch, State } from '../../../../plus/graph/protocol.js';
import { UpdateRefsVisibilityCommand } from '../../../../plus/graph/protocol.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import { renderDetailsMaximizeChip } from '../../../shared/components/details-header/details-maximize-chip.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import { dispatchContextMenuAt } from '../../../shared/dom.js';
import { graphStateContext } from '../context.js';
import { getSelectedRepoPath } from '../utils/repository.utils.js';
import {
	branchSheetContextRef,
	findRowHead,
	parseBranchSheetContext,
	resolveBranchSheetExcludeRef,
	resolveBranchSheetScope,
	resolveLiveBranchSheetContext,
	withPinnedFlag,
} from './branchSheet.utils.js';
import type { ResolvedServices } from './detailsActions.js';
import type { BranchSheetRef } from './gl-graph-branch-sheet-pane.js';
import { SheetWrapper } from './sheetWrapper.js';
import './gl-graph-branch-sheet-pane.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/overlays/detail-sheet.js';
import '../../../shared/components/overlays/tooltip.js';

/**
 * Branch/tag sheet chrome — owns the `gl-detail-sheet` (title, kebab, Pin/Hide/Open-on-Remote/Focus/
 * Maximize chips) and wraps `gl-graph-branch-sheet-pane` as the body. Selection-decoupled: `repoPath`
 * is resolved once by the panel at open (see `GlGraphDetailsPanel.openBranchSheet`), not derived from
 * live selection.
 *
 * Emits (bubbles + composed):
 * - `gl-graph-scope-to-branch` {GraphScopeBranch} — the Focus chip
 * - `gl-detail-sheet-close` — re-emitted for both the inner sheet's own dismissal and the pane's own
 *   close request (see {@link SheetWrapper})
 */
@customElement('gl-graph-branch-sheet')
export class GlGraphBranchSheet extends SheetWrapper(SignalWatcher(LitElement)) {
	static override styles = [
		css`
			:host {
				display: block;
			}

			* {
				box-sizing: border-box;
			}

			/* Branch sheet header identity — icon + (remote-qualified) name + a ref-kind badge, slotted
			   into gl-detail-sheet's title slot in place of the plain sheet-title string. */
			.branch-sheet-title {
				display: flex;
				gap: 0.6rem;
				align-items: center;
				min-width: 0;
			}

			.branch-sheet-title--head {
				color: var(--gl-branch-color, var(--vscode-gitlens-graphScrollMarkerLocalBranchesColor, inherit));
			}

			.branch-sheet-title--remote {
				color: var(--vscode-gitlens-graphScrollMarkerRemoteBranchesColor, inherit);
			}

			.branch-sheet-title--tag {
				color: var(--vscode-gitlens-graphScrollMarkerTagsColor, inherit);
			}

			/* The tooltip host is display: contents, so the name span itself is the flex item —
			   shrinkable but not growing, keeping the kebab directly after the name's end. */
			.branch-sheet-title__name-tooltip {
				min-width: 0;
			}

			.branch-sheet-title__name {
				flex: 0 1 auto;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			/* The ref-kind color belongs to the identity (icon + name) only — the chips are chrome, so
			   they take the header's own foreground like the right-side actions do. */
			.branch-sheet-title__kebab,
			.branch-sheet-title__action {
				flex: none;
				color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
			}
		`,
	];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@consume({ context: graphStateContext, subscribe: true })
	private _graphState?: typeof graphStateContext.__context__;

	@consume({ context: ipcContext })
	private _ipc?: typeof ipcContext.__context__;

	/** The ref this sheet is scoped to (name/refType/remote/sha/context). */
	@property({ attribute: false })
	ref?: BranchSheetRef;

	/**
	 * Resolved by the panel at open, not here. The sheet describes a BRANCH, so its repo must not
	 * follow the selection — `effectiveRepoPath` does: focusing moves the selection to the branch's
	 * worktree WIP row, which flips it to that worktree's path. The pane keys its identity on
	 * `repoPath`, so that flip makes it abort and refetch — the body blanks and repopulates under
	 * the user. The panel fixes `repoPath` once, at open, and never lets it follow the selection.
	 */
	@property({ attribute: 'repo-path' })
	repoPath?: string;

	/** Monotonic stamp bumped by the details panel whenever the graph's row/branch data changes.
	 *  Pass-through to the pane, which refreshes its enrichment in place when it changes. */
	@property({ type: Number })
	changeStamp?: number;

	@property({ attribute: false })
	services?: ResolvedServices;

	@property()
	dateFormat?: string;

	@property()
	dateStyle?: string;

	@property({ type: Boolean, attribute: 'ai-enabled' })
	aiEnabled = false;

	@property({ attribute: false })
	aiModel?: AiModelInfo;

	@property({ attribute: false })
	orgSettings?: State['orgSettings'];

	@property({ type: Boolean, attribute: 'show-maximize' })
	showMaximize = false;

	/** Fed from the panel's SHEET maximize state (transient, derived) — not the panel's own. */
	@property({ type: Boolean, attribute: 'maximized' })
	maximized = false;

	override render(): unknown {
		if (this.ref == null) return nothing;

		const ref = this.ref;
		// Remote-qualify the title the same way the pane does ("origin/main", not "main") — `ref.name`
		// alone is the bare branch name shared with its local tracking counterpart.
		const title = ref.refType === 'remote' && ref.remote != null ? `${ref.remote}/${ref.name}` : ref.name;
		const kind = ref.refType === 'tag' ? 'Tag' : ref.refType === 'remote' ? 'Remote Branch' : 'Branch';
		const icon = ref.refType === 'tag' ? 'tag' : 'git-branch';
		// Live-resolved from the loaded row the same way the graph's own ref pills build theirs — carries every
		// flag (+tracking/+remote/+worktree/+current/+pinned/…), not just pin, so the kebab menu and the chips
		// below track publish/upstream/pin changes made while this sheet stays open. Falls back to the open-time
		// snapshot when the ref's row hasn't paged in.
		const liveContext = resolveLiveBranchSheetContext(
			ref,
			this._graphState?.rows,
			this.repoPath,
			this._graphState?.pinnedRef?.id,
		);
		const context = liveContext ?? parseBranchSheetContext(ref.context);
		// Resolved from LIVE pin state, never the ref's open-time context — the pin can change from this sheet,
		// a graph row, the pinned pill, or the side bar, and a snapshot leaves the kebab's menu offering the
		// wrong action (and `unpinBranchFromEdge` ignores its item, so it would clear whatever IS pinned).
		// `pinnedRef` is `@signalState()` and this component is a `SignalWatcher`, so reading it here is also what
		// subscribes the sheet to those external changes.
		const sheetRefId = branchSheetContextRef(context)?.id;
		const isPinned = sheetRefId != null && this._graphState?.pinnedRef?.id === sheetRefId;
		// The live context already has the correct `+pinned` flag baked in (passed above); only the snapshot
		// fallback needs it re-stamped, since pin is the one thing guaranteed fresh for an unloaded ref.
		const kebabContext =
			liveContext != null ? serializeWebviewItemContext(liveContext) : withPinnedFlag(ref.context, isPinned);
		// "head" (local, incl. current/worktree) reuses the WIP header's static-branch color hook;
		// remote/tag have no such hook yet (single consumer so far) — go straight to their own
		// scroll-marker tokens.
		const titleModifier = ref.refType === 'tag' ? 'tag' : ref.refType === 'remote' ? 'remote' : 'head';

		// The ref pill acts as a toggle, so focus must stay on it.
		return html`<gl-detail-sheet
			preserve-trigger-focus
			esc-managed
			aria-label=${kind}
			sheet-title=${title}
			close-label="Close"
			@gl-detail-sheet-close=${this.handleInnerClose}
		>
			<span slot="title" class="branch-sheet-title branch-sheet-title--${titleModifier}">
				<code-icon class="branch-sheet-title__icon" icon=${icon}></code-icon>
				<gl-tooltip content=${title} class="branch-sheet-title__name-tooltip">
					<span class="branch-sheet-title__name">${title}</span>
				</gl-tooltip>
				${
					ref.context != null
						? html`<gl-action-chip
								class="branch-sheet-title__kebab"
								icon="kebab-vertical"
								label=${ref.refType === 'tag' ? 'Show Tag Actions' : 'Show Branch Actions'}
								overlay="tooltip"
								data-vscode-context=${kebabContext}
								@click=${this.handleKebabClick}
							></gl-action-chip>`
						: nothing
				}
				${this.renderOpenOnRemoteChip(ref, context)}
			</span>
			${this.renderFocusChip(ref)}
			${
				context != null && ref.refType !== 'tag'
					? html`<gl-action-chip
							slot="actions"
							icon=${isPinned ? 'pinned' : 'pin'}
							label=${isPinned ? 'Unpin Branch from Edge' : 'Pin Branch to Edge'}
							overlay="tooltip"
							href=${this._webview.createCommandLink<GraphItemContext>(
								isPinned ? 'gitlens.graph.unpinBranchFromEdge' : 'gitlens.graph.pinBranchToEdge',
								context,
							)}
						></gl-action-chip>`
					: nothing
			}
			${this.renderHideChip(ref, context)}
			${this.showMaximize ? renderDetailsMaximizeChip(this.maximized, true, true) : nothing}
			<gl-graph-branch-sheet-pane
				.ref=${ref}
				.services=${this.services}
				.repoPath=${this.repoPath}
				.dateFormat=${this.dateFormat}
				.dateStyle=${this.dateStyle}
				.aiEnabled=${this.aiEnabled}
				.aiModel=${this.aiModel}
				.orgSettings=${this.orgSettings}
				.changeStamp=${this.changeStamp}
				@gl-graph-branch-sheet-close-request=${this.handleInnerClose}
			></gl-graph-branch-sheet-pane>
		</gl-detail-sheet>`;
	}

	/** ⋮ in the sheet title → the same VS Code context menu as the graph row: synthesize a
	 *  `contextmenu` at the chip so the host resolves its `data-vscode-context`. */
	private handleKebabClick = (e: MouseEvent): void => {
		e.preventDefault();
		e.stopPropagation();

		const target = e.currentTarget as HTMLElement | null;
		if (target == null) return;

		dispatchContextMenuAt(target);
	};

	/** Focus is a chrome action that reuses the existing scope pipeline; the sheet's content
	 *  actions (switch/publish/sync/PR/merge-target) are self-contained in gl-graph-branch-sheet-pane. */
	private handleFocus(ref: BranchSheetRef): void {
		const scope = resolveBranchSheetScope(ref, this._graphState?.rows);
		if (scope == null) return;

		// Already focused here — clicking again unfocuses. `clearScope` doesn't navigate, so the
		// selection stays on the sheet's row and there's no auto-close to arm against; arming here
		// would leave the flag set to swallow the user's NEXT real navigation instead.
		const repoPath = getSelectedRepoPath(this._graphState ?? {});
		// The sheet's focus action is always a plain branch focus — a stack/PR-origin scope on the same
		// branch is a different scope, so it re-focuses instead of clearing.
		if (
			repoPath != null &&
			this._graphState?.scope?.origin == null &&
			this._graphState?.scope?.branchRef === getBranchId(repoPath, scope.remote ?? false, scope.branchName)
		) {
			this._graphState.clearScope();
			return;
		}

		this.dispatchEvent(
			new CustomEvent<GraphScopeBranch>('gl-graph-scope-to-branch', {
				detail: scope,
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** The sheet's Focus chip — branches and remote branches only. The label stays "Focus on Branch"
	 *  for both: a remote ref usually resolves to its local counterpart, so naming the remote would
	 *  misdescribe what gets focused. */
	private renderFocusChip(ref: BranchSheetRef): unknown {
		if (ref.refType !== 'head' && ref.refType !== 'remote') return nothing;

		return html`<gl-action-chip
			slot="actions"
			icon="target"
			label="Focus on Branch"
			overlay="tooltip"
			@click=${() => this.handleFocus(ref)}
		></gl-action-chip>`;
	}

	/** The sheet's Hide/Show chip. Unlike Focus, this one DOES carry its state — whether a ref is
	 *  hidden is durable filter state that outlives the sheet, so the button names which way it will
	 *  go. `excludeRefs` is `@signalState()` and this component is a `SignalWatcher`, so the host's
	 *  visibility push re-renders the chip; no optimistic local copy — same rule as Pin. */
	private renderHideChip(ref: BranchSheetRef, context: GraphItemContext | undefined): unknown {
		const excluded = resolveBranchSheetExcludeRef(ref, context);
		if (excluded == null) return nothing;

		const hidden = this._graphState?.excludeRefs?.[excluded.id] != null;

		return html`<gl-action-chip
			slot="actions"
			icon=${hidden ? 'eye' : 'eye-closed'}
			label="${hidden ? 'Show' : 'Hide'} ${ref.refType === 'tag' ? 'Tag' : 'Branch'}"
			overlay="tooltip"
			@click=${() => this._ipc?.sendCommand(UpdateRefsVisibilityCommand, { refs: [excluded], visible: hidden })}
		></gl-action-chip>`;
	}

	/** The sheet's Open on Remote chip — only for a ref that actually exists on a remote. A remote ref
	 *  always qualifies; a local head is resolved LIVE off `this._graphState.rows` (same pattern as the
	 *  Pin chip's `isPinned`), since `context` is a snapshot from open time and publishing the branch or
	 *  changing its upstream while the sheet is open wouldn't otherwise move the gate. Falls back to the
	 *  snapshot's `+tracking`/`+remote` flags when the branch's tip row hasn't paged in yet. */
	private renderOpenOnRemoteChip(ref: BranchSheetRef, context: GraphItemContext | undefined): unknown {
		if (context == null || (ref.refType !== 'head' && ref.refType !== 'remote')) return nothing;

		if (ref.refType === 'head') {
			const head = findRowHead(this._graphState?.rows, h => h.name === ref.name);
			const hasRemote =
				head != null
					? head.upstream != null && !head.upstream.missing
					: context.webviewItem.includes('+tracking') || context.webviewItem.includes('+remote');

			if (!hasRemote) return nothing;
		}

		return html`<gl-action-chip
			class="branch-sheet-title__action"
			icon="globe"
			label="Open Branch on Remote"
			alt-icon="copy"
			alt-label="Copy Remote Branch URL"
			overlay="tooltip"
			href=${this._webview.createCommandLink<GraphItemContext>('gitlens.graph.openBranchOnRemote', context)}
			alt-href=${this._webview.createCommandLink<GraphItemContext>('gitlens.graph.copyRemoteBranchUrl', context)}
		></gl-action-chip>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-branch-sheet': GlGraphBranchSheet;
	}
}

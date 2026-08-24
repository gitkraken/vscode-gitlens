import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { HeldActionController } from '../../shared/controllers/held-action.js';

declare const CloseWatcher: CloseWatcher;
interface CloseWatcher extends EventTarget {
	// oxlint-disable-next-line typescript/no-misused-new
	new (options?: CloseWatcherOptions): CloseWatcher;
	requestClose(): void;
	close(): void;
	destroy(): void;

	oncancel: (event: Event) => void | null;
	onclose: (event: Event) => void | null;
}
interface CloseWatcherOptions {
	signal: AbortSignal;
}

/** One-time-bound view of the host state the overlay side bar's auto-collapse/Esc/focus-handoff
 *  behaviors read. Built ONCE by `<gl-graph-app>` as closures over itself; none of these run on a
 *  hot path. */
export type SidebarOverlayHostDeps = {
	sidebarOpen(): boolean;
	sidebarPinned(): boolean;
	hideSidebar(): void;
	focusGraph(): void;
	railEl(): HTMLElement | undefined;
	panelEl(): HTMLElement | undefined;
	scopeBranchRef(): string | undefined;
};

/**
 * The overlay (unpinned) side bar's dismissal behaviors:
 *
 * - Auto-collapse on focusout / outside pointerdown / webview blur, with suppression while a native
 *   context menu is in flight.
 * - Esc-to-close via a `CloseWatcher` (with a document keydown fallback), armed/disarmed per render.
 * - Deferred focus handoff to the graph and held sidebar-select navigation across the double-click
 *   grace window.
 *
 * The collapse listeners gate themselves on mode + visibility, so they stay attached for the lifetime
 * of the component and become inert in split mode; the Esc handling cannot self-gate that way (a
 * lifetime watcher would swallow every Esc) and is armed/disarmed from the host's `updated()`.
 */
export class SidebarOverlayController implements ReactiveController {
	// Set when a right-click / context-menu request is in flight. VS Code's native context menu
	// steals webview focus on open, which would otherwise cascade through focusout +
	// webview-blur and dismiss the overlay sidebar before the user can interact with the menu.
	// Cleared on webview-focus (when the menu closes and focus returns) or on the next primary
	// pointerdown (safety net in case no menu actually appears).
	private _suppressOverlayCollapseForMenu = false;

	private readonly _host: ReactiveControllerHost & HTMLElement;
	private readonly deps: SidebarOverlayHostDeps;
	private readonly _overlayFocusHandoff: HeldActionController;
	private readonly _selectNav: HeldActionController;

	constructor(controllerHost: ReactiveControllerHost & HTMLElement, deps: SidebarOverlayHostDeps, graceMs: number) {
		this._host = controllerHost;
		this.deps = deps;
		this._overlayFocusHandoff = new HeldActionController(controllerHost, graceMs);
		this._selectNav = new HeldActionController(controllerHost, graceMs);
		controllerHost.addController(this);
	}

	hostConnected(): void {
		document.addEventListener('focusout', this._onFocusOut, true);
		document.addEventListener('pointerdown', this._onPointerDown, true);
		document.addEventListener('contextmenu', this._onContextMenu, true);
		window.addEventListener('webview-blur', this._onWebviewBlur, false);
		window.addEventListener('webview-focus', this._onWebviewFocus, false);
	}

	hostDisconnected(): void {
		document.removeEventListener('focusout', this._onFocusOut, true);
		document.removeEventListener('pointerdown', this._onPointerDown, true);
		document.removeEventListener('contextmenu', this._onContextMenu, true);
		window.removeEventListener('webview-blur', this._onWebviewBlur, false);
		window.removeEventListener('webview-focus', this._onWebviewFocus, false);
		this._sidebarCloseWatcher?.destroy();
		this._sidebarCloseWatcher = null;
		this._escArmed = false;
		document.removeEventListener('keydown', this._onEscKeydown);
	}

	private _onFocusOut = (e: FocusEvent): void => {
		if (!this.shouldAutoCollapse()) return;
		if (this._suppressOverlayCollapseForMenu) return;

		const next = e.relatedTarget as Node | null;
		// Focus left the webview entirely — handled by _onWebviewBlur, not
		// here, so we don't react to in-webview focus moves to non-focusable nodes.
		if (next == null) return;
		if (this.isInsideZone(next)) return;

		this.scheduleAutoCollapse();
	};

	private _onPointerDown = (e: PointerEvent): void => {
		if (!this.shouldAutoCollapse()) return;
		if (e.button !== 0) {
			// Non-primary button — almost certainly a right-click context menu. Set a flag
			// before the focusout/webview-blur cascade so they don't dismiss the sidebar.
			this._suppressOverlayCollapseForMenu = true;
			return;
		}

		// Primary button — clear any stale suppression (e.g. a prior right-click that opened
		// no menu and never received a webview-focus to clear the flag).
		this._suppressOverlayCollapseForMenu = false;

		const target = e.target as Node | null;
		if (target == null) return;
		if (this.isInsideZone(target)) return;

		this.scheduleAutoCollapse();
	};

	private _onContextMenu = (): void => {
		// Covers keyboard-triggered context menus (Shift+F10, ContextMenu key) which fire no
		// pointerdown. For mouse-triggered menus, the pointerdown handler has already set the
		// flag; setting it again here is a harmless no-op.
		if (!this.shouldAutoCollapse()) return;

		this._suppressOverlayCollapseForMenu = true;
	};

	private _onWebviewBlur = (): void => {
		if (!this.shouldAutoCollapse()) return;
		if (this._suppressOverlayCollapseForMenu) return;

		this.scheduleAutoCollapse();
	};

	private _onWebviewFocus = (): void => {
		// Menu closed (or focus otherwise returned) — clear the suppression so subsequent
		// click-outside interactions collapse normally.
		this._suppressOverlayCollapseForMenu = false;
	};

	// Esc-to-close for the overlay (unpinned) side bar — a `CloseWatcher` while the overlay is open,
	// so Esc layers correctly with popovers/sheets (each claims its own close request before ours),
	// with a document keydown fallback otherwise, mirroring `gl-popover`.
	private _sidebarCloseWatcher: CloseWatcher | null = null;
	private _escArmed = false;

	/** Arms/disarms the overlay's Esc dismissal. Called from the host's `updated()` since every
	 *  open/close/pin transition lands in a render; a lifetime watcher would swallow every Esc, so
	 *  unlike the collapse listeners this cannot stay attached and self-gate. */
	ensureEscHandling(): void {
		const active = this.shouldAutoCollapse();
		if (active === this._escArmed) return;

		this._escArmed = active;
		if (active) {
			if ('CloseWatcher' in window) {
				this._sidebarCloseWatcher = new CloseWatcher();
				this._sidebarCloseWatcher.onclose = () => this.closeFromEsc();
			} else {
				document.addEventListener('keydown', this._onEscKeydown);
			}
		} else {
			this._sidebarCloseWatcher?.destroy();
			this._sidebarCloseWatcher = null;
			document.removeEventListener('keydown', this._onEscKeydown);
		}
	}

	private _onEscKeydown = (e: KeyboardEvent): void => {
		// A consumed Esc closed something else — mirrors the `CloseWatcher` path above, where a
		// preventDefault'ed keydown cancels the close request outright.
		if (e.key !== 'Escape' || e.defaultPrevented) return;

		e.stopPropagation();
		this.closeFromEsc();
	};

	private closeFromEsc(): void {
		if (!this.shouldAutoCollapse()) return;

		this.deps.hideSidebar();
		// The hide makes the panel inert, dropping focus to the body — land it on the rail's resting
		// stop (the icon owning the panel that just closed) so keyboard flow continues from there.
		this.deps.railEl()?.focus();
	}

	/** Pending focus handoff to the graph after an overlay-sidebar row select. Deferred rather than
	 *  immediate: the handoff's focusout is what auto-collapses the unpinned overlay, and an immediate
	 *  collapse tears the row out from under a double-click's second click — which would then land on
	 *  the graph underneath, even on rows whose double-click does nothing. Restarted on every select,
	 *  so the second click extends it; when it fires after a scope, it collapses the overlay over the
	 *  now-scoped graph. */
	deferFocusHandoff(): void {
		this._overlayFocusHandoff.hold(() => {
			if (!this.shouldAutoCollapse()) return;

			this.deps.focusGraph();
		});
	}

	/** A sidebar row select's navigation, held for the double-click grace window on rows whose
	 *  double-click scopes (see `GraphSidebarPanelSelectEventDetail.canFocus`) — navigating immediately
	 *  scrolls to the row's commit and then the scope restructures the view, two jarring moves. A scope
	 *  arriving inside the window supersedes it (`handleScopeToBranchFromHeader`); the scope path
	 *  navigates on its own. */
	deferSelectNavigation(navigate: () => void): void {
		// Captured at arm time: a scope change landing inside the grace window (a double-click's
		// unfocus toggle clears the scope WITHOUT a scope-to-branch event) means the held navigation
		// belongs to a view that no longer exists — skip it rather than yank the restructured graph.
		const armedScopeRef = this.deps.scopeBranchRef();
		this._selectNav.hold(() => {
			if (this.deps.scopeBranchRef() !== armedScopeRef) return;

			navigate();
		});
	}

	cancelSelectNavigation(): void {
		this._selectNav.cancel();
	}

	// Pre-collapse open state captured synchronously when the auto-collapse fires. The
	// sidebar toggle button's click runs in a later task — by then the queued hide has
	// already mutated state, so handleToggleSidebar would see the post-collapse value and
	// flip the toggle backwards. This snapshot lets the click handler honor the user's
	// actual pre-click intent. Cleared on read.
	private _openAtAutoCollapse: boolean | undefined;

	/** Returns (and clears) the sidebar's open state as of the last auto-collapse, for a toggle
	 *  click landing after the queued hide. */
	takeOpenAtAutoCollapse(): boolean | undefined {
		const stashed = this._openAtAutoCollapse;
		this._openAtAutoCollapse = undefined;
		return stashed;
	}

	private scheduleAutoCollapse(): void {
		this._openAtAutoCollapse = this.deps.sidebarOpen();
		// Microtask, not sync: lets any same-task handlers run before the actual hide; the
		// click handler in a later task reads _openAtAutoCollapse instead of current state.
		// hideSidebar gates on already-hidden so a stale schedule is a no-op.
		queueMicrotask(() => this.deps.hideSidebar());
	}

	shouldAutoCollapse(): boolean {
		if (this.deps.sidebarPinned()) return false;
		if (!this.deps.sidebarOpen()) return false;
		return true;
	}

	isInsideZone(node: Node): boolean {
		const rail = this._host.querySelector('gl-graph-sidebar');
		if (rail?.contains(node)) return true;

		const panel = this.deps.panelEl();
		if (panel?.contains(node)) return true;

		// Pointerdown / focusout from the split-panel divider (in its shadow DOM) retargets to
		// the split-panel host. Without this, dragging the divider auto-collapses the panel.
		const sidebarSplit = this._host.querySelector('.graph__sidebar-split');
		if (sidebarSplit === node) return true;
		return false;
	}
}

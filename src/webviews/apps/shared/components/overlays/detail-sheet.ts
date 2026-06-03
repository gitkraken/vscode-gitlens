import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import '../chips/action-chip.js';
import '../code-icon.js';

declare const CloseWatcher: CloseWatcher;
interface CloseWatcher extends EventTarget {
	// oxlint-disable-next-line @typescript-eslint/no-misused-new
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

declare global {
	interface HTMLElementTagNameMap {
		'gl-detail-sheet': GlDetailSheet;
	}

	interface GlobalEventHandlersEventMap {
		'gl-detail-sheet-close': CustomEvent<void>;
	}
}

/**
 * In-panel slide-up detail sheet. Positions itself absolutely over its parent (which must be
 * `position: relative` or `position: absolute`), renders a dimming scrim across the parent, and
 * animates the sheet up from the bottom edge.
 *
 * Modal with respect to the parent (`aria-modal=true`, scrim, `inert` underlay), but does NOT
 * trap focus — sibling elements outside the parent (e.g. the graph beside the details panel)
 * remain fully interactive while the sheet is open. This is intentional for selection-decoupled
 * content (e.g. compare) where the user benefits from continued navigation in the broader UI.
 *
 * Esc and the built-in close button emit `gl-detail-sheet-close`. Custom toolbar actions go
 * through the `actions` slot. Focus is restored to the previously-focused element on close.
 */
@customElement('gl-detail-sheet')
export class GlDetailSheet extends LitElement {
	static override styles = [
		css`
			:host {
				/* Scoped to the parent host (e.g. .details-host) — sheet covers the details-panel
				   area only, leaving the graph as a sibling beside it. The scrim darkens just the
				   details panel; clicks on the scrim close the sheet. z-index sits above the
				   sticky details-header (z-index 10) so the sheet renders OVER the underlying
				   panel header, not behind it. */
				position: absolute;
				inset: 0;
				display: flex;
				flex-direction: column;
				pointer-events: none;
				z-index: 20;
			}

			.scrim {
				position: absolute;
				inset: 0;
				background-color: rgba(0, 0, 0, 0.55);
				backdrop-filter: blur(0.3rem);
				pointer-events: auto;
				animation: gl-sheet-scrim-fade 0.18s ease-out;
			}

			:host([closing]) .scrim {
				/* Mirror the entry: fade scrim out alongside the sheet's slide-down. The forwards
				   fill-mode pins the final opacity so there's no flash back to full opacity between
				   the animation ending and the host removing the sheet from the DOM. Distinct
				   animation name (vs. the entry's gl-sheet-scrim-fade) so the browser starts a
				   fresh run instead of treating it as a continuation of the finished entry. */
				animation: gl-sheet-scrim-fade-out 0.18s ease-in forwards;
			}

			.sheet {
				position: relative;
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				/* Fills the host area so the sheet occupies the entire details panel — the
				   underlying content stays under the scrim, not peeking through above. */
				width: 100%;
				height: 100%;
				background: var(--vscode-sideBar-background, var(--color-background));
				border-top: 0.1rem solid var(--vscode-widget-border, var(--color-foreground--25));
				box-shadow: 0 -0.4rem 1.2rem -0.2rem var(--vscode-widget-shadow);
				pointer-events: auto;
				animation: gl-sheet-slide-up 0.2s ease-out;
			}

			:host([closing]) .sheet {
				/* Slide down off the bottom edge. The forwards fill-mode pins translateY(100%)
				   so the sheet stays parked off-screen until the host removes it. Distinct
				   animation name (vs. the entry's gl-sheet-slide-up) so the browser starts a
				   fresh run instead of treating it as a continuation of the finished entry. */
				animation: gl-sheet-slide-down 0.2s ease-in forwards;
			}

			.sheet__header {
				flex: 0 0 auto;
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 0.8rem;
				padding: 0.8rem 0.8rem 0.8rem 1.6rem;
				border-bottom: 0.1rem solid var(--vscode-widget-border, var(--color-foreground--25));
				min-height: 4.2rem;
				background: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background));
				color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
				border-top-left-radius: 0.4rem;
				border-top-right-radius: 0.4rem;
				box-sizing: border-box;
			}

			.sheet__title {
				flex: 1 1 auto;
				min-width: 0;
				font-size: 1.4rem;
				font-weight: 600;
				color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.sheet__title:empty {
				display: none;
			}

			.sheet__actions {
				flex: 0 0 auto;
				display: inline-flex;
				align-items: center;
				gap: 0.2rem;
			}

			.sheet__body {
				flex: 1 1 auto;
				min-height: 0;
				display: flex;
				flex-direction: column;
				overflow: hidden;
			}

			.sheet__footer {
				flex: 0 0 auto;
				display: flex;
				gap: 0.8rem;
				padding: 0.6rem 1.2rem;
				border-top: 0.1rem solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.sheet__footer:empty {
				display: none;
			}

			@keyframes gl-sheet-slide-up {
				from {
					transform: translateY(100%);
				}
				to {
					transform: translateY(0);
				}
			}

			@keyframes gl-sheet-slide-down {
				from {
					transform: translateY(0);
				}
				to {
					transform: translateY(100%);
				}
			}

			@keyframes gl-sheet-scrim-fade {
				from {
					opacity: 0;
				}
				to {
					opacity: 1;
				}
			}

			@keyframes gl-sheet-scrim-fade-out {
				from {
					opacity: 1;
				}
				to {
					opacity: 0;
				}
			}

			@media (prefers-reduced-motion: reduce) {
				.sheet,
				.scrim {
					animation: none;
				}
			}
		`,
	];

	@property({ type: Boolean })
	dismissible = true;

	@property({ type: String, attribute: 'sheet-title' })
	sheetTitle: string | null = null;

	@property({ type: String, attribute: 'close-label' })
	closeLabel = 'Close';

	@property({ type: String, attribute: 'aria-label' })
	override ariaLabel: string | null = null;

	/** Reflected so CSS can switch entry → exit animations via `:host([closing])`. Internal —
	 *  flipped by `requestClose`, never set by consumers. */
	@property({ type: Boolean, reflect: true })
	closing = false;

	/** When `true`, `disconnectedCallback` skips the focus restoration to the pre-open element.
	 *  Consumers transitioning the sheet into a sibling pinned-panel form (compare's "Move
	 *  Beside" / "Move Below") set this so focus doesn't snap back to the row that opened the
	 *  sheet — leaving the user free to focus the new pinned panel. Plain dismissal (Esc,
	 *  scrim, X close) leaves this `false` so focus correctly returns to the trigger element. */
	skipFocusRestore = false;

	@query('.sheet')
	private sheetEl!: HTMLElement;

	private closeWatcher: CloseWatcher | null = null;
	private previouslyFocused: HTMLElement | null = null;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.previouslyFocused = (document.activeElement as HTMLElement) ?? null;

		if ('CloseWatcher' in window) {
			this.closeWatcher = new CloseWatcher();
			// Match the dismissibility guard on the polyfill keydown path / scrim click — a
			// non-dismissible sheet must NOT close on Esc via the native CloseWatcher either.
			this.closeWatcher.onclose = () => {
				if (!this.dismissible) return;

				this.requestClose();
			};
		} else {
			document.addEventListener('keydown', this.handleDocumentKeyDown, true);
		}

		// Focus the sheet itself so keyboard users land here on open. We do NOT trap focus —
		// sibling elements outside the host parent (e.g. the graph beside the details panel)
		// remain fully interactive. Guard against a rapid open/close cycle: if the sheet
		// disconnects within the frame, the rAF still fires; the `isConnected` check drops `this`
		// for GC instead of holding it for an extra frame.
		requestAnimationFrame(() => {
			if (!this.isConnected) return;

			this.sheetEl?.focus({ preventScroll: true });
		});
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this.closeWatcher?.destroy();
		this.closeWatcher = null;
		document.removeEventListener('keydown', this.handleDocumentKeyDown, true);
		// Cancel any in-flight exit animation handles so the rAF callback + fallback timer
		// can't dispatch a close event on a detached element (or retain `this` for an extra
		// frame / 250ms under rapid open-close cycling).
		if (this._closeRafId != null) {
			cancelAnimationFrame(this._closeRafId);
			this._closeRafId = undefined;
		}
		if (this._closeFallbackTimer != null) {
			clearTimeout(this._closeFallbackTimer);
			this._closeFallbackTimer = undefined;
		}

		const target = this.previouslyFocused;
		this.previouslyFocused = null;
		if (this.skipFocusRestore) return;

		if (target?.isConnected) {
			try {
				target.focus({ preventScroll: true });
			} catch {
				/* swallow — focus restoration is best-effort */
			}
		}
	}

	override render(): unknown {
		return html`
			<div class="scrim" part="scrim" @click=${this.handleScrimClick}></div>
			<section
				class="sheet"
				part="sheet"
				role="dialog"
				aria-modal="true"
				aria-label=${this.ariaLabel ?? this.sheetTitle ?? 'Details'}
				tabindex="-1"
			>
				<header class="sheet__header" part="header">
					<div class="sheet__title" part="title">
						<slot name="title">${this.sheetTitle ?? nothing}</slot>
					</div>
					<div class="sheet__actions" part="actions">
						<slot name="actions"></slot>
						${this.dismissible
							? html`<gl-action-chip
									icon="close"
									label=${this.closeLabel}
									overlay="tooltip"
									aria-label=${this.closeLabel}
									@click=${this.requestClose}
								></gl-action-chip>`
							: nothing}
					</div>
				</header>
				<div class="sheet__body" part="body">
					<slot></slot>
				</div>
				<div class="sheet__footer" part="footer">
					<slot name="footer"></slot>
				</div>
			</section>
		`;
	}

	private readonly handleDocumentKeyDown = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape' || !this.dismissible) return;

		e.stopPropagation();
		e.preventDefault();
		this.requestClose();
	};

	private readonly handleScrimClick = (): void => {
		if (!this.dismissible) return;

		this.requestClose();
	};

	private _closeRafId?: number;
	private _closeFallbackTimer?: ReturnType<typeof setTimeout>;

	private readonly requestClose = (): void => {
		// Re-entrancy guard — multiple Esc presses / scrim clicks during the exit animation
		// shouldn't queue extra close events. The host removes us on the first one.
		if (this.closing) return;

		// Reduced motion (or no sheet element to animate yet): emit immediately, skip the
		// exit animation entirely.
		const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
		if (reduced || this.sheetEl == null) {
			this.dispatchCloseEvent();
			return;
		}

		this.closing = true;
		// Wait for Lit to apply the [closing] attribute and the CSS rule to install the new
		// animation. Read getAnimations() on the next frame so the reverse animation we care
		// about is present, then dispatch on its `finished` Promise. Falls back to a hard
		// timeout matching the animation duration so a stuck animation can't trap the close.
		// Both the rAF and the fallback timer are stored so `disconnectedCallback` can cancel
		// them — otherwise a rapid open/close cycle leaves `this` retained for an extra ~250ms
		// per cycle and the fallback can fire on a detached element.
		const exitAnimationMs = 200;
		this._closeRafId = requestAnimationFrame(() => {
			this._closeRafId = undefined;
			if (!this.isConnected) return;

			const anims = this.sheetEl?.getAnimations() ?? [];
			const exit = anims.find(a => a.playState === 'running');
			if (exit == null) {
				this.dispatchCloseEvent();
				return;
			}

			exit.finished.then(() => this.dispatchCloseEvent()).catch(() => this.dispatchCloseEvent());
			// Safety net: if `finished` never resolves (browser quirk on interrupted animations),
			// fire after the nominal duration plus a small slack.
			this._closeFallbackTimer = setTimeout(() => {
				this._closeFallbackTimer = undefined;
				if (this.isConnected) {
					this.dispatchCloseEvent();
				}
			}, exitAnimationMs + 50);
		});
	};

	private _closeDispatched = false;
	private dispatchCloseEvent(): void {
		if (this._closeDispatched) return;

		this._closeDispatched = true;
		this.dispatchEvent(
			new CustomEvent('gl-detail-sheet-close', {
				bubbles: true,
				composed: true,
			}),
		);
	}
}

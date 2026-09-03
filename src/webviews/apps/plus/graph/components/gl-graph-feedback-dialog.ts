import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { scrollableBase } from '@gitlens/components/components/styles/lit/base.css.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { KeymapDispatcher } from '@gitlens/utils/keys/keymapDispatcher.js';
import { urls } from '../../../../../constants.js';
import type { GraphFeedbackType } from '../../../../plus/graph/graphService.js';
import type { Unsubscribe } from '../../../../rpc/services/types.js';
import type { GlDialog } from '../../../shared/components/overlays/dialog.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import { graphServicesContext } from '../context.js';
import '@gitlens/components/components/codeIcon.js';
import '../../../shared/components/button.js';
import '../../../shared/components/overlays/dialog.js';

interface FeedbackTypeEntry {
	type: GraphFeedbackType;
	icon: string;
	label: string;
	placeholder: string;
	/** Shown under the message when the type has a GitHub hand-off, so nothing surprises after Send. */
	hint?: string;
}

const feedbackTypes: readonly FeedbackTypeEntry[] = [
	{ type: 'general', icon: 'comment', label: 'General', placeholder: "Tell us what's on your mind…" },
	{
		type: 'bug_report',
		icon: 'bug',
		label: 'Bug',
		placeholder: 'What happened, and what did you expect instead?',
		hint: 'Sending will also open a GitHub issue prefilled with your message, so you can add logs and details.',
	},
	{
		type: 'feature_request',
		icon: 'lightbulb',
		label: 'Feature',
		placeholder: 'What would you like GitLens to do?',
		hint: 'After sending, you can also file it as a GitHub issue, prefilled with your message.',
	},
];

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-feedback-dialog': GlGraphFeedbackDialog;
	}

	interface GlobalEventHandlersEventMap {
		/** Fired on every close path (✕, Cancel, Esc, a successful send) — the app refocuses
		 *  the graph, since the dialog's own focus lands nowhere useful once it closes. */
		'gl-graph-feedback-closed': CustomEvent<void>;
	}
}

/**
 * The "Send Feedback" dialog (feedback about GitLens as a whole; the graph is just where it lives for
 * now) — a modal over the whole graph, reachable from the
 * VS Code title toolbar (`show('toolbar')`, pushed by the host via `GraphFeedbackService.onRequestShow`)
 * and from the header's account popover (`show('account')`). Modeled on `gl-graph-keyboard-shortcuts`.
 */
@customElement('gl-graph-feedback-dialog')
export class GlGraphFeedbackDialog extends LitElement {
	static override styles = [
		scrollableBase,
		css`
			:host {
				display: contents;
			}

			/* Scoped to [open]: an unconditional display on the part would override the UA's
		dialog:not([open]) { display: none } and paint the closed dialog inline under the graph. */
			.feedback-dialog[open]::part(base) {
				display: flex;
				flex-direction: column;
			}

			.feedback-dialog::part(base) {
				/* gl-dialog's own styles don't set box-sizing, so without it here width/max-width size the
	CONTENT box only — the dialog's padding then pushes the actual box past the max-width at
	narrow widths. */
				box-sizing: border-box;
				width: 52rem;
				/* gl-dialog's own min-width: 40rem would otherwise win over the max-width in a narrow
	pane (the graph docked beside a wide sidebar) and push the box off-canvas. */
				min-width: 0;
				max-width: 92vw;
				/* Fixed so switching the type (the bug notice) or a send failure (the error line) resizes the
	textarea, never the dialog; a short host (the graph docked in a shallow panel) caps it and the
	body scrolls instead. */
				height: 40rem;
				max-height: 92vh;
				/* Sections own their own padding (the title bar and footer rules need to sit flush against
	the dialog edge), so the dialog contributes none. */
				padding: 0;
				overflow: hidden;
			}

			.titlebar {
				display: flex;
				gap: var(--gl-space-16);
				align-items: center;
				justify-content: space-between;
				padding: 1.3rem 2rem;
				border-bottom: var(--gl-border-width) solid var(--vscode-widget-border);
			}

			.titlebar h2 {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				margin: 0;
				font-size: var(--gl-font-lg);
				font-weight: 600;
			}

			.close {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 2.4rem;
				height: 2.4rem;
				color: var(--color-foreground--65, var(--vscode-descriptionForeground));
				cursor: pointer;
				background: none;
				border: none;
				border-radius: var(--gl-radius-sm);
			}

			.close:hover {
				color: var(--vscode-foreground);
				background: var(--vscode-toolbar-hoverBackground);
			}

			.body {
				display: flex;
				flex: 1;
				flex-direction: column;
				gap: var(--gl-space-12);
				min-height: 0;
				padding: var(--gl-space-16) var(--gl-space-20);
				overflow: hidden auto;
				/* The segment labels respond to the DIALOG's width, not the viewport's — the graph can be
	docked into a narrow panel while the window stays wide. */
				container-type: inline-size;
			}

			.subtitle {
				margin: 0;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--65, var(--vscode-descriptionForeground));
			}

			/* No min-height: 0 here: the field must never shrink below its label + the textarea's own
	min-height, or the textarea paints over the links row. Only once that floor is reached does the body
	scroll — so the textarea has no rows attribute, which would raise its floor to the row count. */
			.field {
				display: flex;
				flex: 1;
				flex-direction: column;
				gap: var(--gl-space-6);
			}

			.field label {
				font-size: var(--gl-font-sm);
				font-weight: 600;
				color: var(--color-foreground--65, var(--vscode-descriptionForeground));
			}

			.segmented {
				display: grid;
				grid-template-columns: repeat(3, 1fr);
				gap: 0.2rem;
				padding: 0.2rem;
				background: var(--vscode-input-background);
				border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-input-border-radius);
			}

			/* Icon-only below the width where three labelled segments no longer fit on one line; the
	buttons keep their accessible names via aria-label. */
			@container (max-width: 34rem) {
				.segmented .label {
					display: none;
				}
			}

			.segmented button {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				min-width: 0;
				height: 2.6rem;
				padding: 0 var(--gl-space-4);
				gap: var(--gl-space-6);
				white-space: nowrap;
				font-size: var(--gl-font-md);
				color: var(--vscode-foreground);
				background: transparent;
				border: none;
				border-radius: var(--gl-radius-xs);
				cursor: pointer;
			}

			.segmented button:hover {
				background: var(--vscode-toolbar-hoverBackground);
			}

			.segmented button[aria-checked='true'] {
				color: var(--vscode-button-foreground);
				background: var(--vscode-button-background);
			}

			.segmented button:focus-visible {
				outline: var(--gl-border-width) solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.segmented button[disabled] {
				cursor: default;
				opacity: 0.5;
			}

			.segmented code-icon {
				font-size: 1.4rem;
			}

			.textarea {
				box-sizing: border-box;
				flex: 1;
				width: 100%;
				min-height: 6rem;
				padding: 0.6rem 0.8rem;
				margin: 0;
				font-family: inherit;
				font-size: var(--gl-font-base);
				line-height: 1.5;
				color: var(--vscode-input-foreground);
				resize: none;
				background: var(--vscode-input-background);
				border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-input-border-radius);
			}

			.textarea:focus {
				outline: none;
				border-color: var(--vscode-focusBorder);
			}

			.textarea::placeholder {
				color: var(--vscode-input-placeholderForeground);
			}

			.hint {
				margin: 0;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--65, var(--vscode-descriptionForeground));
			}

			.links {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-16);
			}

			.link {
				display: inline-flex;
				gap: var(--gl-space-4);
				align-items: center;
				font-size: var(--gl-font-sm);
				color: var(--vscode-textLink-foreground);
				text-decoration: none;
			}

			.link:hover {
				color: var(--vscode-textLink-activeForeground);
				text-decoration: underline;
			}

			.link code-icon {
				font-size: 1.2rem;
			}

			.error {
				margin: 0;
				font-size: var(--gl-font-sm);
				color: var(--vscode-errorForeground);
			}

			.footer {
				display: flex;
				gap: var(--gl-space-8);
				justify-content: flex-end;
				padding: 1.2rem 2rem;
				border-top: var(--gl-border-width) solid var(--vscode-widget-border);
			}
		`,
	];

	// The overlay dispatcher the dialog joins the Esc stack through — bound by graph-app
	// (`.keymap=${this.keymap}`), same as `gl-graph-keyboard-shortcuts`.
	@property({ attribute: false })
	keymap: KeymapDispatcher<string> | undefined;

	// `@state()`-tracked so `updated()` sees the context ARRIVE: on a cold open the RPC session isn't
	// connected yet when this element connects, so the value is undefined at `connectedCallback` and
	// only lands later (mirrors `gl-graph-treemap`).
	@consume({ context: graphServicesContext, subscribe: true })
	@state()
	private services?: typeof graphServicesContext.__context__;

	@state()
	private open = false;

	@state()
	private type: GraphFeedbackType = 'general';

	@state()
	private message = '';

	@state()
	private pending = false;

	@state()
	private error = false;

	@query('textarea')
	private textareaEl: HTMLTextAreaElement | undefined;

	@query('gl-dialog')
	private dialogEl: GlDialog | undefined;

	private _overlay: Disposable | undefined;
	private _unsubscribe: Unsubscribe | undefined;
	/** The services value the live subscription was made against. The attempt re-runs whenever the
	 *  identity differs — the context arriving after a cold open, a new value after a reconnect, or a
	 *  remount after `disconnectedCallback` cleared it. */
	private _subscribedServices: typeof graphServicesContext.__context__;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.ensureSubscribed();
	}

	override disconnectedCallback(): void {
		this.releaseSubscription();
		this._overlay?.dispose();
		this._overlay = undefined;
		super.disconnectedCallback?.();
	}

	protected override updated(): void {
		this.ensureSubscribed();
	}

	private ensureSubscribed(): void {
		const services = this.services;
		if (services == null || services === this._subscribedServices) return;

		this.releaseSubscription();
		this._subscribedServices = services;
		void this.subscribeToRequestShow(services);
	}

	private releaseSubscription(): void {
		const unsubscribe = this._unsubscribe;
		this._unsubscribe = undefined;
		this._subscribedServices = undefined;
		// `Unsubscribe` may itself be a promise of the real function — resolve before calling it.
		void Promise.resolve(unsubscribe).then(fn => fn?.());
	}

	/** Joins the host's "open the dialog" push (the VS Code title-toolbar command) to `show()` — the
	 *  account popover entry point calls `show('account')` directly instead, since it's already
	 *  reachable from inside the webview. */
	private async subscribeToRequestShow(services: NonNullable<typeof this.services>): Promise<void> {
		let feedback;
		try {
			feedback = await services.feedback;
		} catch {
			// The RPC surface can reject (channel torn down) — the toolbar command just won't open the
			// dialog until a reconnect supplies a new services value and re-runs this.
			feedback = undefined;
		}

		// A disconnect, or a newer services value, while this await was in flight supersedes this attempt.
		if (feedback == null || !this.isConnected || this._subscribedServices !== services) return;

		this._unsubscribe = feedback.onRequestShow(data => this.show(data.source));
	}

	show(source: 'toolbar' | 'account'): void {
		this.open = true;
		// Join the Esc overlay stack: opened over another overlay, LIFO makes the dialog close FIRST.
		// Without this the dispatcher pops the hidden overlay behind the modal and its preventDefault
		// suppresses the native dialog's own Esc dismissal — a dead-looking press.
		this._overlay ??= this.keymap?.pushOverlay({
			id: 'graph-feedback',
			onClose: () => {
				this.close();
				return true;
			},
		});

		emitTelemetrySentEvent(this, { name: 'graph/feedback/opened', data: { source: source } });

		void this.updateComplete.then(() => this.textareaEl?.focus());
	}

	private close = (): void => {
		// Dispose covers every close path the dispatcher didn't drive (✕ button, Cancel).
		this._overlay?.dispose();
		this._overlay = undefined;
		this.open = false;
		this.error = false;
		// Close the native dialog NOW rather than on the next Lit update: its own close restores focus to
		// whatever was focused before `showModal()` (the body, for the toolbar path), and that must land
		// BEFORE the app moves focus to the graph, or it silently undoes the move.
		this.dialogEl?.close();
		// Tell the app so it can land focus on the graph instead of a hidden control or the body.
		this.dispatchEvent(new CustomEvent('gl-graph-feedback-closed'));
	};

	private get canSend(): boolean {
		return !this.pending && this.message.trim().length > 0;
	}

	private selectType(type: GraphFeedbackType, focus: boolean): void {
		this.type = type;

		if (focus) {
			void this.updateComplete.then(() => {
				this.shadowRoot?.querySelector<HTMLButtonElement>(`.segmented button[data-type="${type}"]`)?.focus();
			});
		}
	}

	private handleTypeClick(e: Event): void {
		this.selectType((e.currentTarget as HTMLButtonElement).dataset.type as GraphFeedbackType, false);
	}

	private handleTypeKeydown(e: KeyboardEvent): void {
		const count = feedbackTypes.length;
		const index = feedbackTypes.findIndex(t => t.type === this.type);

		let nextIndex;
		if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
			nextIndex = (index + 1) % count;
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
			nextIndex = (index - 1 + count) % count;
		} else if (e.key === 'Home') {
			nextIndex = 0;
		} else if (e.key === 'End') {
			nextIndex = count - 1;
		} else {
			return;
		}

		e.preventDefault();
		this.selectType(feedbackTypes[nextIndex].type, true);
	}

	private handleMessageInput(e: Event): void {
		this.message = (e.target as HTMLTextAreaElement).value;
	}

	private send = async (): Promise<void> => {
		if (!this.canSend) return;

		this.pending = true;
		this.error = false;

		// A bug report is handled once its GitHub issue opened, whether or not the record itself reached
		// the events intake; anything else is handled only when the record was sent. The host reports
		// the outcome to telemetry, so nothing is emitted here.
		let handled = false;
		try {
			const feedback = await this.services?.feedback;
			const result = await feedback?.send({ type: this.type, message: this.message.trim() });
			handled = result?.sent === true || result?.issueOpened === true;
		} catch {
			handled = false;
		} finally {
			this.pending = false;
		}

		if (handled) {
			this.type = 'general';
			this.message = '';
			this.close();
		} else {
			this.error = true;
			void this.updateComplete.then(() => this.textareaEl?.focus());
		}
	};

	override render(): unknown {
		const current = feedbackTypes.find(t => t.type === this.type) ?? feedbackTypes[0];

		return html`<gl-dialog
			class="feedback-dialog"
			modal
			closedby="closerequest"
			label="Send Feedback"
			?open=${this.open}
			@gl-dialog-close=${this.close}
		>
			<header class="titlebar">
				<h2><code-icon icon="feedback"></code-icon> Send Feedback</h2>
				<button class="close" type="button" aria-label="Close" @click=${this.close}>
					<code-icon icon="close"></code-icon>
				</button>
			</header>
			<div class="body scrollable">
				<p class="subtitle">
					Help us improve GitLens. Share what's working, what isn't, or what you'd like to see next.
				</p>
				<div class="segmented" role="radiogroup" aria-label="Feedback type">
					${feedbackTypes.map(
						t => html`<button
							type="button"
							role="radio"
							aria-checked=${this.type === t.type}
							tabindex=${this.type === t.type ? 0 : -1}
							data-type=${t.type}
							aria-label=${t.label}
							?disabled=${this.pending}
							@click=${this.handleTypeClick}
							@keydown=${this.handleTypeKeydown}
						>
							<code-icon icon=${t.icon}></code-icon><span class="label">${t.label}</span>
						</button>`,
					)}
				</div>
				<div class="field">
					<label for="gl-feedback-message">Message</label>
					<textarea
						id="gl-feedback-message"
						class="textarea"
						maxlength="4000"
						placeholder=${current.placeholder}
						?disabled=${this.pending}
						.value=${this.message}
						@input=${this.handleMessageInput}
					></textarea>
				</div>
				${when(current.hint != null, () => html`<p class="hint">${current.hint}</p>`)}
				<nav class="links" aria-label="More ways to get help">
					<a class="link" href=${urls.helpCenter}>Help Center<code-icon icon="link-external"></code-icon></a>
					<a class="link" href=${urls.githubDiscussions}
						>Discussions<code-icon icon="link-external"></code-icon
					></a>
					<a class="link" href=${urls.githubIssues}>Issues<code-icon icon="link-external"></code-icon></a>
				</nav>
				${when(this.error, () => html`<p class="error" role="alert">Couldn't send feedback. Please try again.</p>`)}
			</div>
			<footer class="footer">
				<gl-button appearance="secondary" ?disabled=${this.pending} @click=${this.close}>Cancel</gl-button>
				<gl-button ?disabled=${!this.canSend} @click=${this.send}
					>${this.pending ? 'Sending…' : 'Send Feedback'}</gl-button
				>
			</footer>
		</gl-dialog>`;
	}
}

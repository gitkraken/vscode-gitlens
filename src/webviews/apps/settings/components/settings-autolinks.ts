import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../commands/cloudIntegrations.js';
import type { AutolinkConfig } from '../../../../config.js';
import { IssuesCloudHostIntegrationId } from '../../../../constants.integrations.js';
import { createCommandLink } from '../../../../system/commands.js';
import { focusOutline } from '../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase, linkBase } from '../../shared/components/styles/lit/base.css.js';
import type { SettingsActions } from '../actions.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/button.js';
import '../../shared/components/checkbox/checkbox.js';
import '../../shared/components/code-icon.js';

export const tagName = 'gl-settings-autolinks';

/**
 * The custom autolink rules editor plus the cloud-integration banner.
 *
 * Rules edit the `gitlens.autolinks` array — every committed edit rewrites the
 * whole array; deleting the last rule removes the key (legacy semantics).
 * A draft row only becomes a rule once one of its inputs commits a value.
 */
@customElement(tagName)
export class GlSettingsAutolinks extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		linkBase,
		css`
			:host {
				display: flex;
				flex-direction: column;
				gap: 1.2rem;
			}

			.banner {
				display: flex;
				gap: 0.8rem;
				align-items: flex-start;
				padding: 1rem 1.2rem;
				font-size: 1.2rem;
				line-height: 1.5;
				color: var(--color-foreground--85);
				background-color: color-mix(in srgb, var(--vscode-inputValidation-infoBackground) 60%, transparent);
				border: 1px solid color-mix(in srgb, var(--vscode-inputValidation-infoBorder) 70%, transparent);
				border-radius: 0.6rem;
			}

			.banner code-icon {
				flex: none;
				margin-block-start: 0.2rem;
			}

			.banner--connected {
				background-color: transparent;
				border-color: var(--vscode-widget-border, var(--color-foreground--25));
			}

			.rules {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
			}

			.rule {
				display: flex;
				flex-wrap: wrap;
				gap: 0.8rem;
				align-items: center;
			}

			input[type='text'] {
				padding: 0.6rem 0.8rem;
				font-family: var(--vscode-editor-font-family);
				font-size: 1.2rem;
				color: var(--vscode-input-foreground);
				background-color: var(--vscode-input-background);
				border: 1px solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-input-border-radius, 0.4rem);
			}

			input[type='text']:focus {
				${focusOutline}
			}

			.rule__prefix {
				flex: none;
				width: 10rem;
			}

			.rule__url {
				flex: 1;
				min-width: 24rem;
			}

			.rule__options {
				display: flex;
				gap: 1.2rem;
				align-items: center;
			}

			.rule__delete {
				flex: none;
				padding: 0.4rem;
				color: var(--color-foreground--50);
				cursor: pointer;
				background: transparent;
				border: none;
				border-radius: 0.3rem;
			}

			.rule__delete:hover {
				color: var(--color-foreground);
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			.rule__delete:focus-visible {
				${focusOutline}
			}

			.rule__prefix--invalid,
			.rule__url--invalid {
				border-color: var(--vscode-inputValidation-errorBorder);
			}

			.rule__error {
				flex-basis: 100%;
				font-size: 1.1rem;
				line-height: 1.5;
				color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
			}

			.rule__error code {
				font-family: var(--vscode-editor-font-family);
				font-size: 1.05rem;
			}

			.hint {
				font-size: 1.15rem;
				line-height: 1.5;
				color: var(--color-foreground--65);
			}

			.hint code {
				font-family: var(--vscode-editor-font-family);
				font-size: 1.05rem;
			}

			gl-button {
				align-self: flex-start;
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@property({ attribute: false })
	actions?: SettingsActions;

	@query('gl-button')
	private _addButton?: HTMLElement;

	/**
	 * A not-yet-confirmed rule shown after "Add autolink". It overlays its row
	 * until the config echo contains it, so the row (and any values typed since
	 * the last commit) never vanishes while a write is in flight — and a failed
	 * write keeps the typed rule on screen.
	 */
	@state()
	private _draft?: AutolinkConfig;

	/** Config index the draft was first written to; `undefined` until a commit persists it */
	private _draftIndex?: number;

	private get autolinks(): AutolinkConfig[] {
		return this._state.getSettingValue<AutolinkConfig[]>('autolinks') ?? [];
	}

	override willUpdate(): void {
		// Once the config echo matches the draft as last committed, the row can
		// render from config alone
		if (this._draft != null && this._draftIndex != null) {
			const persisted = this.autolinks[this._draftIndex];
			if (persisted != null && autolinksEqual(persisted, this._draft)) {
				this._draft = undefined;
				this._draftIndex = undefined;
			}
		}
	}

	private addDraftRule = (): void => {
		// Never discard an unconfirmed draft (it may be awaiting its config echo,
		// or its write failed) — just put focus back in its row
		if (this._draft == null) {
			this._draft = { prefix: '', url: '', alphanumeric: false, ignoreCase: false, title: null };
			this._draftIndex = undefined;
		}
		// Start the user in the draft row, not back at the button
		void this.updateComplete.then(() => {
			const index = Math.min(this.draftRowIndex ?? 0, this.autolinks.length);
			this.renderRoot.querySelector<HTMLInputElement>(`.rule[data-index="${index}"] .rule__prefix`)?.focus();
		});
	};

	private get draftRowIndex(): number | undefined {
		if (this._draft == null) return undefined;
		return this._draftIndex ?? this.autolinks.length;
	}

	private commitRule(index: number, prop: keyof AutolinkConfig, value: string | boolean): void {
		if (index === this.draftRowIndex) {
			const draft = { ...this._draft!, [prop]: value };
			this._draft = draft;
			// Only persist once the draft has real content — toggling an option on
			// an otherwise-empty row shouldn't create an empty rule
			if (!draft.prefix && !draft.url) return;

			this._draftIndex ??= this.autolinks.length;
			void this.actions?.applyAutolinkRule(this._draftIndex, draft);
			return;
		}

		void this.actions?.applyAutolinkChange(index, prop, value);
	}

	private removeRule(index: number): void {
		if (index === this.draftRowIndex) {
			const written = this._draftIndex;
			this._draft = undefined;
			this._draftIndex = undefined;
			if (written != null) {
				void this.actions?.removeAutolink(written);
			}
		} else {
			void this.actions?.removeAutolink(index);
		}

		// The focused delete button is destroyed with the row — land on the rule
		// above it (whose index is unaffected by the removal) instead of dropping
		// focus to <body> or jumping all the way down to the Add button; fall back
		// to Add when nothing precedes it.
		void this.updateComplete.then(() => {
			const prev =
				index > 0
					? this.renderRoot.querySelector<HTMLElement>(`.rule[data-index="${index - 1}"] .rule__delete`)
					: null;
			(prev ?? this._addButton)?.focus();
		});
	}

	private renderIntegrationsBanner() {
		// Wait for both services before rendering (like the integrations panel) —
		// the signed-out copy would flash misleadingly for signed-in users
		if (this._state.subscription.get() === undefined || this._state.cloudIntegrations.get() === undefined) {
			return nothing;
		}

		const hasAccount = this._state.hasAccount.get();
		const hasConnectedJira = this._state.hasConnectedJira.get();
		const hasConnectedLinear = this._state.hasConnectedLinear.get();

		if (hasConnectedJira && hasConnectedLinear) {
			return html`<p class="banner banner--connected">
				<code-icon icon="check" aria-hidden="true"></code-icon>
				<span>Jira and Linear are connected — issue keys in commit messages link automatically.</span>
			</p>`;
		}

		const connectLink = (integration: IssuesCloudHostIntegrationId, label: string) =>
			html`<a
				href=${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
					'gitlens.plus.cloudIntegrations.connect',
					{
						integrationIds: [integration],
						source: { source: 'settings', detail: { action: 'connect', integration: integration } },
					},
				)}
				>${label}</a
			>`;

		return html`<p class="banner">
			<code-icon icon="info" aria-hidden="true"></code-icon>
			<span>
				${hasAccount ? 'Connect' : 'Sign up and connect'}
				${hasConnectedJira ? nothing : connectLink(IssuesCloudHostIntegrationId.Jira, 'Jira')}
				${!hasConnectedJira && !hasConnectedLinear ? ' or ' : nothing}
				${hasConnectedLinear ? nothing : connectLink(IssuesCloudHostIntegrationId.Linear, 'Linear')} to
				automatically link issues in commit messages.
			</span>
		</p>`;
	}

	private renderRule(autolink: AutolinkConfig, index: number) {
		// Validate against the row as currently rendered (the draft overlay is
		// already applied by `render()`), so errors track the latest value
		const invalid = validateRule(autolink);
		const prefixErrorId = `autolink-${index}-prefix-error`;
		const urlErrorId = `autolink-${index}-url-error`;
		// Name the row by its prefix (falling back to "New") rather than its
		// position, so deleting an earlier rule doesn't silently rename the rest
		const name = autolink.prefix?.trim() || 'New';

		return html`<div class="rule" data-index=${index}>
			<input
				class="rule__prefix ${invalid.prefix ? 'rule__prefix--invalid' : ''}"
				type="text"
				placeholder="TICKET-"
				spellcheck="false"
				aria-label="${name} autolink prefix"
				aria-invalid=${invalid.prefix ? 'true' : 'false'}
				aria-describedby=${invalid.prefix ? prefixErrorId : nothing}
				.value=${autolink.prefix ?? ''}
				@blur=${(e: FocusEvent) => this.commitRule(index, 'prefix', (e.target as HTMLInputElement).value)}
			/>
			<input
				class="rule__url ${invalid.url ? 'rule__url--invalid' : ''}"
				type="text"
				placeholder="https://example.com/TICKET?q=&lt;num&gt;"
				spellcheck="false"
				aria-label="${name} autolink URL"
				aria-invalid=${invalid.url ? 'true' : 'false'}
				aria-describedby=${invalid.url ? urlErrorId : nothing}
				.value=${autolink.url ?? ''}
				@blur=${(e: FocusEvent) => this.commitRule(index, 'url', (e.target as HTMLInputElement).value)}
			/>
			<span class="rule__options">
				<gl-checkbox
					.checked=${!(autolink.ignoreCase ?? false)}
					@gl-change-value=${(e: Event) =>
						this.commitRule(
							index,
							'ignoreCase',
							// The config semantics are inverted from the label: `ignoreCase: false`
							// IS case-sensitive. The legacy view bound these directly — a
							// long-standing bug hidden behind an icon-only toggle — so bind
							// inverted to make the labeled checkbox tell the truth.
							!(e.target as HTMLElement & { checked: boolean }).checked,
						)}
					>Case-sensitive</gl-checkbox
				>
				<gl-checkbox
					.checked=${autolink.alphanumeric ?? false}
					@gl-change-value=${(e: Event) =>
						this.commitRule(
							index,
							'alphanumeric',
							(e.target as HTMLElement & { checked: boolean }).checked,
						)}
					>Alphanumeric</gl-checkbox
				>
			</span>
			<button
				type="button"
				class="rule__delete"
				aria-label="Delete ${name} autolink"
				title="Delete autolink"
				@click=${() => this.removeRule(index)}
			>
				<code-icon icon="close" aria-hidden="true"></code-icon>
			</button>
			${invalid.prefix
				? html`<span id=${prefixErrorId} class="rule__error">Add a prefix to match, e.g. TICKET-</span>`
				: nothing}
			${invalid.url
				? html`<span id=${urlErrorId} class="rule__error"
						>Add <code>&lt;num&gt;</code> to the URL so the reference value is linked.</span
					>`
				: nothing}
		</div>`;
	}

	override render(): unknown {
		// The draft overlays the row it was written to (or appends when not yet
		// written) so an in-flight or failed write can't blank the user's input
		const rows = [...this.autolinks];
		const draftIndex = this.draftRowIndex;
		if (this._draft != null && draftIndex != null) {
			rows[Math.min(draftIndex, rows.length)] = this._draft;
		}

		return html`${this.renderIntegrationsBanner()}
			<div class="rules">${rows.map((a, i) => this.renderRule(a, i))}</div>
			<p class="hint">
				Matches prefixes that are followed by a reference value within commit messages. The URL must contain a
				<code>&lt;num&gt;</code> for the reference value to be included in the link.
			</p>
			<gl-button appearance="secondary" @click=${this.addDraftRule}>
				<code-icon icon="add" slot="prefix" aria-hidden="true"></code-icon> Add autolink
			</gl-button>`;
	}
}

function autolinksEqual(a: AutolinkConfig, b: AutolinkConfig): boolean {
	return (
		a.prefix === b.prefix &&
		a.url === b.url &&
		(a.alphanumeric ?? false) === (b.alphanumeric ?? false) &&
		(a.ignoreCase ?? false) === (b.ignoreCase ?? false)
	);
}

/**
 * Flags fields that would make a rule silently non-functional once saved. Only
 * "real" rules (those the user has started building) are flagged — an entirely
 * empty draft row is never invalid.
 */
function validateRule(autolink: AutolinkConfig): { prefix: boolean; url: boolean } {
	const prefix = autolink.prefix ?? '';
	const url = autolink.url ?? '';

	const isRealRule = prefix.length > 0 || url.length > 0;
	return {
		// A URL with no `<num>` token can never link the reference value
		url: isRealRule && !url.includes('<num>'),
		// A rule with a URL but no prefix has nothing to match against
		prefix: url.length > 0 && prefix.length === 0,
	};
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: GlSettingsAutolinks;
	}
}

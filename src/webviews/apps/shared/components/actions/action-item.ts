import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { getAltKeySymbol } from '@env/platform';
import { focusOutline } from '../styles/lit/a11y.css';
import '../overlays/tooltip';
import '../code-icon';

@customElement('action-item')
export class ActionItem extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = css`
		:host {
			box-sizing: border-box;
			display: inline-flex;
			justify-content: center;
			align-items: center;
			width: 2rem;
			height: 2rem;
			border-radius: 0.5rem;
			color: var(--action-item-foreground, var(--vscode-icon-foreground));
			padding: 0.2rem;
			vertical-align: text-bottom;
			text-decoration: none;
			cursor: pointer;
		}

		:host(:focus-within) {
			${focusOutline}
		}

		:host(:hover),
		:host(:focus-within) {
			background-color: var(--vscode-toolbar-hoverBackground);
		}

		:host(:active) {
			background-color: var(--vscode-toolbar-activeBackground);
		}

		:host([disabled]) {
			pointer-events: none;
			opacity: 0.5;
		}

		a {
			color: inherit;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
			text-decoration: none;
		}
		a:focus {
			outline: none;
		}
		a:is(:hover, :focus, :active) {
			text-decoration: none;
		}
	`;

	@property()
	href?: string;

	@property({ attribute: 'alt-href' })
	altHref?: string;

	@property()
	label?: string;

	@property({ attribute: 'alt-label' })
	altLabel?: string;

	@property()
	icon = '';

	@property({ attribute: 'alt-icon' })
	altIcon?: string;

	@property({ type: Boolean })
	disabled = false;

	@query('a')
	private defaultFocusEl!: HTMLAnchorElement;

	@state()
	private isAltKeyPressed = false;

	get effectiveIcon(): string {
		if (this.isAltKeyPressed && this.altIcon) {
			return this.altIcon;
		}
		return this.icon;
	}

	get effectiveTooltip(): string | undefined {
		if (!this.label && !this.altLabel) {
			return undefined;
		}
		if (this.altLabel) {
			if (this.isAltKeyPressed) {
				return this.altLabel;
			}
			return `${this.label}\n[${getAltKeySymbol()}] ${this.altLabel}`;
		}
		return this.label;
	}

	get effectiveLabel(): string | undefined {
		if (!this.label && !this.altLabel) {
			return undefined;
		}
		if (this.altLabel && this.isAltKeyPressed) {
			return this.altLabel;
		}
		return this.label;
	}

	get effectiveHref(): string | undefined {
		if (this.isAltKeyPressed && this.altHref) {
			return this.altHref;
		}
		return this.href;
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		window.addEventListener('keydown', this);
		window.addEventListener('keyup', this);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		window.removeEventListener('keydown', this);
		window.removeEventListener('keyup', this);
	}

	handleEvent(e: KeyboardEvent) {
		const isAltKey = e.key === 'Alt' || e.altKey;
		if (e.type === 'keydown') {
			this.isAltKeyPressed = isAltKey;
		} else if (e.type === 'keyup' && isAltKey) {
			this.isAltKeyPressed = false;
		}
	}

	override render(): unknown {
		return html`
			<gl-tooltip hoist content="${this.effectiveTooltip ?? nothing}">
				<a
					role="${!this.effectiveHref ? 'button' : nothing}"
					type="${!this.effectiveHref ? 'button' : nothing}"
					aria-label="${this.effectiveLabel ?? nothing}"
					?disabled=${this.disabled}
					href=${this.effectiveHref ?? nothing}
					tabindex="0"
					@keydown=${this.handleLinkKeydown}
				>
					<code-icon part="icon" icon="${this.effectiveIcon}"></code-icon>
				</a>
			</gl-tooltip>
		`;
	}

	private handleLinkKeydown = (e: KeyboardEvent) => {
		// Handle Space and Enter for button-role links without href
		if (!this.effectiveHref && (e.key === ' ' || e.key === 'Enter')) {
			e.preventDefault();
			// Trigger a click event
			(e.target as HTMLElement).click();
		}
	};

	override focus(options?: FocusOptions): void {
		this.defaultFocusEl.focus(options);
	}
}

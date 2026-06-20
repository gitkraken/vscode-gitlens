import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DraftVisibility } from '../../../../plus/drafts/models/drafts.js';
import type { Preferences, State } from '../../../commitDetails/protocol.js';
import type { Change, DraftUserSelection } from '../../../plus/patchDetails/protocol.js';
import { GlElement } from '../../shared/components/element.js';
import { buttonStyles } from './button.css.js';
import '../../plus/patchDetails/components/gl-patch-create.js';

export interface CreatePatchState {
	title?: string;
	description?: string;
	changes: Record<string, Change>;
	creationError?: string;
	visibility: DraftVisibility;
	userSelections?: DraftUserSelection[];
}

export interface CreatePatchEventDetail {
	title: string;
	description?: string;
	visibility: DraftVisibility;
	changesets: Record<string, Change>;
	userSelections: DraftUserSelection[] | undefined;
}

export interface GenerateState {
	cancelled?: boolean;
	error?: { message: string };
	title?: string;
	description?: string;
}

@customElement('gl-inspect-patch')
export class InspectPatch extends GlElement {
	static override styles = [
		buttonStyles,
		css`
			:host {
				flex: 1;
			}

			*,
			*::before,
			*::after {
				box-sizing: border-box;
			}

			a {
				color: var(--vscode-textLink-foreground);
				text-decoration: none;
			}

			a:hover {
				text-decoration: underline;
			}

			gl-patch-create {
				display: block;
				height: 100%;
			}

			.pane-groups {
				display: flex;
				flex-direction: column;
				height: 100%;
			}

			.pane-groups__group {
				display: flex;
				flex: 1 1 auto;
				flex-direction: column;
				min-height: 0;
				overflow: hidden;
			}

			.pane-groups__group webview-pane {
				flex: none;
			}

			.pane-groups__group webview-pane[expanded] {
				flex: 1;
				min-height: 0;
			}

			.pane-groups__group-fixed {
				flex: none;
			}

			.pane-groups__group-fixed webview-pane::part(content) {
				overflow: visible;
			}

			.section {
				padding: 0 var(--gitlens-scrollbar-gutter-width) 1.5rem var(--gitlens-gutter-width);
			}

			.section > :first-child {
				margin-top: 0;
			}

			.section > :last-child {
				margin-bottom: 0;
			}

			.section--action {
				padding-top: 1.5rem;
				padding-bottom: 1.5rem;
				border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
			}

			.section--action > :first-child {
				padding-top: 0;
			}

			/* TODO: these form styles should be moved to a common location */
			.message-input {
				padding-top: var(--gl-space-8);
			}

			.message-input__control {
				flex: 1;
				width: 100%;
				padding: 0.5rem;
				font-family: inherit;
				font-size: 1.3rem;
				line-height: 1.4;
				color: var(--vscode-input-foreground);
				background: var(--vscode-input-background);
				border: 1px solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-radius-xs);
			}

			.message-input__control::placeholder {
				color: var(--vscode-input-placeholderForeground);
			}

			.message-input__control:invalid {
				background-color: var(--vscode-inputValidation-errorBackground);
				border-color: var(--vscode-inputValidation-errorBorder);
			}

			.message-input__control:focus {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.message-input__control:disabled {
				pointer-events: none;
				cursor: not-allowed;
				opacity: 0.4;
			}

			.message-input__control--text {
				overflow: hidden;
				white-space: nowrap;
				opacity: 0.7;
			}

			.message-input__action {
				flex: none;
			}

			.message-input__select {
				position: relative;
				display: flex;
				flex: 1;
				align-items: stretch;
			}

			.message-input__select-icon {
				position: absolute;
				top: 0;
				left: 0;
				display: flex;
				align-items: center;
				justify-content: center;
				width: 2.4rem;
				height: 100%;
				color: var(--vscode-foreground);
				pointer-events: none;
			}

			.message-input__select-caret {
				position: absolute;
				top: 0;
				right: 0;
				display: flex;
				align-items: center;
				justify-content: center;
				width: 2.4rem;
				height: 100%;
				color: var(--vscode-foreground);
				pointer-events: none;
			}

			.message-input__select .message-input__control {
				box-sizing: border-box;
				padding-right: var(--gl-space-24);
				padding-left: var(--gl-space-24);
				appearance: none;
			}

			.message-input__menu {
				position: absolute;
				top: 0.8rem;
				right: 0;
			}

			.section--action > :first-child .message-input__menu {
				top: 0;
			}

			.message-input--group {
				display: flex;
				flex-direction: row;
				gap: var(--gl-space-6);
				align-items: stretch;
			}

			.message-input--with-menu {
				position: relative;
			}

			textarea.message-input__control {
				min-height: 4rem;
				max-height: 40rem;
				resize: vertical;
			}

			.user-selection-container {
				max-height: (2.4rem * 4);
				overflow: auto;
			}

			.user-selection {
				--gl-avatar-size: 2rem;

				display: flex;
				flex-direction: row;
				gap: var(--gl-space-4);
				align-items: center;
				height: 2.4rem;
			}

			.user-selection__avatar {
				flex: none;
			}

			.user-selection__info {
				flex: 1;
				min-width: 0;
				white-space: nowrap;
			}

			.user-selection__name {
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.user-selection__actions {
				flex: none;
				color: var(--gl-patch-ghost-color);
			}

			.user-selection__actions gl-button::part(base) {
				padding-block: var(--gl-space-4);
				padding-right: 0;
			}

			.user-selection__actions gl-button code-icon {
				pointer-events: none;
			}

			.user-selection__check:not(.is-active) {
				opacity: 0;
			}

			.alert {
				display: flex;
				flex-direction: row;
				align-items: center;
				padding: var(--gl-space-8) var(--gl-space-12);
				line-height: 1.2;
				color: var(--color-alert-foreground);
				background-color: var(--color-alert-errorBackground);
				border-left: 0.3rem solid var(--color-alert-errorBorder);
			}

			.alert code-icon {
				margin-right: var(--gl-space-4);
				vertical-align: baseline;
			}

			.alert__content {
				margin: 0;
				font-size: 1.2rem;
				line-height: 1.2;
				text-align: left;
			}
		`,
	];

	@property({ type: Object })
	orgSettings?: State['orgSettings'];

	@property({ type: Object })
	preferences?: Preferences;

	@property({ type: Object })
	generate?: GenerateState;

	@property({ type: Object })
	createState?: CreatePatchState;

	get patchCreateState() {
		return {
			preferences: this.preferences,
			orgSettings: this.orgSettings,
			create: this.createState,
		};
	}

	override render(): unknown {
		return html`<gl-patch-create
			.state=${this.patchCreateState}
			.generate=${this.generate}
			review
			@gl-patch-file-compare-working=${(e: CustomEvent) => {
				console.log('gl-patch-file-compare-working', e);
			}}
			@gl-patch-create-update-metadata=${(e: CustomEvent) => {
				console.log('gl-patch-create-update-metadata', e);
			}}
		></gl-patch-create>`;
	}
}

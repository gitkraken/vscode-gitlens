import { Badge, defineGkElement, Menu, MenuItem, Popover } from '@gitkraken/shared-web-components';
import { html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { DraftDetails, Mode, State } from '../../../../../plus/webviews/patchDetails/protocol';
import { GlElement } from '../../../shared/components/element';
import type { PatchDetailsApp } from '../patchDetails';
import './gl-draft-details';
import './gl-patch-create';

interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	summary?: string;
}

export interface ApplyPatchDetail {
	draft: DraftDetails;
	target?: 'current' | 'branch' | 'worktree';
	base?: string;
	// [key: string]: unknown;
}

export interface ChangePatchBaseDetail {
	draft: DraftDetails;
	// [key: string]: unknown;
}

export interface SelectPatchRepoDetail {
	draft: DraftDetails;
	repoPath?: string;
	// [key: string]: unknown;
}

export interface ShowPatchInGraphDetail {
	draft: DraftDetails;
	// [key: string]: unknown;
}

export type GlPatchDetailsAppEvents = {
	[K in Extract<keyof WindowEventMap, `gl-patch-details-${string}`>]: WindowEventMap[K];
};

@customElement('gl-patch-details-app')
export class GlPatchDetailsApp extends GlElement<GlPatchDetailsAppEvents> {
	@property({ type: Object })
	state!: State;

	@property({ type: Object })
	explain?: ExplainState;

	@property({ attribute: false, type: Object })
	app?: PatchDetailsApp;

	constructor() {
		super();

		defineGkElement(Badge, Popover, Menu, MenuItem);
	}

	get wipChangesCount() {
		if (this.state?.create == null) return 0;

		return Object.values(this.state.create.changes).reduce((a, c) => {
			a += c.files?.length ?? 0;
			return a;
		}, 0);
	}

	get wipChangeState() {
		if (this.state?.create == null) return undefined;

		const state = Object.values(this.state.create.changes).reduce(
			(a, c) => {
				if (c.files != null) {
					a.files += c.files.length;
					a.on.add(c.repository.uri);
				}
				return a;
			},
			{ files: 0, on: new Set<string>() },
		);

		// return file length total and repo/branch names
		return {
			count: state.files,
			branches: Array.from(state.on).join(', '),
		};
	}

	get mode(): Mode {
		return this.state?.mode ?? 'view';
	}

	private indentPreference = 16;
	private updateDocumentProperties() {
		const preference = this.state?.preferences?.indent;
		if (preference === this.indentPreference) return;
		this.indentPreference = preference ?? 16;

		const rootStyle = document.documentElement.style;
		rootStyle.setProperty('--gitlens-tree-indent', `${this.indentPreference}px`);
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		if (changedProperties.has('state')) {
			this.updateDocumentProperties();
		}
	}

	private renderTabs() {
		return nothing;
		// return html`
		// 	<nav class="details-tab">
		// 		<button
		// 			class="details-tab__item ${this.mode === 'view' ? ' is-active' : ''}"
		// 			data-action="mode"
		// 			data-action-value="view"
		// 		>
		// 			Patch
		// 		</button>
		// 		<button
		// 			class="details-tab__item ${this.mode === 'create' ? ' is-active' : ''}"
		// 			data-action="mode"
		// 			data-action-value="create"
		// 			title="${this.wipChangeState != null
		// 				? `${pluralize('file change', this.wipChangeState.count, {
		// 						plural: 'file changes',
		// 				  })} on ${this.wipChangeState.branches}`
		// 				: nothing}"
		// 		>
		// 			Create${this.wipChangeState
		// 				? html` &nbsp;<gk-badge variant="filled">${this.wipChangeState.count}</gk-badge>`
		// 				: ''}
		// 		</button>
		// 	</nav>
		// `;
	}

	override render() {
		return html`
			<div class="commit-detail-panel scrollable">
				${this.renderTabs()}
				<main id="main" tabindex="-1">
					${when(
						this.mode === 'view',
						() => html`<gl-draft-details .state=${this.state} .explain=${this.explain}></gl-draft-details>`,
						() => html`<gl-patch-create .state=${this.state}></gl-patch-create>`,
					)}
				</main>
			</div>
		`;
	}

	// onShowInGraph(e: CustomEvent<ShowPatchInGraphDetail>) {
	// 	this.fireEvent('gl-patch-details-graph-show-patch', e.detail);
	// }

	// private onShareLocalPatch(_e: CustomEvent<undefined>) {
	// 	this.fireEvent('gl-patch-details-share-local-patch');
	// }

	// private onCopyCloudLink(_e: CustomEvent<undefined>) {
	// 	this.fireEvent('gl-patch-details-copy-cloud-link');
	// }

	protected override createRenderRoot() {
		return this;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-patch-details-app': GlPatchDetailsApp;
	}

	// interface WindowEventMap {
	// 	'gl-patch-details-graph-show-patch': CustomEvent<ShowPatchInGraphDetail>;
	// 	'gl-patch-details-share-local-patch': CustomEvent<undefined>;
	// 	'gl-patch-details-copy-cloud-link': CustomEvent<undefined>;
	// }
}

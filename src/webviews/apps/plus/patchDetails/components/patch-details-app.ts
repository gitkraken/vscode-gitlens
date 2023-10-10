import { Badge, defineGkElement, Menu, MenuItem, Popover } from '@gitkraken/shared-web-components';
import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { DraftDetails, State } from '../../../../../plus/webviews/patchDetails/protocol';
import { pluralize } from '../../../../../system/string';
import type { PatchDetailsApp } from '../patchDetails';
import type { CreatePatchEventDetail } from './gl-patch-create';
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

@customElement('gl-patch-details-app')
export class GlPatchDetailsApp extends LitElement {
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
		if (this.state?.create == null) {
			return 0;
		}

		return this.state.create.reduce((a, c) => a + c.files.length, 0);
	}

	get wipChangeState() {
		if (this.state?.create == null) {
			return undefined;
		}

		const state = this.state.create.reduce(
			(a, c) => {
				a.files += c.files.length;
				a.on.add(`${c.repository.name}:${c.range.branchName}`);
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

	get mode() {
		return this.state?.mode ?? 'draft';
	}

	override render() {
		return html`
			<div class="commit-detail-panel scrollable">
				<nav class="details-tab">
					<button
						class="details-tab__item ${this.mode === 'draft' ? ' is-active' : ''}"
						data-action="mode"
						data-action-value="draft"
					>
						Patch
					</button>
					<button
						class="details-tab__item ${this.mode === 'create' ? ' is-active' : ''}"
						data-action="mode"
						data-action-value="create"
						title="${this.wipChangeState != null
							? `${pluralize('file change', this.wipChangeState.count, {
									plural: 'file changes',
							  })} on ${this.wipChangeState.branches}`
							: nothing}"
					>
						Create${this.wipChangeState
							? html` &nbsp;<gk-badge variant="filled">${this.wipChangeState.count}</gk-badge>`
							: ''}
					</button>
				</nav>
				<main id="main" tabindex="-1">
					${when(
						this.mode === 'draft',
						() =>
							html`<gl-draft-details
								.state=${this.state}
								.explain=${this.explain}
								@share-local-patch=${this.onShareLocalPatch}
								@copy-cloud-link=${this.onCopyCloudLink}
							></gl-draft-details>`,
						() =>
							html`<gl-patch-create
								.state=${this.state}
								@create-patch=${this.onPatchCreate}
							></gl-patch-create>`,
					)}
				</main>
			</div>
		`;
	}

	onShowInGraph(e: CustomEvent<ShowPatchInGraphDetail>) {
		this.dispatchEvent(new CustomEvent<ShowPatchInGraphDetail>('graph-show-patch', { detail: e.detail }));
	}

	private onPatchCreate(e: CustomEvent<CreatePatchEventDetail>) {
		this.dispatchEvent(new CustomEvent<CreatePatchEventDetail>('create-patch', { detail: e.detail }));
	}

	private onShareLocalPatch(_e: CustomEvent<undefined>) {
		this.dispatchEvent(new CustomEvent<undefined>('share-local-patch'));
	}

	private onCopyCloudLink(_e: CustomEvent<undefined>) {
		this.dispatchEvent(new CustomEvent<undefined>('copy-cloud-link'));
	}

	protected override createRenderRoot() {
		return this;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-patch-details-app': GlPatchDetailsApp;
	}
}

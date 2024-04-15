import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { DraftState, State, Wip } from '../../../commitDetails/protocol';
import type { TreeItemAction, TreeItemBase } from '../../shared/components/tree/base';
import type { File } from './gl-details-base';
import { GlDetailsBase } from './gl-details-base';
import '../../shared/components/button';
import '../../shared/components/code-icon';
import '../../shared/components/panes/pane-group';
import '../../shared/components/pills/tracking';
import './gl-inspect-patch';

@customElement('gl-wip-details')
export class GlWipDetails extends GlDetailsBase {
	override readonly tab = 'wip';

	@property({ type: Object })
	wip?: Wip;

	@property({ type: Object })
	orgSettings?: State['orgSettings'];

	@property({ type: Object })
	draftState?: DraftState;

	@state()
	get inReview() {
		return this.draftState?.inReview ?? false;
	}

	get isUnpublished() {
		const branch = this.wip?.branch;
		return branch?.upstream == null || branch.upstream.missing === true;
	}

	get draftsEnabled() {
		return this.orgSettings?.drafts === true;
	}

	get filesCount() {
		return this.files?.length ?? 0;
	}

	get branchState() {
		const branch = this.wip?.branch;
		if (branch == null) return undefined;

		return {
			ahead: branch.tracking?.ahead ?? 0,
			behind: branch.tracking?.behind ?? 0,
		};
	}

	get patchCreateState() {
		const wip = this.wip!;
		const key = wip.repo.uri;
		const change = {
			type: 'wip',
			repository: {
				name: wip.repo.name,
				path: wip.repo.path,
				uri: wip.repo.uri,
			},
			files: wip.changes?.files ?? [],
			checked: true,
		};

		return {
			title: undefined,
			description: undefined,
			changes: {
				[key]: change,
			},
			creationError: undefined,
			visibility: 'public',
			userSelections: undefined,
		};
	}

	override get filesChangedPaneLabel() {
		return 'Working Changes';
	}

	renderPrimaryAction() {
		if (this.draftsEnabled) {
			let label = 'Share as Cloud Patch';
			let action = 'create-patch';
			const pr = this.wip?.pullRequest;
			if (pr != null) {
				// const isMe = pr.author.name.endsWith('(you)');
				// if (isMe) {
				// 	label = 'Share with PR Participants';
				// 	action = 'create-patch';
				// } else {
				// 	label = `Start Review for PR #${pr.id}`;
				// 	action = 'create-patch';
				// }

				if (!this.inReview) {
					label = `Start Review for PR #${pr.id}`;
					action = 'start-patch-review';
				} else {
					label = `End Review for PR #${pr.id}`;
					action = 'end-patch-review';
				}

				return html`<p class="button-container">
					<span class="button-group button-group--single">
						<gl-button full data-action="${action}" @click=${() => this.onToggleReviewMode(!this.inReview)}>
							<code-icon icon="gl-cloud-patch-share"></code-icon> ${label}
						</gl-button>
						<gl-button
							density="compact"
							data-action="create-patch"
							title="Share as Cloud Patch"
							@click=${() => this.onDataActionClick('create-patch')}
						>
							<code-icon icon="gl-cloud-patch-share"></code-icon>
						</gl-button>
					</span>
				</p>`;
			}

			return html`<p class="button-container">
				<span class="button-group button-group--single">
					<gl-button full data-action="${action}" @click=${() => this.onDataActionClick(action)}>
						<code-icon icon="gl-cloud-patch-share"></code-icon> ${label}
					</gl-button>
				</span>
			</p>`;
		}

		if (this.isUnpublished) {
			return html`<p class="button-container">
				<span class="button-group button-group--single">
					<gl-button
						full
						data-action="publish-branch"
						@click=${() => this.onDataActionClick('publish-branch')}
					>
						<code-icon icon="cloud-upload"></code-icon> Publish Branch
					</gl-button>
				</span>
			</p>`;
		}

		if (this.branchState == null) return undefined;

		const { ahead, behind } = this.branchState;
		if (ahead === 0 && behind === 0) return undefined;

		const fetchLabel = behind > 0 ? 'Pull' : ahead > 0 ? 'Push' : 'Fetch';
		const fetchIcon = behind > 0 ? 'arrow-down' : ahead > 0 ? 'arrow-up' : 'sync';

		return html`<p class="button-container">
			<span class="button-group button-group--single">
				<gl-button
					full
					data-action="${fetchLabel.toLowerCase()}"
					@click=${() => this.onDataActionClick(fetchLabel.toLowerCase())}
				>
					<code-icon icon="${fetchIcon}"></code-icon> ${fetchLabel}&nbsp;
					<gl-tracking-pill .ahead=${ahead} .behind=${behind}></gl-tracking-pill>
				</gl-button>
			</span>
		</p>`;
	}

	renderSecondaryAction() {
		const canShare = this.draftsEnabled;
		if (this.isUnpublished && canShare) {
			return html`<p class="button-container">
				<span class="button-group button-group--single">
					<gl-button
						full
						appearance="secondary"
						data-action="publish-branch"
						@click=${() => this.onDataActionClick('publish-branch')}
					>
						<code-icon icon="cloud-upload"></code-icon> Publish Branch
					</gl-button>
				</span>
			</p>`;
		}

		if ((!this.isUnpublished && !canShare) || this.branchState == null) return undefined;

		const { ahead, behind } = this.branchState;
		if (ahead === 0 && behind === 0) return undefined;

		const fetchLabel = behind > 0 ? 'Pull' : ahead > 0 ? 'Push' : 'Fetch';
		const fetchIcon = behind > 0 ? 'arrow-down' : ahead > 0 ? 'arrow-up' : 'sync';

		return html`<p class="button-container">
			<span class="button-group button-group--single">
				<gl-button
					full
					appearance="secondary"
					data-action="${fetchLabel.toLowerCase()}"
					@click=${() => this.onDataActionClick(fetchLabel.toLowerCase())}
				>
					<code-icon icon="${fetchIcon}"></code-icon> ${fetchLabel}&nbsp;
					<gl-tracking-pill .ahead=${ahead} .behind=${behind}></gl-tracking-pill>
				</gl-button>
			</span>
		</p>`;
	}

	renderActions() {
		const primaryAction = this.renderPrimaryAction();
		const secondaryAction = this.renderSecondaryAction();
		if (primaryAction == null && secondaryAction == null) return nothing;

		return html`<div class="section section--actions">${primaryAction}${secondaryAction}</div>`;
	}

	renderSuggestedChanges() {
		if (this.inReview === false || this.wip?.pullRequest == null) return nothing;

		return html`
			<webview-pane collapsable>
				<span slot="title">#${this.wip?.pullRequest?.id} Suggested Changes</span>
				<div class="section">
					<issue-pull-request
						type="pr"
						name="${this.wip.pullRequest.title}"
						url="${this.wip.pullRequest.url}"
						key="#${this.wip.pullRequest.id}"
						status="${this.wip.pullRequest.state}"
						.date=${this.wip.pullRequest.updatedDate}
						.dateFormat="${this.preferences?.dateFormat}"
						.dateStyle="${this.preferences?.dateStyle}"
					></issue-pull-request>
				</div>
			</webview-pane>
		`;
	}

	renderIncomingOutgoing() {
		if (this.branchState == null || (this.branchState.ahead === 0 && this.branchState.behind === 0)) return nothing;

		return html`
			<webview-pane collapsable>
				<span slot="title">Incoming / Outgoing</span>
				<gl-tree>
					<gl-tree-item branch .expanded=${false}>
						<code-icon slot="icon" icon="arrow-circle-down"></code-icon>
						Incoming Changes
						<span slot="decorations">${this.branchState.behind ?? 0}</span>
					</gl-tree-item>
					<gl-tree-item branch .expanded=${false}>
						<code-icon slot="icon" icon="arrow-circle-up"></code-icon>
						Outgoing Changes
						<span slot="decorations">${this.branchState.ahead ?? 0}</span>
					</gl-tree-item>
				</gl-tree>
			</webview-pane>
		`;
	}

	renderPatchCreation() {
		if (!this.inReview) return nothing;

		return html`<gl-inspect-patch
			.orgSettings=${this.orgSettings}
			.preferences=${this.preferences}
			.createState=${this.patchCreateState}
			@gl-patch-create-patch=${(e: CustomEvent) => {
				// this.onDataActionClick('create-patch');
				console.log('gl-patch-create-patch', e);
				void this.dispatchEvent(new CustomEvent('gl-inspect-create-suggestions', { detail: e.detail }));
			}}
		></gl-inspect-patch>`;
	}

	override render() {
		if (this.wip == null) return nothing;

		return html`
			${this.renderActions()}
			<webview-pane-group flexible>
				${this.renderSuggestedChanges()}${this.renderIncomingOutgoing()}
				${when(this.inReview === false, () => this.renderChangedFiles('wip'))}${this.renderPatchCreation()}
			</webview-pane-group>
		`;
	}

	override getFileActions(file: File, _options?: Partial<TreeItemBase>): TreeItemAction[] {
		const openFile = {
			icon: 'go-to-file',
			label: 'Open file',
			action: 'file-open',
		};
		if (file.staged === true) {
			return [openFile, { icon: 'remove', label: 'Unstage changes', action: 'file-unstage' }];
		}
		return [openFile, { icon: 'plus', label: 'Stage changes', action: 'file-stage' }];
	}

	onDataActionClick(name: string) {
		void this.dispatchEvent(new CustomEvent('data-action', { detail: { name: name } }));
	}

	onToggleReviewMode(inReview: boolean) {
		this.dispatchEvent(new CustomEvent('draft-state-changed', { detail: { inReview: inReview } }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-wip-details': GlWipDetails;
	}
}

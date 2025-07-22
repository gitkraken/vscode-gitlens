import { Avatar, defineGkElement } from '@gitkraken/shared-web-components';
import type { PropertyValueMap, TemplateResult } from 'lit';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { ComposeCommandArgs } from '../../../../commands/composer';
import type { GenerateCommitsCommandArgs } from '../../../../commands/generateRebase';
import { createCommandLink } from '../../../../system/commands';
import { equalsIgnoreCase } from '../../../../system/string';
import type { DraftState, Wip } from '../../../commitDetails/protocol';
import type { TreeItemAction, TreeItemBase } from '../../shared/components/tree/base';
import type { File } from './gl-details-base';
import { GlDetailsBase } from './gl-details-base';
import type { GenerateState } from './gl-inspect-patch';
import '../../shared/components/button';
import '../../shared/components/button-container';
import '../../shared/components/code-icon';
import '../../shared/components/panes/pane-group';
import '../../shared/components/pills/tracking';
import './gl-inspect-patch';

@customElement('gl-wip-details')
export class GlWipDetails extends GlDetailsBase {
	static override styles = [
		css`
			:host {
				--gk-avatar-size: 1.6rem;
			}
		`,
	];
	override readonly tab = 'wip';

	@property({ type: Object })
	wip?: Wip;

	@property({ type: Object })
	draftState?: DraftState;

	@property({ type: Object })
	generate?: GenerateState;

	@state()
	get inReview(): boolean {
		return this.draftState?.inReview ?? false;
	}

	get isUnpublished(): boolean {
		const branch = this.wip?.branch;
		return branch?.upstream == null || branch.upstream.missing === true;
	}

	get draftsEnabled(): boolean {
		return this.orgSettings?.drafts === true;
	}

	get filesCount(): number {
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

	@state()
	patchCreateMetadata: { title: string | undefined; description: string | undefined } = {
		title: undefined,
		description: undefined,
	};

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
			...this.patchCreateMetadata,
			changes: {
				[key]: change,
			},
			creationError: undefined,
			visibility: 'public',
			userSelections: undefined,
		};
	}

	get codeSuggestions() {
		return this.wip?.codeSuggestions ?? [];
	}

	constructor() {
		super();

		defineGkElement(Avatar);
	}

	protected override updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

		if (changedProperties.has('generate')) {
			this.patchCreateMetadata = {
				title: this.generate?.title ?? this.patchCreateMetadata.title,
				description: this.generate?.description ?? this.patchCreateMetadata.description,
			};
		}
	}

	override get filesChangedPaneLabel(): string {
		return 'Working Changes';
	}

	protected override renderChangedFilesActions(): TemplateResult<1> | undefined {
		if (!this.files?.length) return undefined;

		if (this.preferences?.aiEnabled && this.orgSettings?.ai) {
			return html`<div class="section section--actions">
				<button-container>
					<gl-button
						full
						.href=${createCommandLink('gitlens.ai.generateCommits', {
							repoPath: this.wip?.repo.path,
							source: { source: 'inspect' },
						} as GenerateCommitsCommandArgs)}
						tooltip="Generate Commits with AI (Preview) — organize working changes into meaningful commits"
						.tooltipPlacement=${'top'}
						>Commit with AI (Preview)<code-icon icon="sparkle" slot="prefix"></code-icon
					></gl-button>
					<gl-button
						appearance="secondary"
						.href=${createCommandLink('gitlens.ai.composeCommits', {
							repoPath: this.wip?.repo.path,
							source: 'inspect',
						} as ComposeCommandArgs)}
						tooltip="Compose Commits with AI (Preview) — interactively organize working changes into meaningful commits"
						.tooltipPlacement=${'top'}
						>Compose with AI (Preview)<code-icon icon="sparkle" slot="prefix"></code-icon
					></gl-button>
					<gl-button appearance="secondary" href="command:workbench.view.scm" tooltip="Commit via SCM"
						><code-icon rotate="45" icon="arrow-up"></code-icon
					></gl-button>
				</button-container>
			</div>`;
		}
		return html`<div class="section section--actions">
			<button-container>
				<gl-button full href="command:workbench.view.scm"
					>Commit via SCM <code-icon rotate="45" icon="arrow-up" slot="suffix"></code-icon
				></gl-button>
			</button-container>
		</div>`;
	}

	private renderSecondaryAction(hasPrimary = true) {
		if (!this.draftsEnabled || this.inReview) return undefined;

		let label = 'Share as Cloud Patch';
		let action = 'create-patch';
		const pr = this.wip?.pullRequest;
		if (pr != null && pr.state === 'opened' && equalsIgnoreCase(pr.provider.domain, 'github.com')) {
			// const isMe = pr.author.name.endsWith('(you)');
			// if (isMe) {
			// 	label = 'Share with PR Participants';
			// 	action = 'create-patch';
			// } else {
			// 	label = `Start Review for PR #${pr.id}`;
			// 	action = 'create-patch';
			// }

			if (!this.inReview) {
				label = 'Suggest Changes for PR';
				action = 'start-patch-review';
			} else {
				label = 'Close Suggestion for PR';
				action = 'end-patch-review';
			}

			if ((this.wip?.changes?.files.length ?? 0) === 0) {
				return html`
					<gl-button
						?full=${!hasPrimary}
						appearance="secondary"
						data-action="${action}"
						@click=${() => this.onToggleReviewMode(!this.inReview)}
						.tooltip=${hasPrimary ? label : undefined}
					>
						<code-icon icon="gl-code-suggestion" .slot=${!hasPrimary ? 'prefix' : nothing}></code-icon
						>${!hasPrimary ? label : nothing}
					</gl-button>
				`;
			}

			return html`
				<gl-button
					?full=${!hasPrimary}
					appearance="secondary"
					data-action="${action}"
					.tooltip=${hasPrimary ? label : undefined}
					@click=${() => this.onToggleReviewMode(!this.inReview)}
				>
					<code-icon icon="gl-code-suggestion" .slot=${!hasPrimary ? 'prefix' : nothing}></code-icon
					>${!hasPrimary ? label : nothing}
				</gl-button>
				<gl-button
					appearance="secondary"
					density="compact"
					data-action="create-patch"
					tooltip="Share as Cloud Patch"
					@click=${() => this.onDataActionClick('create-patch')}
				>
					<code-icon icon="gl-cloud-patch-share"></code-icon>
				</gl-button>
			`;
		}

		if ((this.wip?.changes?.files.length ?? 0) === 0) return undefined;

		return html`
			<gl-button
				?full=${!hasPrimary}
				appearance="secondary"
				data-action="${action}"
				.tooltip=${hasPrimary ? label : undefined}
				@click=${() => this.onDataActionClick(action)}
			>
				<code-icon icon="gl-cloud-patch-share" .slot=${!hasPrimary ? 'prefix' : nothing}></code-icon
				>${!hasPrimary ? label : nothing}
			</gl-button>
		`;
	}

	private renderPrimaryAction() {
		const canShare = this.draftsEnabled;
		if (this.isUnpublished && canShare) {
			return html`
				<gl-button full data-action="publish-branch" @click=${() => this.onDataActionClick('publish-branch')}>
					<code-icon icon="cloud-upload" slot="prefix"></code-icon> Publish Branch
				</gl-button>
			`;
		}

		if ((!this.isUnpublished && !canShare) || this.branchState == null) return undefined;

		const { ahead, behind } = this.branchState;
		if (ahead === 0 && behind === 0) return undefined;

		const fetchLabel = behind > 0 ? 'Pull' : ahead > 0 ? 'Push' : 'Fetch';
		const fetchIcon = behind > 0 ? 'repo-pull' : ahead > 0 ? 'repo-push' : 'repo-fetch';

		return html`
			<gl-button
				full
				data-action="${fetchLabel.toLowerCase()}"
				@click=${() => this.onDataActionClick(fetchLabel.toLowerCase())}
			>
				<code-icon icon="${fetchIcon}" slot="prefix"></code-icon> ${fetchLabel}
				<gl-tracking-pill .ahead=${ahead} .behind=${behind} slot="suffix"></gl-tracking-pill>
			</gl-button>
		`;
	}

	private renderActions() {
		const primaryAction = this.renderPrimaryAction();
		const secondaryAction = this.renderSecondaryAction(primaryAction != null);
		if (primaryAction == null && secondaryAction == null) return nothing;

		return html`<div class="section section--actions">
			<button-container>${primaryAction}${secondaryAction}</button-container>
		</div>`;
	}

	private renderSuggestedChanges() {
		if (this.codeSuggestions.length === 0) return nothing;
		// src="${this.issue!.author.avatarUrl}"
		// title="${this.issue!.author.name} (author)"
		return html`
			<gl-tree>
				<gl-tree-item branch .expanded=${true} .level=${0}>
					<code-icon slot="icon" icon="gl-code-suggestion"></code-icon>
					Code Suggestions
				</gl-tree-item>
				${repeat(
					this.codeSuggestions,
					draft => draft.id,
					draft => html`
						<gl-tree-item
							.expanded=${true}
							.level=${1}
							@gl-tree-item-selected=${() => this.onShowCodeSuggestion(draft.id)}
						>
							<gk-avatar
								class="author-icon"
								src="${draft.author.avatarUri}"
								title="${draft.author.name} (author)"
							></gk-avatar>
							${draft.title}
							<span slot="description"
								><formatted-date .date=${new Date(draft.updatedAt)}></formatted-date
							></span>
						</gl-tree-item>
					`,
				)}
			</gl-tree>
		`;
	}

	private renderPullRequest() {
		if (this.wip?.pullRequest == null) return nothing;

		return html`
			<webview-pane
				collapsable
				flexible
				?expanded=${this.preferences?.pullRequestExpanded ?? true}
				data-region="pullrequest-pane"
			>
				<span slot="title">Pull Request #${this.wip?.pullRequest?.id}</span>
				<action-nav slot="actions">
					<action-item
						label="Open Pull Request Changes"
						icon="diff-multiple"
						@click=${() => this.onDataActionClick('open-pr-changes')}
					></action-item>
					<action-item
						label="Compare Pull Request"
						icon="compare-changes"
						@click=${() => this.onDataActionClick('open-pr-compare')}
					></action-item>
					<action-item
						label="Open Pull Request on Remote"
						icon="globe"
						@click=${() => this.onDataActionClick('open-pr-remote')}
					></action-item>
				</action-nav>
				<div class="section">
					<issue-pull-request
						type="pr"
						name="${this.wip.pullRequest.title}"
						url="${this.wip.pullRequest.url}"
						identifier="#${this.wip.pullRequest.id}"
						status="${this.wip.pullRequest.state}"
						.date=${this.wip.pullRequest.updatedDate}
						.dateFormat="${this.preferences?.dateFormat}"
						.dateStyle="${this.preferences?.dateStyle}"
						details
					></issue-pull-request>
				</div>
				${this.renderSuggestedChanges()}
			</webview-pane>
		`;
	}

	private renderIncomingOutgoing() {
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

	private renderPatchCreation() {
		if (!this.inReview) return nothing;

		return html`<gl-inspect-patch
			.orgSettings=${this.orgSettings}
			.preferences=${this.preferences}
			.generate=${this.generate}
			.createState=${this.patchCreateState}
			@gl-patch-create-patch=${(e: CustomEvent) => {
				// this.onDataActionClick('create-patch');
				console.log('gl-patch-create-patch', e);
				void this.dispatchEvent(new CustomEvent('gl-inspect-create-suggestions', { detail: e.detail }));
			}}
		></gl-inspect-patch>`;
	}

	override render(): unknown {
		if (this.wip == null) return nothing;

		return html`
			${this.renderActions()}
			<webview-pane-group flexible>
				${this.renderPullRequest()}
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

	private onDataActionClick(name: string) {
		void this.dispatchEvent(new CustomEvent('data-action', { detail: { name: name } }));
	}

	private onToggleReviewMode(inReview: boolean) {
		this.dispatchEvent(new CustomEvent('draft-state-changed', { detail: { inReview: inReview } }));
	}

	private onShowCodeSuggestion(id: string) {
		this.dispatchEvent(new CustomEvent('gl-show-code-suggestion', { detail: { id: id } }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-wip-details': GlWipDetails;
	}
}

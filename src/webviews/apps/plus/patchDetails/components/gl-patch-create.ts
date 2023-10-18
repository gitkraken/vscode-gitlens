import { defineGkElement, Menu, MenuItem, Popover } from '@gitkraken/shared-web-components';
import { html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { RepoChangeSet, RepoWipChangeSet, State } from '../../../../../plus/webviews/patchDetails/protocol';
import type { Serialized } from '../../../../../system/serialize';
import type { GlCreateDetails } from './gl-create-details';
import '../../../shared/components/button';
import '../../../shared/components/code-icon';
import './gl-create-details';

export interface CreatePatchEventDetail {
	title: string;
	description?: string;
	changeSets: Record<string, RepoChangeSet>;
}

@customElement('gl-patch-create')
export class GlPatchCreate extends LitElement {
	@property({ type: Object }) state?: Serialized<State>;

	@state()
	patchTitle = '';

	@state()
	description = '';

	@query('#title')
	titleInput!: HTMLInputElement;

	@query('#desc')
	descInput!: HTMLInputElement;

	@query('gl-create-details')
	createDetails!: GlCreateDetails;

	get createEntries() {
		if (this.state?.create == null) {
			return undefined;
		}

		return Object.entries(this.state.create);
	}

	get hasWipChanges() {
		if (this.createEntries == null) {
			return false;
		}

		return this.createEntries.some(([_id, changeSet]) => changeSet.change?.type === 'wip');
	}

	get hasChangedFiles() {
		if (this.createEntries == null) {
			return false;
		}

		return this.createEntries.some(([_id, changeSet]) => changeSet.change?.files != null);
	}

	get selectedChanges(): [string, RepoChangeSet][] | undefined {
		return this.createEntries?.filter(([_id, changeSet]) => changeSet.checked !== false);
	}

	get canSubmit() {
		return this.patchTitle.length > 0 && this.selectedChanges != null && this.selectedChanges.length > 0;
	}

	get repoChanges() {
		if (this.state?.create == null) {
			return undefined;
		}
		return Object.values(this.state.create);
	}

	constructor() {
		super();

		defineGkElement(Menu, MenuItem, Popover);
	}

	renderForm() {
		return html`
			<div class="section">
				<div class="message-input">
					<input id="title" type="text" class="message-input__control" placeholder="Title (required)" .value=${
						this.patchTitle
					} @input=${this.onTitleInput}></textarea>
				</div>
				<div class="message-input">
					<textarea id="desc" class="message-input__control" placeholder="Description (optional)" .value=${
						this.description
					}  @input=${this.onDescriptionInput}></textarea>
				</div>
				<p class="button-container">
					<span class="button-group button-group--single">
						<gl-button full @click=${this.onCreateAll}>Create Patch</gl-button>
						${when(
							this.hasWipChanges,
							() => html`
								<gk-popover placement="bottom">
									<gl-button
										slot="trigger"
										?disabled=${!this.canSubmit}
										density="compact"
										aria-label="Create Patch Options..."
										title="Create Patch Options..."
										><code-icon icon="chevron-down"></code-icon
									></gl-button>
									<gk-menu class="mine-menu" @select=${this.onSelectCreateOption}>
										<gk-menu-item data-value="local">Create Local Patch</gk-menu-item>
									</gk-menu>
								</gk-popover>
							`,
						)}
					</span>
				</p>
			</div>
			`;
	}

	override render() {
		return html`
			${this.renderForm()}
			<gl-create-details
				.repoChanges=${this.repoChanges}
				.preferences=${this.state?.preferences}
				.isUncommitted=${true}
				@changeset-repo-checked=${this.onRepoChecked}
				@changeset-unstaged-checked=${this.onUnstagedChecked}
			>
			</gl-create-details>
		`;
	}

	private createPatch() {
		if (!this.canSubmit) {
			// TODO: show error
			let focused = false;
			if (this.titleInput.value.length === 0) {
				this.titleInput.setCustomValidity('Title is required');
				this.titleInput.reportValidity();
				this.titleInput.focus();
				focused = true;
			} else {
				this.titleInput.setCustomValidity('');
			}

			if (this.selectedChanges == null || this.selectedChanges.length === 0) {
				this.createDetails.validityMessage = 'Check at least one change';
				if (!focused) {
					this.createDetails.focus();
				}
			} else {
				this.titleInput.setCustomValidity('');
			}
			return;
		}
		this.createDetails.validityMessage = undefined;
		this.titleInput.setCustomValidity('');

		const changes = this.selectedChanges!.reduce<Record<string, RepoChangeSet>>((a, [id, changeSet]) => {
			a[id] = changeSet;
			return a;
		}, {});

		const patch = {
			title: this.patchTitle,
			description: this.description,
			changeSets: changes,
		};

		this.dispatchEvent(new CustomEvent<CreatePatchEventDetail>('create-patch', { detail: patch }));
	}

	private onCreateAll(_e: Event) {
		// const change = this.state?.create?.[0];
		// if (change == null) {
		// 	return;
		// }
		// this.createPatch([change]);
		this.createPatch();
	}

	private onSelectCreateOption(e: CustomEvent<{ target: MenuItem }>) {
		// const target = e.detail?.target;
		// const value = target?.dataset?.value as 'staged' | 'unstaged' | undefined;
		// const currentChange = this.state?.create?.[0];
		// if (value == null || currentChange == null) {
		// 	return;
		// }
		// const change = {
		// 	...currentChange,
		// 	files: currentChange.files.filter(file => {
		// 		const staged = file.staged ?? false;
		// 		return (staged && value === 'staged') || (!staged && value === 'unstaged');
		// 	}),
		// };
		// this.createPatch([change]);
	}

	private getRepoChangeSet(repoUri: string) {
		if (this.state?.create == null) {
			return [];
		}

		for (const [id, changeSet] of Object.entries(this.state.create)) {
			if (changeSet.repoUri !== repoUri) {
				continue;
			}

			return [id, changeSet];
		}

		return [];
	}

	private onRepoChecked(e: CustomEvent<{ repoUri: string; checked: boolean }>) {
		const [_, changeSet] = this.getRepoChangeSet(e.detail.repoUri);

		if ((changeSet as RepoWipChangeSet).checked === e.detail.checked) {
			return;
		}

		(changeSet as RepoWipChangeSet).checked = e.detail.checked;
		this.requestUpdate('state');
	}

	private onUnstagedChecked(e: CustomEvent<{ repoUri: string; checked: boolean | 'staged' }>) {
		const [_, changeSet] = this.getRepoChangeSet(e.detail.repoUri);

		if ((changeSet as RepoWipChangeSet).checked === e.detail.checked) {
			return;
		}

		(changeSet as RepoWipChangeSet).checked = e.detail.checked;
		this.requestUpdate('state');
	}

	private onTitleInput(e: InputEvent) {
		this.patchTitle = (e.target as HTMLInputElement).value;
	}

	private onDescriptionInput(e: InputEvent) {
		this.description = (e.target as HTMLInputElement).value;
	}

	protected override createRenderRoot() {
		return this;
	}
}

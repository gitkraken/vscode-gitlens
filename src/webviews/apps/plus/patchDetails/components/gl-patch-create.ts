import { defineGkElement, Menu, MenuItem, Popover } from '@gitkraken/shared-web-components';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { Change, RepoWipChangeSet, State } from '../../../../../plus/webviews/patchDetails/protocol';
import type { Serialized } from '../../../../../system/serialize';
import '../../../shared/components/button';
import '../../../shared/components/code-icon';
import './gl-create-details';

export interface CreatePatchEventDetail {
	title: string;
	description?: string;
	changes: Change[];
}

@customElement('gl-patch-create')
export class GlPatchCreate extends LitElement {
	@property({ type: Object }) state?: Serialized<State>;

	@state()
	patchTitle = '';

	@state()
	description = '';

	@state()
	selectedChanges: Change[] = [];

	get hasWipChanges() {
		if (this.state?.create == null) {
			return false;
		}

		return Object.values(this.state.create).some(c => c.change?.type === 'wip');
	}

	get hasChangedFiles() {
		if (this.state?.create == null) {
			return false;
		}

		return Object.values(this.state.create).some(c => c.change?.files != null);
	}

	@state()
	get canSubmit() {
		return this.patchTitle.length > 0 && this.hasChangedFiles; // this.selectedChanges.length > 0 &&
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
					<input type="text" class="message-input__control" placeholder="Title" .value=${this.patchTitle} @input=${
						this.onTitleInput
					}></textarea>
				</div>
				<div class="message-input">
					<textarea class="message-input__control" placeholder="Description (optional)" .value=${this.description}  @input=${
						this.onDescriptionInput
					}></textarea>
				</div>
				<p class="button-container">
					<span class="button-group button-group--single">
						<gl-button ?disabled=${!this.canSubmit} full @click=${this.onCreateAll}>Create Patch</gl-button>
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

	private createPatch(changes: Change[]) {
		if (!this.canSubmit) {
			// TODO: show error
			return;
		}

		const patch = {
			title: this.patchTitle,
			description: this.description,
			changes: changes,
		};

		this.dispatchEvent(new CustomEvent<CreatePatchEventDetail>('create-patch', { detail: patch }));
	}

	private onCreateAll(_e: Event) {
		// const change = this.state?.create?.[0];
		// if (change == null) {
		// 	return;
		// }
		// this.createPatch([change]);
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
		const [id, changeSet] = this.getRepoChangeSet(e.detail.repoUri);

		if ((changeSet as RepoWipChangeSet).checked === e.detail.checked) {
			return;
		}

		(changeSet as RepoWipChangeSet).checked = e.detail.checked;
		this.requestUpdate('state');
	}

	private onUnstagedChecked(e: CustomEvent<{ repoUri: string; checked: boolean | 'staged' }>) {
		const [id, changeSet] = this.getRepoChangeSet(e.detail.repoUri);

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

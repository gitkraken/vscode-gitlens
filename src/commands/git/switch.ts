'use strict';
/* eslint-disable no-loop-func */
import { ProgressLocation, window } from 'vscode';
import { Container } from '../../container';
import { GitBranch, GitReference, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import {
	getBranchesAndOrTags,
	getValidateGitReferenceFn,
	QuickCommandBase,
	SelectableQuickInputButton,
	StepAsyncGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { ReferencesQuickPickItem, RepositoryQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';
import { Logger } from '../../logger';

interface State {
	repos: Repository[];
	reference: GitBranch | GitReference;
	createBranch?: string;
}

export interface SwitchGitCommandArgs {
	readonly command: 'switch';
	state?: Partial<State>;

	confirm?: boolean;
}

export class SwitchGitCommand extends QuickCommandBase<State> {
	private readonly Buttons = class {
		static readonly ShowTags = class extends SelectableQuickInputButton {
			constructor(on = false) {
				super('Show Tags', 'tag', on);
			}
		};
	};

	constructor(args?: SwitchGitCommandArgs) {
		super('switch', 'switch', 'Switch', {
			description: 'aka checkout, switches the current branch to a specified branch',
		});

		if (args == null || args.state == null) return;

		let counter = 0;
		if (args.state.repos != null && args.state.repos.length !== 0) {
			counter++;
		}

		if (args.state.reference != null) {
			counter++;
		}

		this._initialState = {
			counter: counter,
			confirm: args.confirm,
			...args.state,
		};
	}

	async execute(state: State) {
		return void (await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Switching ${
					state.repos.length === 1 ? state.repos[0].formattedName : `${state.repos.length} repositories`
				} to ${state.reference.ref}`,
			},
			() =>
				Promise.all(
					state.repos.map(r =>
						r.switch(state.reference.ref, { createBranch: state.createBranch, progress: false }),
					),
				),
		));
	}

	isMatch(name: string) {
		return super.isMatch(name) || name === 'checkout';
	}

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState == null ? { counter: 0 } : this._initialState;
		let repos;
		let showTags = false;

		while (true) {
			try {
				if (repos == null) {
					repos = [...(await Container.git.getOrderedRepositories())];
				}

				if (state.repos == null || state.counter < 1) {
					if (repos.length === 1) {
						state.counter++;
						state.repos = [repos[0]];
					} else {
						let actives: Repository[];
						if (state.repos) {
							actives = state.repos;
						} else {
							const active = await Container.git.getActiveRepository();
							actives = active ? [active] : [];
						}

						const step = this.createPickStep<RepositoryQuickPickItem>({
							multiselect: true,
							title: this.title,
							placeholder: 'Choose repositories',
							items: await Promise.all(
								repos.map(repo =>
									RepositoryQuickPickItem.create(
										repo,
										actives.some(r => r.id === repo.id),
										{
											branch: true,
											fetched: true,
											status: true,
										},
									),
								),
							),
						});
						const selection: StepSelection<typeof step> = yield step;

						if (!this.canPickStepMoveNext(step, state, selection)) {
							break;
						}

						state.repos = selection.map(i => i.item);
					}
				}

				if (state.reference == null || state.counter < 2) {
					showTags = state.repos.length === 1;

					const showTagsButton: SelectableQuickInputButton = new this.Buttons.ShowTags(showTags);

					const items = await getBranchesAndOrTags(
						state.repos,
						showTags ? ['branches', 'tags'] : ['branches'],
						state.repos.length === 1 ? undefined : { filterBranches: b => !b.remote },
					);

					const step = this.createPickStep<ReferencesQuickPickItem>({
						title: `${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repos.length === 1
								? state.repos[0].formattedName
								: `${state.repos.length} repositories`
						}`,
						placeholder: `Choose a branch${showTags ? ' or tag' : ''} to switch to${GlyphChars.Space.repeat(
							3,
						)}(select or enter a reference)`,
						matchOnDescription: true,
						matchOnDetail: true,
						items: items,
						selectedItems: state.reference
							? items.filter(ref => ref.label === state.reference!.ref)
							: undefined,
						additionalButtons: [showTagsButton],
						onDidClickButton: async (quickpick, button) => {
							quickpick.busy = true;
							quickpick.enabled = false;

							showTags = !showTags;
							showTagsButton.on = showTags;

							quickpick.placeholder = `Choose a branch${
								showTags ? ' or tag' : ''
							} to switch to${GlyphChars.Space.repeat(3)}(select or enter a reference)`;

							quickpick.items = await getBranchesAndOrTags(
								state.repos!,
								showTags ? ['branches', 'tags'] : ['branches'],
								state.repos!.length === 1 ? undefined : { filterBranches: b => !b.remote },
							);

							quickpick.busy = false;
							quickpick.enabled = true;
						},
						onValidateValue: getValidateGitReferenceFn(state.repos),
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						if (repos.length === 1) {
							break;
						}

						continue;
					}

					state.reference = selection[0].item;
				}

				if (GitBranch.is(state.reference) && state.reference.remote) {
					const branches = await Container.git.getBranches(state.reference.repoPath, {
						filter: b => {
							return b.tracking === state.reference!.name;
						},
					});

					if (branches.length === 0) {
						const step = this.createInputStep({
							title: `${this.title} to new branch based on ${state.reference.ref}${Strings.pad(
								GlyphChars.Dot,
								2,
								2,
							)}${
								state.repos.length === 1
									? state.repos[0].formattedName
									: `${state.repos.length} repositories`
							}`,
							placeholder: 'Please provide a name for the local branch',
							value: state.reference.getName(),
							validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
								if (value == null) return [false, undefined];

								value = value.trim();
								if (value.length === 0) return [false, 'Please enter a valid branch name'];

								const valid = Boolean(await Container.git.validateBranchOrTagName(value));
								return [valid, valid ? undefined : `'${value}' isn't a valid branch name`];
							},
						});

						const value: StepSelection<typeof step> = yield step;

						if (!(await this.canInputStepMoveNext(step, state, value))) {
							continue;
						}

						state.createBranch = value;
					} else {
						state.createBranch = undefined;
					}
				} else {
					state.createBranch = undefined;
				}

				if (this.confirm(state.confirm)) {
					const step = this.createConfirmStep(
						`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repos.length === 1
								? state.repos[0].formattedName
								: `${state.repos.length} repositories`
						}`,
						[
							{
								label: state.createBranch ? `Create Branch and ${this.title}` : this.title,
								description: state.createBranch ? `to ${state.createBranch}` : state.reference.name,
								detail: `Will ${
									state.createBranch
										? `create and switch to branch ${state.createBranch} based on ${state.reference.name}`
										: `switch to ${state.reference.name}`
								} in ${
									state.repos.length === 1
										? state.repos[0].formattedName
										: `${state.repos.length} repositories`
								}`,
							},
						],
					);
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						continue;
					}
				}

				this.execute(state as State);
				break;
			} catch (ex) {
				Logger.error(ex, this.title);

				throw ex;
			}
		}

		return undefined;
	}
}

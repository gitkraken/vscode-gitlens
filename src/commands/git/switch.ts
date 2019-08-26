'use strict';
/* eslint-disable no-loop-func */
import { ProgressLocation, QuickInputButton, window } from 'vscode';
import { Container } from '../../container';
import { GitBranch, GitReference, GitTag, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { getBranchesAndOrTags, QuickCommandBase, StepAsyncGenerator, StepSelection, StepState } from '../quickCommand';
import { ReferencesQuickPickItem, RefQuickPickItem, RepositoryQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';
import { Logger } from '../../logger';

type Mutable<T, K extends keyof T> = Omit<T, K> & { -readonly [P in K]: T[P] };

interface State {
	repos: Repository[];
	branchOrTagOrRef: GitBranch | GitTag | GitReference;
	createBranch?: string;
}

export interface SwitchGitCommandArgs {
	readonly command: 'switch';
	state?: Partial<State>;

	confirm?: boolean;
}

export class SwitchGitCommand extends QuickCommandBase<State> {
	constructor(args?: SwitchGitCommandArgs) {
		super('switch', 'switch', 'Switch');

		if (args === undefined || args.state === undefined) return;

		let counter = 0;
		if (args.state.repos !== undefined && args.state.repos.length !== 0) {
			counter++;
		}

		if (args.state.branchOrTagOrRef !== undefined) {
			counter++;
		}

		this._initialState = {
			counter: counter,
			confirm: args.confirm,
			...args.state
		};
	}

	async execute(state: State) {
		return void (await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Switching ${
					state.repos.length === 1 ? state.repos[0].formattedName : `${state.repos.length} repositories`
				} to ${state.branchOrTagOrRef.ref}`
			},
			() =>
				Promise.all(
					state.repos.map(r =>
						r.checkout(state.branchOrTagOrRef.ref, { createBranch: state.createBranch, progress: false })
					)
				)
		));
	}

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
		let oneRepo = false;
		let showTags = false;

		while (true) {
			try {
				if (state.repos === undefined || state.counter < 1) {
					const repos = [...(await Container.git.getOrderedRepositories())];

					if (repos.length === 1) {
						oneRepo = true;
						state.counter++;
						state.repos = [repos[0]];
					} else {
						const step = this.createPickStep<RepositoryQuickPickItem>({
							multiselect: true,
							title: this.title,
							placeholder: 'Choose repositories',
							items: await Promise.all(
								repos.map(repo =>
									RepositoryQuickPickItem.create(
										repo,
										state.repos ? state.repos.some(r => r.id === repo.id) : undefined,
										{ branch: true, fetched: true, status: true }
									)
								)
							)
						});
						const selection: StepSelection<typeof step> = yield step;

						if (!this.canPickStepMoveNext(step, state, selection)) {
							break;
						}

						state.repos = selection.map(i => i.item);
					}
				}

				if (state.branchOrTagOrRef === undefined || state.counter < 2) {
					showTags = state.repos.length === 1;

					const toggleTagsButton: Mutable<QuickInputButton, 'tooltip'> = {
						iconPath: {
							dark: Container.context.asAbsolutePath('images/dark/icon-tag.svg') as any,
							light: Container.context.asAbsolutePath('images/light/icon-tag.svg') as any
						},
						tooltip: showTags ? 'Hide Tags' : 'Show Tags'
					};

					const items = await getBranchesAndOrTags(
						state.repos,
						showTags,
						state.repos.length === 1 ? undefined : { filterBranches: b => !b.remote }
					);

					const step = this.createPickStep<ReferencesQuickPickItem>({
						title: `${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repos.length === 1
								? state.repos[0].formattedName
								: `${state.repos.length} repositories`
						}`,
						placeholder: `Choose a branch${showTags ? ' or tag' : ''} to switch to${GlyphChars.Space.repeat(
							3
						)}(select or enter a reference)`,
						matchOnDescription: true,
						items: items,
						selectedItems: state.branchOrTagOrRef
							? items.filter(ref => ref.label === state.branchOrTagOrRef!.ref)
							: undefined,
						additionalButtons: [toggleTagsButton],
						onDidClickButton: async (quickpick, button) => {
							quickpick.busy = true;
							quickpick.enabled = false;

							showTags = !showTags;
							toggleTagsButton.tooltip = showTags ? 'Hide Tags' : 'Show Tags';

							quickpick.placeholder = `Choose a branch${
								showTags ? ' or tag' : ''
							} to switch to${GlyphChars.Space.repeat(3)}(select or enter a reference)`;

							quickpick.items = await getBranchesAndOrTags(
								state.repos!,
								showTags,
								state.repos!.length === 1 ? undefined : { filterBranches: b => !b.remote }
							);

							quickpick.busy = false;
							quickpick.enabled = true;
						},
						// onDidAccept: (quickpick): Promise<boolean> => {
						//     const ref = quickpick.value.trim();
						//     if (ref.length === 0 || state.repos!.length !== 1) return Promise.resolve(false);

						//     return Container.git.validateReference(state.repos![0].path, ref);
						// },
						onValidateValue: async (quickpick, value) => {
							if (state.repos!.length !== 1) return false;
							if (!(await Container.git.validateReference(state.repos![0].path, value))) return false;

							quickpick.items = [RefQuickPickItem.create(value, true, { ref: true })];
							return true;
						}
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						if (oneRepo) {
							break;
						}

						continue;
					}

					state.branchOrTagOrRef = selection[0].item;
				}

				if (GitBranch.is(state.branchOrTagOrRef) && state.branchOrTagOrRef.remote) {
					const branches = await Container.git.getBranches(state.branchOrTagOrRef.repoPath, {
						filter: b => {
							return b.tracking === state.branchOrTagOrRef!.name;
						}
					});

					if (branches.length === 0) {
						const step = this.createInputStep({
							title: `${this.title} new branch to ${state.branchOrTagOrRef.ref}${Strings.pad(
								GlyphChars.Dot,
								2,
								2
							)}${
								state.repos.length === 1
									? state.repos[0].formattedName
									: `${state.repos.length} repositories`
							}`,
							placeholder: 'Please provide a name for the local branch',
							value: state.branchOrTagOrRef.getName(),
							validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
								if (value == null) return [false, undefined];

								value = value.trim();
								if (value.length === 0) return [false, 'Please enter a valid branch name'];

								const valid = Boolean(await Container.git.validateBranchName(value));
								return [valid, valid ? undefined : `'${value}' isn't a valid branch name`];
							}
						});

						const value: StepSelection<typeof step> = yield step;

						if (!(await this.canInputStepMoveNext(step, state, value))) {
							continue;
						}

						state.createBranch = value;
					}
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
								label: this.title,
								description: state.createBranch
									? `${state.createBranch} (from ${state.branchOrTagOrRef.name}) `
									: state.branchOrTagOrRef.name,
								detail: `Will ${
									state.createBranch
										? `create and switch to ${state.createBranch} (from ${state.branchOrTagOrRef.name})`
										: `switch to ${state.branchOrTagOrRef.name}`
								} in ${
									state.repos.length === 1
										? state.repos[0].formattedName
										: `${state.repos.length} repositories`
								}`
							}
						]
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

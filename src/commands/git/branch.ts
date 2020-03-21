'use strict';
/* eslint-disable no-loop-func */
import { QuickInputButton, QuickInputButtons, Uri } from 'vscode';
import { Container } from '../../container';
import { GitBranch, GitReference, Repository } from '../../git/gitService';
import {
	BreakQuickCommand,
	getBranches,
	QuickCommandBase,
	QuickPickStep,
	StepAsyncGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import {
	BranchQuickPickItem,
	Directive,
	DirectiveQuickPickItem,
	FlagsQuickPickItem,
	QuickPickItemOfT,
	RepositoryQuickPickItem,
} from '../../quickpicks';
import { Strings } from '../../system';
import { GlyphChars } from '../../constants';
import { Logger } from '../../logger';

type CreateFlags = '--switch';

interface CreateState {
	subcommand: 'create';
	repo: Repository;
	reference: GitBranch | GitReference;
	name: string;
	flags: CreateFlags[];
}

type DeleteFlags = '--force';

interface DeleteState {
	subcommand: 'delete';
	repo: Repository;
	references: GitBranch[];
	flags: DeleteFlags[];
}

type RenameFlags = '-m';

interface RenameState {
	subcommand: 'rename';
	repo: Repository;
	reference: GitBranch;
	name: string;
	flags: RenameFlags[];
}

type State = CreateState | DeleteState | RenameState;
type StashStepState<T> = StepState<T> & { repo: Repository };

const subcommandToTitleMap = new Map<State['subcommand'], string>([
	['create', 'Create'],
	['delete', 'Delete'],
	['rename', 'Rename'],
]);
function getTitle(title: string, subcommand: State['subcommand'] | undefined) {
	return subcommand == null ? title : `${subcommandToTitleMap.get(subcommand)} ${title}`;
}

export interface BranchGitCommandArgs {
	readonly command: 'branch';
	state?: Partial<State>;

	confirm?: boolean;
}

export class BranchGitCommand extends QuickCommandBase<State> {
	private readonly Buttons = class {
		static readonly RevealInView: QuickInputButton = {
			iconPath: {
				dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-eye.svg')),
				light: Uri.file(Container.context.asAbsolutePath('images/light/icon-eye.svg')),
			},
			tooltip: 'Reveal Branch in Repositories View',
		};
	};

	private _subcommand: State['subcommand'] | undefined;

	constructor(args?: BranchGitCommandArgs) {
		super('branch', 'branch', 'Branch', {
			description: 'create, rename, or delete branches',
		});

		if (args == null || args.state == null) return;

		let counter = 0;
		if (args.state.subcommand != null) {
			counter++;
		}

		if (args.state.repo != null) {
			counter++;
		}

		switch (args.state.subcommand) {
			case 'create':
				if (args.state.reference != null) {
					counter++;
				}

				if (args.state.name != null) {
					counter++;
				}

				break;
			case 'delete':
				if (args.state.references != null && args.state.references.length !== 0) {
					counter++;
				}

				break;
			case 'rename':
				if (args.state.reference != null) {
					counter++;
				}

				if (args.state.name != null) {
					counter++;
				}

				break;
		}

		this._initialState = {
			counter: counter,
			confirm: args.confirm,
			...args.state,
		};
	}

	get canConfirm(): boolean {
		return this._subcommand != null;
	}

	get canSkipConfirm(): boolean {
		return this._subcommand === 'delete' || this._subcommand === 'rename' ? false : super.canSkipConfirm;
	}

	get skipConfirmKey() {
		return `${this.key}${this._subcommand == null ? '' : `-${this._subcommand}`}:${this.pickedVia}`;
	}

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState == null ? { counter: 0 } : this._initialState;
		let repos;

		while (true) {
			try {
				if (state.subcommand == null || state.counter < 1) {
					this._subcommand = undefined;

					const step = this.createPickStep<QuickPickItemOfT<State['subcommand']>>({
						title: this.title,
						placeholder: `Choose a ${this.label} command`,
						items: [
							{
								label: 'create',
								description: 'creates a new branch',
								picked: state.subcommand === 'create',
								item: 'create',
							},
							{
								label: 'delete',
								description: 'deletes the specified branches',
								picked: state.subcommand === 'delete',
								item: 'delete',
							},
							{
								label: 'rename',
								description: 'renames the specified branch',
								picked: state.subcommand === 'rename',
								item: 'rename',
							},
						],
						buttons: [QuickInputButtons.Back],
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						break;
					}

					state.subcommand = selection[0].item;
				}

				this._subcommand = state.subcommand;

				if (repos == null) {
					repos = [...(await Container.git.getOrderedRepositories())];
				}

				if (state.repo == null || state.counter < 2) {
					if (repos.length === 1) {
						state.counter++;
						state.repo = repos[0];
					} else {
						const active = state.repo ? state.repo : await Container.git.getActiveRepository();

						const step = this.createPickStep<RepositoryQuickPickItem>({
							title: getTitle(this.title, state.subcommand),
							placeholder: 'Choose a repository',
							items: await Promise.all(
								repos.map(r =>
									RepositoryQuickPickItem.create(r, r.id === (active && active.id), {
										branch: true,
										fetched: true,
										status: true,
									}),
								),
							),
						});
						const selection: StepSelection<typeof step> = yield step;

						if (!this.canPickStepMoveNext(step, state, selection)) {
							continue;
						}

						state.repo = selection[0].item;
					}
				}

				switch (state.subcommand) {
					case 'create':
						yield* this.create(state as StashStepState<CreateState>);
						break;
					case 'delete':
						yield* this.delete(state as StashStepState<DeleteState>);
						break;
					case 'rename':
						yield* this.rename(state as StashStepState<RenameState>);
						break;
					default:
						return undefined;
				}

				if (repos.length === 1) {
					state.counter--;
				}
				continue;
			} catch (ex) {
				if (ex instanceof BreakQuickCommand) break;

				Logger.error(ex, `${this.title}.${state.subcommand}`);

				throw ex;
			}
		}

		return undefined;
	}

	private async *create(state: StashStepState<CreateState>): StepAsyncGenerator {
		if (state.flags == null) {
			state.flags = [];
		}

		const title = getTitle(this.title, state.subcommand);

		while (true) {
			if (state.reference == null || state.counter < 3) {
				const branches = await getBranches(state.repo, {
					picked: state.reference != null ? state.reference.ref : (await state.repo.getBranch())!.ref,
				});

				const step = this.createPickStep<BranchQuickPickItem>({
					title: `${title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					placeholder:
						branches.length === 0
							? `${state.repo.formattedName} has no branches`
							: 'Choose a branch to create the new branch from',
					matchOnDetail: true,
					items:
						branches.length === 0
							? [
									DirectiveQuickPickItem.create(Directive.Back, true),
									DirectiveQuickPickItem.create(Directive.Cancel),
							  ]
							: branches,
					additionalButtons: [this.Buttons.RevealInView],
					onDidClickButton: (quickpick, button) => {
						if (button === this.Buttons.RevealInView) {
							if (quickpick.activeItems.length !== 0) {
								void Container.repositoriesView.revealBranch(quickpick.activeItems[0].item, {
									select: true,
									expand: true,
								});

								return;
							}

							void Container.repositoriesView.revealBranches(state.repo.path, {
								select: true,
								expand: true,
							});
						}
					},
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (quickpick, key) => {
						if (quickpick.activeItems.length === 0) return;

						await Container.repositoriesView.revealBranch(quickpick.activeItems[0].item, {
							select: true,
							focus: false,
							expand: true,
						});
					},
				});
				const selection: StepSelection<typeof step> = yield step;

				if (!this.canPickStepMoveNext(step, state, selection)) {
					break;
				}

				state.reference = selection[0].item;
			}

			if (state.name == null || state.counter < 4) {
				const step = this.createInputStep({
					title: `${title} based on ${state.reference.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						state.repo.formattedName
					}`,
					placeholder: 'Please provide a name for the new branch',
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

				state.name = value;
			}

			if (this.confirm(state.confirm)) {
				const step: QuickPickStep<FlagsQuickPickItem<CreateFlags>> = this.createConfirmStep(
					`Confirm ${title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					[
						FlagsQuickPickItem.create<CreateFlags>(state.flags, [], {
							label: title,
							description: state.name,
							detail: `Will create branch ${state.name} based on ${state.reference.name}`,
						}),
						FlagsQuickPickItem.create<CreateFlags>(state.flags, ['--switch'], {
							label: `${title} and Switch`,
							description: `to ${state.name}`,
							detail: `Will create and switch to branch ${state.name} based on ${state.reference.name}`,
						}),
					],
					undefined,
					{
						placeholder: `Confirm ${title}`,
					},
				);
				const selection: StepSelection<typeof step> = yield step;

				if (!this.canPickStepMoveNext(step, state, selection)) {
					break;
				}

				state.flags = selection[0].item;
			}

			if (state.flags.includes('--switch')) {
				void (await state.repo.switch(state.reference.ref, { createBranch: state.name }));
			} else {
				void state.repo.branch(...state.flags, state.name, state.reference.ref);
			}

			throw new BreakQuickCommand();
		}

		return undefined;
	}

	private async *delete(state: StashStepState<DeleteState>): StepAsyncGenerator {
		if (state.flags == null) {
			state.flags = [];
		}

		while (true) {
			let title = getTitle('Branches', state.subcommand);

			if (state.references == null || state.references.length === 0 || state.counter < 3) {
				const branches = await getBranches(state.repo, {
					filterBranches: b => !b.current,
					picked: state.references != null ? state.references.map(r => r.ref) : undefined,
				});

				const step = this.createPickStep<BranchQuickPickItem>({
					multiselect: branches.length !== 0,
					title: `${title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					placeholder:
						branches.length === 0
							? `${state.repo.formattedName} has no branches`
							: 'Choose branches to delete',
					matchOnDetail: true,
					items:
						branches.length === 0
							? [
									DirectiveQuickPickItem.create(Directive.Back, true),
									DirectiveQuickPickItem.create(Directive.Cancel),
							  ]
							: branches,
					additionalButtons: [this.Buttons.RevealInView],
					onDidClickButton: (quickpick, button) => {
						if (button === this.Buttons.RevealInView) {
							if (quickpick.activeItems.length !== 0) {
								void Container.repositoriesView.revealBranch(quickpick.activeItems[0].item, {
									select: true,
									expand: true,
								});

								return;
							}

							void Container.repositoriesView.revealBranches(state.repo.path, {
								select: true,
								expand: true,
							});
						}
					},
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (quickpick, key) => {
						if (quickpick.activeItems.length === 0) return;

						await Container.repositoriesView.revealBranch(quickpick.activeItems[0].item, {
							select: true,
							focus: false,
							expand: true,
						});
					},
				});
				const selection: StepSelection<typeof step> = yield step;

				if (!this.canPickStepMoveNext(step, state, selection)) {
					break;
				}

				state.references = selection.map(i => i.item);
			}

			title = getTitle(
				Strings.pluralize('Branch', state.references.length, {
					number: '',
					suffix: 'es',
				}).trim(),
				state.subcommand,
			);

			const step: QuickPickStep<FlagsQuickPickItem<DeleteFlags>> = this.createConfirmStep(
				`Confirm ${title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
				[
					FlagsQuickPickItem.create<DeleteFlags>(state.flags, [], {
						label: title,
						description: state.references.map(r => r.getName()).join(', '),
						detail:
							state.references.length === 1
								? `Will delete ${
										state.references[0].remote ? 'remote' : ''
								  } branch ${state.references[0].getName()}`
								: `Will delete ${Strings.pluralize('branch', state.references.length, {
										suffix: 'es',
								  })}`,
					}),
					// Don't allow force if there are remote branches
					...(!state.references.some(r => r.remote)
						? [
								FlagsQuickPickItem.create<DeleteFlags>(state.flags, ['--force'], {
									label: `Force ${title}`,
									description: state.references.map(r => r.getName()).join(', '),
									detail:
										state.references.length === 1
											? `Will forcably delete branch ${state.references[0].getName()}`
											: `Will forcably delete ${Strings.pluralize(
													'branch',
													state.references.length,
													{
														suffix: 'es',
													},
											  )}`,
								}),
						  ]
						: []),
				],
				undefined,
				{
					placeholder: `Confirm ${title}`,
				},
			);
			const selection: StepSelection<typeof step> = yield step;

			if (!this.canPickStepMoveNext(step, state, selection)) {
				break;
			}

			state.flags = selection[0].item;

			void state.repo.branchDelete(state.references, { force: state.flags.includes('--force') });

			throw new BreakQuickCommand();
		}

		return undefined;
	}

	private async *rename(state: StashStepState<RenameState>): StepAsyncGenerator {
		if (state.flags == null) {
			state.flags = [];
		}

		const title = getTitle(this.title, state.subcommand);

		while (true) {
			if (state.reference == null || state.counter < 3) {
				const branches = await getBranches(state.repo, { filterBranches: b => !b.remote });

				const step = this.createPickStep<BranchQuickPickItem>({
					title: `${title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					placeholder:
						branches.length === 0
							? `${state.repo.formattedName} has no branches`
							: 'Choose a branch to rename',
					matchOnDetail: true,
					items:
						branches.length === 0
							? [
									DirectiveQuickPickItem.create(Directive.Back, true),
									DirectiveQuickPickItem.create(Directive.Cancel),
							  ]
							: branches,
					additionalButtons: [this.Buttons.RevealInView],
					onDidClickButton: (quickpick, button) => {
						if (button === this.Buttons.RevealInView) {
							if (quickpick.activeItems.length !== 0) {
								void Container.repositoriesView.revealBranch(quickpick.activeItems[0].item, {
									select: true,
									expand: true,
								});

								return;
							}

							void Container.repositoriesView.revealBranches(state.repo.path, {
								select: true,
								expand: true,
							});
						}
					},
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (quickpick, key) => {
						if (quickpick.activeItems.length === 0) return;

						await Container.repositoriesView.revealBranch(quickpick.activeItems[0].item, {
							select: true,
							focus: false,
							expand: true,
						});
					},
				});
				const selection: StepSelection<typeof step> = yield step;

				if (!this.canPickStepMoveNext(step, state, selection)) {
					break;
				}

				state.reference = selection[0].item;
			}

			if (state.name == null || state.counter < 4) {
				const step = this.createInputStep({
					title: `${title} ${state.reference.getName()}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						state.repo.formattedName
					}`,
					placeholder: `Please provide a new name for branch ${state.reference.getName()}`,
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

				state.name = value;
			}

			const step: QuickPickStep<FlagsQuickPickItem<RenameFlags>> = this.createConfirmStep(
				`Confirm ${title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
				[
					FlagsQuickPickItem.create<RenameFlags>(state.flags, ['-m'], {
						label: title,
						description: state.reference.getName(),
						detail: `Will rename branch ${state.reference.getName()} to ${state.name}`,
					}),
				],
				undefined,
				{
					placeholder: `Confirm ${title}`,
				},
			);
			const selection: StepSelection<typeof step> = yield step;

			if (!this.canPickStepMoveNext(step, state, selection)) {
				break;
			}

			state.flags = selection[0].item;

			void state.repo.branch(...state.flags, state.reference.ref, state.name);

			throw new BreakQuickCommand();
		}

		return undefined;
	}
}

'use strict';
/* eslint-disable no-loop-func */
import { QuickInputButton, QuickInputButtons, Uri } from 'vscode';
import { Container } from '../../container';
import { GitReference, GitTag, Repository } from '../../git/gitService';
import {
	BreakQuickCommand,
	getTags,
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
	TagQuickPickItem,
} from '../../quickpicks';
import { Strings } from '../../system';
import { GlyphChars } from '../../constants';
import { Logger } from '../../logger';
import { getBranches } from '../quickCommand.helpers';

type CreateFlags = '--force' | '-m';

interface CreateState {
	subcommand: 'create';
	repo: Repository;
	reference: GitReference;
	name: string;
	message: string;
	flags: CreateFlags[];
}

interface DeleteState {
	subcommand: 'delete';
	repo: Repository;
	references: GitTag[];
}

type State = CreateState | DeleteState;
type StashStepState<T> = StepState<T> & { repo: Repository };

const subcommandToTitleMap = new Map<State['subcommand'], string>([
	['create', 'Create'],
	['delete', 'Delete'],
]);
function getTitle(title: string, subcommand: State['subcommand'] | undefined) {
	return subcommand == null ? title : `${subcommandToTitleMap.get(subcommand)} ${title}`;
}

export interface TagGitCommandArgs {
	readonly command: 'tag';
	state?: Partial<State>;

	confirm?: boolean;
}

export class TagGitCommand extends QuickCommandBase<State> {
	private readonly Buttons = class {
		static readonly RevealInView: QuickInputButton = {
			iconPath: {
				dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-eye.svg')),
				light: Uri.file(Container.context.asAbsolutePath('images/light/icon-eye.svg')),
			},
			tooltip: 'Reveal Tag in Repositories View',
		};
	};

	private _subcommand: State['subcommand'] | undefined;

	constructor(args?: TagGitCommandArgs) {
		super('tag', 'tag', 'Tag', {
			description: 'create, or delete tags',
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

				if (args.state.message != null) {
					counter++;
				}

				break;
			case 'delete':
				if (args.state.references != null && args.state.references.length !== 0) {
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
		return this._subcommand === 'delete' ? false : super.canSkipConfirm;
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
								description: 'creates a new tag',
								picked: state.subcommand === 'create',
								item: 'create',
							},
							{
								label: 'delete',
								description: 'deletes the specified tags',
								picked: state.subcommand === 'delete',
								item: 'delete',
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
							? `${state.repo.formattedName} has no tags`
							: 'Choose a branch to create the new tag from',
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
					title: `${title} at ${state.reference.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						state.repo.formattedName
					}`,
					placeholder: 'Please provide a name for the new tag',
					validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
						if (value == null) return [false, undefined];

						value = value.trim();
						if (value.length === 0) return [false, 'Please enter a valid tag name'];

						const valid = Boolean(await Container.git.validateBranchOrTagName(value));
						return [valid, valid ? undefined : `'${value}' isn't a valid tag name`];
					},
				});

				const value: StepSelection<typeof step> = yield step;

				if (!(await this.canInputStepMoveNext(step, state, value))) {
					continue;
				}

				state.name = value;
			}

			if (state.message == null || state.counter < 5) {
				const step = this.createInputStep({
					title: `${title} at ${state.reference.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						state.repo.formattedName
					}`,
					placeholder: 'Please provide an optional message to annotate the tag',
					// validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
					// 	if (value == null) return [false, undefined];

					// 	value = value.trim();
					// 	if (value.length === 0) return [false, 'Please enter a valid tag name'];

					// 	const valid = Boolean(await Container.git.validateBranchOrTagName(value));
					// 	return [valid, valid ? undefined : `'${value}' isn't a valid tag name`];
					// }
				});

				const value: StepSelection<typeof step> = yield step;

				if (!(await this.canInputStepMoveNext(step, state, value))) {
					continue;
				}

				state.message = value;
			}

			const hasMessage = state.message.length !== 0;

			if (this.confirm(state.confirm)) {
				const step: QuickPickStep<FlagsQuickPickItem<CreateFlags>> = this.createConfirmStep(
					`Confirm ${title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					[
						FlagsQuickPickItem.create<CreateFlags>(state.flags, hasMessage ? ['-m'] : [], {
							label: title,
							description: state.name,
							detail: `Will create tag ${state.name} at ${state.reference.name}`,
						}),
						FlagsQuickPickItem.create<CreateFlags>(
							state.flags,
							hasMessage ? ['--force', '-m'] : ['--force'],
							{
								label: `Force ${title}`,
								description: `to ${state.name}`,
								detail: `Will forcably create tag ${state.name} at ${state.reference.name}`,
							},
						),
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

			void state.repo.tag(
				...state.flags,
				...(hasMessage ? [`"${state.message}"`] : []),
				state.name,
				state.reference.ref,
			);

			throw new BreakQuickCommand();
		}

		return undefined;
	}

	private async *delete(state: StashStepState<DeleteState>): StepAsyncGenerator {
		while (true) {
			let title = getTitle('Tags', state.subcommand);

			if (state.references == null || state.references.length === 0 || state.counter < 3) {
				const tags = await getTags(state.repo, {
					picked: state.references != null ? state.references.map(r => r.ref) : undefined,
				});

				const step = this.createPickStep<TagQuickPickItem>({
					multiselect: tags.length !== 0,
					title: `${title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					placeholder:
						tags.length === 0 ? `${state.repo.formattedName} has no tags` : 'Choose tags to delete',
					matchOnDetail: true,
					items:
						tags.length === 0
							? [
									DirectiveQuickPickItem.create(Directive.Back, true),
									DirectiveQuickPickItem.create(Directive.Cancel),
							  ]
							: tags,
					additionalButtons: [this.Buttons.RevealInView],
					onDidClickButton: (quickpick, button) => {
						if (button === this.Buttons.RevealInView) {
							if (quickpick.activeItems.length !== 0) {
								void Container.repositoriesView.revealTag(quickpick.activeItems[0].item, {
									select: true,
									expand: true,
								});

								return;
							}

							void Container.repositoriesView.revealTags(state.repo.path, {
								select: true,
								expand: true,
							});
						}
					},
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (quickpick, key) => {
						if (quickpick.activeItems.length === 0) return;

						await Container.repositoriesView.revealTag(quickpick.activeItems[0].item, {
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
				Strings.pluralize('Tag', state.references.length, { number: '' }).trim(),
				state.subcommand,
			);

			const step = this.createConfirmStep(
				`Confirm ${title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
				[
					{
						label: title,
						description: state.references.map(r => r.name).join(', '),
						detail:
							state.references.length === 1
								? `Will delete tag ${state.references[0].name}`
								: `Will delete ${Strings.pluralize('tag', state.references.length)}`,
					},
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

			void state.repo.tagDelete(state.references);

			throw new BreakQuickCommand();
		}

		return undefined;
	}
}

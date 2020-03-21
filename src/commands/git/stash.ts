'use strict';
/* eslint-disable no-loop-func */
import { QuickInputButton, QuickInputButtons, QuickPickItem, Uri, window } from 'vscode';
import { Container } from '../../container';
import { GitStashCommit, GitUri, Repository } from '../../git/gitService';
import {
	BreakQuickCommand,
	QuickCommandBase,
	QuickPickStep,
	StepAsyncGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import {
	CommandQuickPickItem,
	CommitQuickPick,
	CommitQuickPickItem,
	Directive,
	DirectiveQuickPickItem,
	FlagsQuickPickItem,
	QuickPickItemOfT,
	RepositoryQuickPickItem,
} from '../../quickpicks';
import { Iterables, Strings } from '../../system';
import { GlyphChars } from '../../constants';
import { Logger } from '../../logger';
import { Messages } from '../../messages';

interface ApplyState {
	subcommand: 'apply';
	repo: Repository;
	stash: { stashName: string; message: string; ref: string; repoPath: string };
}

interface DropState {
	subcommand: 'drop';
	repo: Repository;
	stash: { stashName: string; message: string; ref: string; repoPath: string };
}

interface ListState {
	subcommand: 'list';
	repo: Repository;
}

interface PopState {
	subcommand: 'pop';
	repo: Repository;
	stash: { stashName: string; message: string; ref: string; repoPath: string };
}

type PushFlags = '--include-untracked' | '--keep-index';

interface PushState {
	subcommand: 'push';
	repo: Repository;
	message?: string;
	uris?: Uri[];
	flags: PushFlags[];
}

type State = ApplyState | DropState | ListState | PopState | PushState;
type StashStepState<T> = StepState<T> & { repo: Repository };

const subcommandToTitleMap = new Map<State['subcommand'], string>([
	['apply', 'Apply'],
	['drop', 'Drop'],
	['list', 'List'],
	['pop', 'Pop'],
	['push', 'Push'],
]);
function getTitle(title: string, subcommand: State['subcommand'] | undefined) {
	return subcommand == null ? title : `${subcommandToTitleMap.get(subcommand)} ${title}`;
}

export interface StashGitCommandArgs {
	readonly command: 'stash';
	state?: Partial<State>;

	confirm?: boolean;
}

export class StashGitCommand extends QuickCommandBase<State> {
	private readonly Buttons = class {
		static readonly RevealInView: QuickInputButton = {
			iconPath: {
				dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-eye.svg')),
				light: Uri.file(Container.context.asAbsolutePath('images/light/icon-eye.svg')),
			},
			tooltip: 'Reveal Stash in Repositories View',
		};
	};

	private _subcommand: State['subcommand'] | undefined;

	constructor(args?: StashGitCommandArgs) {
		super('stash', 'stash', 'Stash', {
			description: 'shelves (stashes) local changes to be reapplied later',
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
			case 'apply':
			case 'drop':
			case 'pop':
				if (args.state.stash != null) {
					counter++;
				}
				break;

			case 'push':
				if (args.state.message != null) {
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
		return this._subcommand != null && this._subcommand !== 'list';
	}

	get canSkipConfirm(): boolean {
		return this._subcommand === 'drop' ? false : super.canSkipConfirm;
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
								label: 'apply',
								description: 'integrates changes from the specified stash into the current branch',
								picked: state.subcommand === 'apply',
								item: 'apply',
							},
							{
								label: 'drop',
								description: 'deletes the specified stash',
								picked: state.subcommand === 'drop',
								item: 'drop',
							},
							{
								label: 'list',
								description: 'lists the saved stashes',
								picked: state.subcommand === 'list',
								item: 'list',
							},
							{
								label: 'pop',
								description:
									'integrates changes from the specified stash into the current branch and deletes the stash',
								picked: state.subcommand === 'pop',
								item: 'pop',
							},
							{
								label: 'push',
								description:
									'saves your local changes to a new stash and discards them from the working tree and index',
								picked: state.subcommand === 'push',
								item: 'push',
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
					case 'apply':
					case 'pop':
						yield* this.applyOrPop(state as StashStepState<ApplyState | PopState>);
						break;
					case 'drop':
						yield* this.drop(state as StashStepState<DropState>);
						break;
					case 'list':
						yield* this.list(state as StashStepState<ListState>);
						break;
					case 'push':
						yield* this.push(state as StashStepState<PushState>);
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

				switch (state.subcommand) {
					case 'apply':
					case 'pop':
						if (
							ex.message.includes(
								'Your local changes to the following files would be overwritten by merge',
							)
						) {
							void window.showWarningMessage(
								'Unable to apply stash. Your working tree changes would be overwritten. Please commit or stash your changes before trying again',
							);

							return undefined;
						} else if (
							(ex.message.includes('Auto-merging') && ex.message.includes('CONFLICT')) ||
							(ex.stdout?.includes('Auto-merging') && ex.stdout?.includes('CONFLICT')) ||
							ex.stdout?.includes('needs merge')
						) {
							void window.showInformationMessage('Stash applied with conflicts');

							return undefined;
						}

						void Messages.showGenericErrorMessage(
							`Unable to apply stash \u2014 ${ex.message.trim().replace(/\n+?/g, '; ')}`,
						);

						return undefined;

					case 'drop':
						void Messages.showGenericErrorMessage('Unable to delete stash');

						return undefined;

					case 'push':
						if (ex.message.includes('newer version of Git')) {
							void window.showErrorMessage(`Unable to stash changes. ${ex.message}`);

							return undefined;
						}

						void Messages.showGenericErrorMessage('Unable to stash changes');

						return undefined;
				}

				throw ex;
			}
		}

		return undefined;
	}

	private async *applyOrPop(state: StashStepState<ApplyState> | StashStepState<PopState>): StepAsyncGenerator {
		while (true) {
			if (state.stash == null || state.counter < 3) {
				const stash = await Container.git.getStashList(state.repo.path);

				const step = this.createPickStep<CommitQuickPickItem<GitStashCommit>>({
					title: `${getTitle(this.title, state.subcommand)}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						state.repo.formattedName
					}`,
					placeholder:
						stash == null
							? `${state.repo.formattedName} has no stashes`
							: 'Choose a stash to apply to your working tree',
					matchOnDetail: true,
					items:
						stash == null
							? [
									DirectiveQuickPickItem.create(Directive.Back, true),
									DirectiveQuickPickItem.create(Directive.Cancel),
							  ]
							: [
									...Iterables.map(stash.commits.values(), c =>
										CommitQuickPickItem.create(
											c,
											c.stashName === (state.stash && state.stash.stashName),
											{
												compact: true,
											},
										),
									),
							  ],
					additionalButtons: [this.Buttons.RevealInView],
					onDidClickButton: (quickpick, button) => {
						if (button === this.Buttons.RevealInView) {
							if (quickpick.activeItems.length !== 0) {
								void Container.repositoriesView.revealStash(quickpick.activeItems[0].item, {
									select: true,
									expand: true,
								});

								return;
							}

							void Container.repositoriesView.revealStashes(state.repo.path, {
								select: true,
								expand: true,
							});
						}
					},
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (quickpick, key) => {
						if (quickpick.activeItems.length === 0) return;

						await Container.repositoriesView.revealStash(quickpick.activeItems[0].item, {
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

				state.stash = selection[0].item;
			}

			if (this.confirm(state.confirm)) {
				const message =
					state.stash.message.length > 80
						? `${state.stash.message.substring(0, 80)}${GlyphChars.Ellipsis}`
						: state.stash.message;

				const step = this.createConfirmStep<QuickPickItem & { command: 'apply' | 'pop' }>(
					`Confirm ${getTitle(this.title, state.subcommand)}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						state.repo.formattedName
					}`,
					[
						{
							label: getTitle(this.title, state.subcommand),
							description: `${state.stash.stashName}${Strings.pad(GlyphChars.Dash, 2, 2)}${message}`,
							detail:
								state.subcommand === 'pop'
									? `Will delete ${state.stash.stashName} and apply the changes to the working tree of ${state.repo.formattedName}`
									: `Will apply the changes from ${state.stash.stashName} to the working tree of ${state.repo.formattedName}`,
							command: state.subcommand!,
						},
						// Alternate confirmation (if pop then apply, and vice versa)
						{
							label: getTitle(this.title, state.subcommand === 'pop' ? 'apply' : 'pop'),
							description: `${state.stash.stashName}${Strings.pad(GlyphChars.Dash, 2, 2)}${message}`,
							detail:
								state.subcommand === 'pop'
									? `Will apply the changes from ${state.stash.stashName} to the working tree of ${state.repo.formattedName}`
									: `Will delete ${state.stash.stashName} and apply the changes to the working tree of ${state.repo.formattedName}`,
							command: state.subcommand === 'pop' ? 'apply' : 'pop',
						},
					],
					undefined,
					{
						placeholder: `Confirm ${getTitle(this.title, state.subcommand)}`,
						additionalButtons: [this.Buttons.RevealInView],
						onDidClickButton: (quickpick, button) => {
							if (button === this.Buttons.RevealInView) {
								void Container.repositoriesView.revealStash(state.stash!, {
									select: true,
									expand: true,
								});
							}
						},
					},
				);
				const selection: StepSelection<typeof step> = yield step;

				if (!this.canPickStepMoveNext(step, state, selection)) {
					break;
				}

				state.subcommand = selection[0].command;
			}

			void (await state.repo.stashApply(state.stash.stashName, { deleteAfter: state.subcommand === 'pop' }));

			throw new BreakQuickCommand();
		}

		return undefined;
	}

	private async *drop(state: StashStepState<DropState>): StepAsyncGenerator {
		while (true) {
			if (state.stash == null || state.counter < 3) {
				const stash = await Container.git.getStashList(state.repo.path);

				const step = this.createPickStep<CommitQuickPickItem<GitStashCommit>>({
					title: `${getTitle(this.title, state.subcommand)}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						state.repo.formattedName
					}`,
					placeholder:
						stash == null ? `${state.repo.formattedName} has no stashes` : 'Choose a stash to delete',
					matchOnDetail: true,
					items:
						stash == null
							? [
									DirectiveQuickPickItem.create(Directive.Back, true),
									DirectiveQuickPickItem.create(Directive.Cancel),
							  ]
							: [
									...Iterables.map(stash.commits.values(), c =>
										CommitQuickPickItem.create(
											c,
											c.stashName === (state.stash && state.stash.stashName),
											{
												compact: true,
											},
										),
									),
							  ],
					additionalButtons: [this.Buttons.RevealInView],
					onDidClickButton: (quickpick, button) => {
						if (button === this.Buttons.RevealInView) {
							if (quickpick.activeItems.length !== 0) {
								void Container.repositoriesView.revealStash(quickpick.activeItems[0].item, {
									select: true,
									expand: true,
								});

								return;
							}

							void Container.repositoriesView.revealStashes(state.repo.path, {
								select: true,
								expand: true,
							});
						}
					},
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (quickpick, key) => {
						if (quickpick.activeItems.length === 0) return;

						await Container.repositoriesView.revealStash(quickpick.activeItems[0].item, {
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

				state.stash = selection[0].item;
			}

			const message =
				state.stash.message.length > 80
					? `${state.stash.message.substring(0, 80)}${GlyphChars.Ellipsis}`
					: state.stash.message;

			const step = this.createConfirmStep(
				`Confirm ${getTitle(this.title, state.subcommand)}${Strings.pad(GlyphChars.Dot, 2, 2)}${
					state.repo.formattedName
				}`,
				[
					{
						label: getTitle(this.title, state.subcommand),
						description: `${state.stash.stashName}${Strings.pad(GlyphChars.Dash, 2, 2)}${message}`,
						detail: `Will delete ${state.stash.stashName}`,
					},
				],
				undefined,
				{
					placeholder: `Confirm ${getTitle(this.title, state.subcommand)}`,
					additionalButtons: [this.Buttons.RevealInView],
					onDidClickButton: (quickpick, button) => {
						if (button === this.Buttons.RevealInView) {
							void Container.repositoriesView.revealStash(state.stash!, {
								select: true,
								expand: true,
							});
						}
					},
				},
			);
			const selection: StepSelection<typeof step> = yield step;

			if (!this.canPickStepMoveNext(step, state, selection)) {
				break;
			}

			void (await state.repo.stashDelete(state.stash.stashName));

			throw new BreakQuickCommand();
		}

		return undefined;
	}

	private async *list(state: StashStepState<ListState>): StepAsyncGenerator {
		let pickedStash: GitStashCommit | undefined;

		while (true) {
			const stash = await Container.git.getStashList(state.repo.path);

			const step = this.createPickStep<CommitQuickPickItem<GitStashCommit>>({
				title: `${getTitle(this.title, state.subcommand)}${Strings.pad(GlyphChars.Dot, 2, 2)}${
					state.repo.formattedName
				}`,
				placeholder: stash == null ? `${state.repo.formattedName} has no stashes` : 'Choose a stash',
				matchOnDetail: true,
				items:
					stash == null
						? [
								DirectiveQuickPickItem.create(Directive.Back, true),
								DirectiveQuickPickItem.create(Directive.Cancel),
						  ]
						: [
								...Iterables.map(stash.commits.values(), c =>
									CommitQuickPickItem.create(c, c.ref === (pickedStash && pickedStash.ref), {
										compact: true,
									}),
								),
						  ],
				additionalButtons: [this.Buttons.RevealInView],
				onDidClickButton: (quickpick, button) => {
					if (button === this.Buttons.RevealInView) {
						if (quickpick.activeItems.length !== 0) {
							void Container.repositoriesView.revealStash(quickpick.activeItems[0].item, {
								select: true,
								expand: true,
							});

							return;
						}

						void Container.repositoriesView.revealStashes(state.repo.path, {
							select: true,
							expand: true,
						});
					}
				},
				keys: ['right', 'alt+right', 'ctrl+right'],
				onDidPressKey: async (quickpick, key) => {
					if (quickpick.activeItems.length === 0) return;

					await Container.repositoriesView.revealStash(quickpick.activeItems[0].item, {
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

			pickedStash = selection[0].item;

			if (pickedStash != null) {
				const step = this.createPickStep<CommandQuickPickItem>({
					title: `${getTitle(this.title, state.subcommand)}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						state.repo.formattedName
					}${Strings.pad(GlyphChars.Dot, 2, 2)}${pickedStash.shortSha}`,
					placeholder: `${
						pickedStash.number == null ? '' : `${pickedStash.number}: `
					}${pickedStash.getShortMessage()}`,
					items: await CommitQuickPick.getItems(pickedStash, pickedStash.toGitUri(), { showChanges: false }),
					additionalButtons: [this.Buttons.RevealInView],
					onDidClickButton: (quickpick, button) => {
						if (button !== this.Buttons.RevealInView) return;

						void Container.repositoriesView.revealStash(pickedStash!, {
							select: true,
							expand: true,
						});
					},
				});
				const selection: StepSelection<typeof step> = yield step;

				if (!this.canPickStepMoveNext(step, state, selection)) {
					continue;
				}

				const command = selection[0];
				if (command instanceof CommandQuickPickItem) {
					void (await command.execute());

					throw new BreakQuickCommand();
				}
			}
		}

		return undefined;
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	private async *push(state: StashStepState<PushState>): StepAsyncGenerator {
		if (state.flags == null) {
			state.flags = [];
		}

		while (true) {
			if (state.message == null || state.counter < 3) {
				const step = this.createInputStep({
					title: `${getTitle(this.title, state.subcommand)}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						state.repo.formattedName
					}`,
					placeholder: 'Please provide a stash message',
					value: state.message,
				});

				const value: StepSelection<typeof step> = yield step;

				if (!(await this.canInputStepMoveNext(step, state, value))) {
					break;
				}

				state.message = value;
			}

			if (this.confirm(state.confirm)) {
				const step: QuickPickStep<FlagsQuickPickItem<PushFlags>> = this.createConfirmStep(
					`Confirm ${getTitle(this.title, state.subcommand)}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						state.repo.formattedName
					}`,
					state.uris == null || state.uris.length === 0
						? [
								FlagsQuickPickItem.create<PushFlags>(state.flags, [], {
									label: getTitle(this.title, state.subcommand),
									description: state.message,
									detail: 'Will stash uncommitted changes',
								}),
								FlagsQuickPickItem.create<PushFlags>(state.flags, ['--include-untracked'], {
									label: `${getTitle(this.title, state.subcommand)} & Include Untracked`,
									description: `--include-untracked ${state.message}`,
									detail: 'Will stash uncommitted changes, including untracked files',
								}),
								FlagsQuickPickItem.create<PushFlags>(state.flags, ['--keep-index'], {
									label: `${getTitle(this.title, state.subcommand)} & Keep Staged`,
									description: `--keep-index ${state.message}`,
									detail: 'Will stash uncommitted changes, but will keep staged files intact',
								}),
						  ]
						: [
								FlagsQuickPickItem.create<PushFlags>(state.flags, [], {
									label: getTitle(this.title, state.subcommand),
									description: state.message,
									detail: `Will stash changes in ${
										state.uris.length === 1
											? GitUri.getFormattedPath(state.uris[0], { relativeTo: state.repo.path })
											: `${state.uris.length} files`
									}`,
								}),
								FlagsQuickPickItem.create<PushFlags>(state.flags, ['--keep-index'], {
									label: `${getTitle(this.title, state.subcommand)} & Keep Staged`,
									description: `--keep-index ${state.message}`,
									detail: `Will stash changes in ${
										state.uris.length === 1
											? GitUri.getFormattedPath(state.uris[0], { relativeTo: state.repo.path })
											: `${state.uris.length} files`
									}, but will keep staged files intact`,
								}),
						  ],
					undefined,
					{ placeholder: `Confirm ${getTitle(this.title, state.subcommand)}` },
				);
				const selection: StepSelection<typeof step> = yield step;

				if (!this.canPickStepMoveNext(step, state, selection)) {
					break;
				}

				state.flags = selection[0].item;
			}

			void (await state.repo.stashSave(state.message, state.uris, {
				includeUntracked: state.flags.includes('--include-untracked'),
				keepIndex: state.flags.includes('--keep-index'),
			}));

			throw new BreakQuickCommand();
		}

		return undefined;
	}
}

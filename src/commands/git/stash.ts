import type { QuickPickItem, Uri } from 'vscode';
import { QuickInputButtons, window } from 'vscode';
import { ContextKeys, GlyphChars } from '../../constants';
import type { Container } from '../../container';
import { getContext } from '../../context';
import { reveal, showDetailsView } from '../../git/actions/stash';
import { StashApplyError, StashApplyErrorReason } from '../../git/errors';
import type { GitStashCommit } from '../../git/models/commit';
import type { GitStashReference } from '../../git/models/reference';
import { getReferenceLabel } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { showGenericErrorMessage } from '../../messages';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { formatPath } from '../../system/formatPath';
import { Logger } from '../../system/logger';
import { pad } from '../../system/string';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import { getSteps } from '../gitCommands.utils';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import {
	appendReposToTitle,
	canInputStepContinue,
	canPickStepContinue,
	canStepContinue,
	createInputStep,
	createPickStep,
	endSteps,
	pickRepositoryStep,
	pickStashStep,
	QuickCommand,
	RevealInSideBarQuickInputButton,
	ShowDetailsViewQuickInputButton,
	StepResultBreak,
} from '../quickCommand';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	readonly: boolean;
	title: string;
}

interface ApplyState {
	subcommand: 'apply';
	repo: string | Repository;
	reference: GitStashReference;
}

interface DropState {
	subcommand: 'drop';
	repo: string | Repository;
	reference: GitStashReference;
}

interface ListState {
	subcommand: 'list';
	repo: string | Repository;
	reference: GitStashReference | GitStashCommit;
}

interface PopState {
	subcommand: 'pop';
	repo: string | Repository;
	reference: GitStashReference;
}

type PushFlags = '--include-untracked' | '--keep-index';

interface PushState {
	subcommand: 'push';
	repo: string | Repository;
	message?: string;
	uris?: Uri[];
	flags: PushFlags[];
}

type State = ApplyState | DropState | ListState | PopState | PushState;
type StashStepState<T extends State> = SomeNonNullable<StepState<T>, 'subcommand'>;
type ApplyStepState<T extends ApplyState = ApplyState> = StashStepState<ExcludeSome<T, 'repo', string>>;
type DropStepState<T extends DropState = DropState> = StashStepState<ExcludeSome<T, 'repo', string>>;
type ListStepState<T extends ListState = ListState> = StashStepState<ExcludeSome<T, 'repo', string>>;
type PopStepState<T extends PopState = PopState> = StashStepState<ExcludeSome<T, 'repo', string>>;
type PushStepState<T extends PushState = PushState> = StashStepState<ExcludeSome<T, 'repo', string>>;

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
	confirm?: boolean;
	state?: Partial<State>;
}

export class StashGitCommand extends QuickCommand<State> {
	private subcommand: State['subcommand'] | undefined;

	constructor(container: Container, args?: StashGitCommandArgs) {
		super(container, 'stash', 'stash', 'Stash', {
			description: 'shelves (stashes) local changes to be reapplied later',
		});

		let counter = 0;
		if (args?.state?.subcommand != null) {
			counter++;

			switch (args.state.subcommand) {
				case 'apply':
				case 'drop':
				case 'pop':
					if (args.state.reference != null) {
						counter++;
					}
					break;

				case 'push':
					if (args.state.message != null) {
						counter++;
					}

					break;
			}
		}

		if (args?.state?.repo != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm,
			...args?.state,
		};
	}

	override get canConfirm(): boolean {
		return this.subcommand != null && this.subcommand !== 'list';
	}

	override get canSkipConfirm(): boolean {
		return this.subcommand === 'drop' ? false : super.canSkipConfirm;
	}

	override get skipConfirmKey() {
		return `${this.key}${this.subcommand == null ? '' : `-${this.subcommand}`}:${this.pickedVia}`;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.stashesView,
			readonly:
				getContext<boolean>(ContextKeys.Readonly, false) ||
				getContext<boolean>(ContextKeys.Untrusted, false) ||
				getContext<boolean>(ContextKeys.HasVirtualFolders, false),
			title: this.title,
		};

		let skippedStepTwo = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (context.readonly) {
				state.subcommand = 'list';
			}

			if (state.counter < 1 || state.subcommand == null) {
				this.subcommand = undefined;

				const result = yield* this.pickSubcommandStep(state);
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.subcommand = result;
			}

			this.subcommand = state.subcommand;

			context.title = getTitle(this.title, state.subcommand);

			if (state.counter < 2 || state.repo == null || typeof state.repo === 'string') {
				skippedStepTwo = false;
				if (context.repos.length === 1) {
					skippedStepTwo = true;
					state.counter++;

					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					if (result === StepResultBreak) continue;

					state.repo = result;
				}
			}

			switch (state.subcommand) {
				case 'apply':
				case 'pop':
					yield* this.applyOrPopCommandSteps(state as ApplyStepState | PopStepState, context);
					break;
				case 'drop':
					yield* this.dropCommandSteps(state as DropStepState, context);
					break;
				case 'list':
					yield* this.listCommandSteps(state as ListStepState, context);
					break;
				case 'push':
					yield* this.pushCommandSteps(state as PushStepState, context);
					break;
				default:
					endSteps(state);
					break;
			}

			// If we skipped the previous step, make sure we back up past it
			if (skippedStepTwo) {
				state.counter--;
			}
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *pickSubcommandStep(state: PartialStepState<State>): StepResultGenerator<State['subcommand']> {
		const step = createPickStep<QuickPickItemOfT<State['subcommand']>>({
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
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *applyOrPopCommandSteps(state: ApplyStepState | PopStepState, context: Context): StepGenerator {
		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result: StepResult<GitStashReference> = yield* pickStashStep(state, context, {
					stash: await this.container.git.getStash(state.repo.path),
					placeholder: (context, stash) =>
						stash == null
							? `No stashes found in ${state.repo.formattedName}`
							: 'Choose a stash to apply to your working tree',
					picked: state.reference?.ref,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.reference = result;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.applyOrPopCommandConfirmStep(state, context);
				if (result === StepResultBreak) continue;

				state.subcommand = result;
			}

			endSteps(state);

			try {
				await state.repo.stashApply(
					// pop can only take a stash index, e.g. `stash@{1}`
					state.subcommand === 'pop' ? `stash@{${state.reference.number}}` : state.reference.ref,
					{ deleteAfter: state.subcommand === 'pop' },
				);

				if (state.reference.message) {
					const scmRepository = await this.container.git.getScmRepository(state.repo.path);
					if (scmRepository != null && !scmRepository.inputBox.value) {
						scmRepository.inputBox.value = state.reference.message;
					}
				}
			} catch (ex) {
				Logger.error(ex, context.title);

				if (StashApplyError.is(ex, StashApplyErrorReason.WorkingChanges)) {
					void window.showWarningMessage(
						'Unable to apply stash. Your working tree changes would be overwritten. Please commit or stash your changes before trying again',
					);
				} else {
					void showGenericErrorMessage(ex.message);
				}
			}
		}
	}

	private *applyOrPopCommandConfirmStep(
		state: ApplyStepState | PopStepState,
		context: Context,
	): StepResultGenerator<'apply' | 'pop'> {
		const step = this.createConfirmStep<QuickPickItem & { item: 'apply' | 'pop' }>(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				{
					label: context.title,
					detail:
						state.subcommand === 'pop'
							? `Will delete ${getReferenceLabel(
									state.reference,
							  )} and apply the changes to the working tree`
							: `Will apply the changes from ${getReferenceLabel(state.reference)} to the working tree`,
					item: state.subcommand,
				},
				// Alternate confirmation (if pop then apply, and vice versa)
				{
					label: getTitle(this.title, state.subcommand === 'pop' ? 'apply' : 'pop'),
					detail:
						state.subcommand === 'pop'
							? `Will apply the changes from ${getReferenceLabel(state.reference)} to the working tree`
							: `Will delete ${getReferenceLabel(
									state.reference,
							  )} and apply the changes to the working tree`,
					item: state.subcommand === 'pop' ? 'apply' : 'pop',
				},
			],
			undefined,
			{
				placeholder: `Confirm ${context.title}`,
				additionalButtons: [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton],
				onDidClickButton: (quickpick, button) => {
					if (button === ShowDetailsViewQuickInputButton) {
						void showDetailsView(state.reference, {
							pin: false,
							preserveFocus: true,
						});
					} else if (button === RevealInSideBarQuickInputButton) {
						void reveal(state.reference, {
							select: true,
							expand: true,
						});
					}
				},
			},
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}

	private async *dropCommandSteps(state: DropStepState, context: Context): StepGenerator {
		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result: StepResult<GitStashReference> = yield* pickStashStep(state, context, {
					stash: await this.container.git.getStash(state.repo.path),
					placeholder: (context, stash) =>
						stash == null ? `No stashes found in ${state.repo.formattedName}` : 'Choose a stash to delete',
					picked: state.reference?.ref,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.reference = result;
			}

			const result = yield* this.dropCommandConfirmStep(state, context);
			if (result === StepResultBreak) continue;

			endSteps(state);
			try {
				// drop can only take a stash index, e.g. `stash@{1}`
				await state.repo.stashDelete(`stash@{${state.reference.number}}`, state.reference.ref);
			} catch (ex) {
				Logger.error(ex, context.title);

				void showGenericErrorMessage('Unable to delete stash');

				return;
			}
		}
	}

	private *dropCommandConfirmStep(state: DropStepState, context: Context): StepResultGenerator<void> {
		const step = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				{
					label: context.title,
					detail: `Will delete ${getReferenceLabel(state.reference)}`,
				},
			],
			undefined,
			{
				placeholder: `Confirm ${context.title}`,
				additionalButtons: [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton],
				onDidClickButton: (quickpick, button) => {
					if (button === ShowDetailsViewQuickInputButton) {
						void showDetailsView(state.reference, {
							pin: false,
							preserveFocus: true,
						});
					} else if (button === RevealInSideBarQuickInputButton) {
						void reveal(state.reference, {
							select: true,
							expand: true,
						});
					}
				},
			},
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
	}

	private async *listCommandSteps(state: ListStepState, context: Context): StepGenerator {
		context.title = 'Stashes';

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result: StepResult<GitStashCommit> = yield* pickStashStep(state, context, {
					stash: await this.container.git.getStash(state.repo.path),
					placeholder: (context, stash) =>
						stash == null ? `No stashes found in ${state.repo.formattedName}` : 'Choose a stash',
					picked: state.reference?.ref,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.reference = result;
			}

			const result = yield* getSteps(
				this.container,
				{
					command: 'show',
					state: {
						repo: state.repo,
						reference: state.reference,
					},
				},
				this.pickedVia,
			);
			state.counter--;
			if (result === StepResultBreak) {
				endSteps(state);
			}
		}
	}

	private async *pushCommandSteps(state: PushStepState, context: Context): StepGenerator {
		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.message == null) {
				if (state.message == null) {
					const scmRepository = await this.container.git.getScmRepository(state.repo.path);
					state.message = scmRepository?.inputBox.value;
				}

				const result = yield* this.pushCommandInputMessageStep(state, context);
				// Always break on the first step (so we will go back)
				if (result === StepResultBreak) break;

				state.message = result;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.pushCommandConfirmStep(state, context);
				if (result === StepResultBreak) continue;

				state.flags = result;
			}

			endSteps(state);
			try {
				await state.repo.stashSave(state.message, state.uris, {
					includeUntracked: state.flags.includes('--include-untracked'),
					keepIndex: state.flags.includes('--keep-index'),
				});
			} catch (ex) {
				Logger.error(ex, context.title);

				const msg: string = ex?.message ?? ex?.toString() ?? '';
				if (msg.includes('newer version of Git')) {
					void window.showErrorMessage(`Unable to stash changes. ${msg}`);

					return;
				}

				void showGenericErrorMessage('Unable to stash changes');

				return;
			}
		}
	}

	private async *pushCommandInputMessageStep(
		state: PushStepState,
		context: Context,
	): AsyncStepResultGenerator<string> {
		const step = createInputStep({
			title: appendReposToTitle(
				context.title,
				state,
				context,
				state.uris != null
					? `${pad(GlyphChars.Dot, 2, 2)}${
							state.uris.length === 1
								? formatPath(state.uris[0], { fileOnly: true })
								: `${state.uris.length} files`
					  }`
					: undefined,
			),
			placeholder: 'Please provide a stash message',
			value: state.message,
			prompt: 'Enter stash message',
		});

		const value: StepSelection<typeof step> = yield step;
		if (!canStepContinue(step, state, value) || !(await canInputStepContinue(step, state, value))) {
			return StepResultBreak;
		}

		return value;
	}

	private *pushCommandConfirmStep(state: PushStepState, context: Context): StepResultGenerator<PushFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<PushFlags>> = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			state.uris == null || state.uris.length === 0
				? [
						createFlagsQuickPickItem<PushFlags>(state.flags, [], {
							label: context.title,
							detail: 'Will stash uncommitted changes',
						}),
						createFlagsQuickPickItem<PushFlags>(state.flags, ['--include-untracked'], {
							label: `${context.title} & Include Untracked`,
							description: '--include-untracked',
							detail: 'Will stash uncommitted changes, including untracked files',
						}),
						createFlagsQuickPickItem<PushFlags>(state.flags, ['--keep-index'], {
							label: `${context.title} & Keep Staged`,
							description: '--keep-index',
							detail: 'Will stash uncommitted changes, but will keep staged files intact',
						}),
				  ]
				: [
						createFlagsQuickPickItem<PushFlags>(state.flags, [], {
							label: context.title,
							detail: `Will stash changes from ${
								state.uris.length === 1
									? formatPath(state.uris[0], { fileOnly: true })
									: `${state.uris.length} files`
							}`,
						}),
						createFlagsQuickPickItem<PushFlags>(state.flags, ['--keep-index'], {
							label: `${context.title} & Keep Staged`,
							detail: `Will stash changes from ${
								state.uris.length === 1
									? formatPath(state.uris[0], { fileOnly: true })
									: `${state.uris.length} files`
							}, but will keep staged files intact`,
						}),
				  ],
			undefined,
			{ placeholder: `Confirm ${context.title}` },
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

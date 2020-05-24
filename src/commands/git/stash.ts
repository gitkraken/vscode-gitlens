'use strict';
import { QuickInputButtons, QuickPickItem, Uri, window } from 'vscode';
import { Container } from '../../container';
import { GitReference, GitStashCommit, GitStashReference, Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { GitCommandsCommand } from '../gitCommands';
import {
	appendReposToTitle,
	PartialStepState,
	pickRepositoryStep,
	pickStashStep,
	QuickCommand,
	QuickCommandButtons,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { FlagsQuickPickItem, QuickPickItemOfT } from '../../quickpicks';
import { Logger } from '../../logger';
import { Messages } from '../../messages';

interface Context {
	repos: Repository[];
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
	reference: /*GitStashReference |*/ GitStashCommit;
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

	constructor(args?: StashGitCommandArgs) {
		super('stash', 'stash', 'Stash', {
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

	get canConfirm(): boolean {
		return this.subcommand != null && this.subcommand !== 'list';
	}

	get canSkipConfirm(): boolean {
		return this.subcommand === 'drop' ? false : super.canSkipConfirm;
	}

	get skipConfirmKey() {
		return `${this.key}${this.subcommand == null ? '' : `-${this.subcommand}`}:${this.pickedVia}`;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
			title: this.title,
		};

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.subcommand == null) {
				this.subcommand = undefined;

				const result = yield* this.pickSubcommandStep(state);
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.subcommand = result;
			}

			this.subcommand = state.subcommand;

			context.title = getTitle(this.title, state.subcommand);

			if (state.counter < 2 || state.repo == null || typeof state.repo === 'string') {
				if (context.repos.length === 1) {
					if (state.repo == null) {
						state.counter++;
					}
					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					if (result === StepResult.Break) continue;

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
					QuickCommand.endSteps(state);
					break;
			}

			// If we skipped the previous step, make sure we back up past it
			if (context.repos.length === 1) {
				state.counter--;
			}
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private *pickSubcommandStep(state: PartialStepState<State>): StepResultGenerator<State['subcommand']> {
		const step = QuickCommand.createPickStep<QuickPickItemOfT<State['subcommand']>>({
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
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}

	private async *applyOrPopCommandSteps(state: ApplyStepState | PopStepState, context: Context): StepGenerator {
		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result: StepResult<GitStashReference> = yield* pickStashStep(state, context, {
					stash: await Container.git.getStashList(state.repo.path),
					placeholder: (context, stash) =>
						stash == null
							? `No stashes found in ${state.repo.formattedName}`
							: 'Choose a stash to apply to your working tree',
					picked: state.reference?.ref,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.reference = result;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.applyOrPopCommandConfirmStep(state, context);
				if (result === StepResult.Break) continue;

				state.subcommand = result;
			}

			QuickCommand.endSteps(state);
			try {
				void (await state.repo.stashApply(
					// pop can only take a stash index, e.g. `stash@{1}`
					state.subcommand === 'pop' ? `stash@{${state.reference.number}}` : state.reference.ref,
					{ deleteAfter: state.subcommand === 'pop' },
				));
			} catch (ex) {
				Logger.error(ex, context.title);

				const msg: string = ex?.message ?? '';
				if (msg.includes('Your local changes to the following files would be overwritten by merge')) {
					void window.showWarningMessage(
						'Unable to apply stash. Your working tree changes would be overwritten. Please commit or stash your changes before trying again',
					);

					return;
				}

				if (
					(msg.includes('Auto-merging') && msg.includes('CONFLICT')) ||
					// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
					(ex?.stdout?.includes('Auto-merging') && ex?.stdout?.includes('CONFLICT')) ||
					// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
					ex?.stdout?.includes('needs merge')
				) {
					void window.showInformationMessage('Stash applied with conflicts');

					return;
				}

				void Messages.showGenericErrorMessage(
					`Unable to apply stash \u2014 ${msg.trim().replace(/\n+?/g, '; ')}`,
				);

				return;
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
							? `Will delete ${GitReference.toString(
									state.reference,
							  )} and apply the changes to the working tree`
							: `Will apply the changes from ${GitReference.toString(
									state.reference,
							  )} to the working tree`,
					item: state.subcommand,
				},
				// Alternate confirmation (if pop then apply, and vice versa)
				{
					label: getTitle(this.title, state.subcommand === 'pop' ? 'apply' : 'pop'),
					detail:
						state.subcommand === 'pop'
							? `Will apply the changes from ${GitReference.toString(
									state.reference,
							  )} to the working tree`
							: `Will delete ${GitReference.toString(
									state.reference,
							  )} and apply the changes to the working tree`,
					item: state.subcommand === 'pop' ? 'apply' : 'pop',
				},
			],
			undefined,
			{
				placeholder: `Confirm ${context.title}`,
				additionalButtons: [QuickCommandButtons.RevealInView],
				onDidClickButton: (quickpick, button) => {
					if (button === QuickCommandButtons.RevealInView) {
						void Container.repositoriesView.revealStash(state.reference, {
							select: true,
							expand: true,
						});
					}
				},
			},
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}

	private async *dropCommandSteps(state: DropStepState, context: Context): StepGenerator {
		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result: StepResult<GitStashReference> = yield* pickStashStep(state, context, {
					stash: await Container.git.getStashList(state.repo.path),
					placeholder: (context, stash) =>
						stash == null ? `No stashes found in ${state.repo.formattedName}` : 'Choose a stash to delete',
					picked: state.reference?.ref,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.reference = result;
			}

			const result = yield* this.dropCommandConfirmStep(state, context);
			if (result === StepResult.Break) continue;

			try {
				void (await state.repo.stashDelete(`stash@{${state.reference.ref}}`));
			} catch (ex) {
				Logger.error(ex, context.title);

				void Messages.showGenericErrorMessage('Unable to delete stash');

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
					detail: `Will delete ${GitReference.toString(state.reference)}`,
				},
			],
			undefined,
			{
				placeholder: `Confirm ${context.title}`,
				additionalButtons: [QuickCommandButtons.RevealInView],
				onDidClickButton: (quickpick, button) => {
					if (button === QuickCommandButtons.RevealInView) {
						void Container.repositoriesView.revealStash(state.reference, {
							select: true,
							expand: true,
						});
					}
				},
			},
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? undefined : StepResult.Break;
	}

	private async *listCommandSteps(state: ListStepState, context: Context): StepGenerator {
		context.title = 'Stashes';

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result: StepResult<GitStashCommit> = yield* pickStashStep(state, context, {
					stash: await Container.git.getStashList(state.repo.path),
					placeholder: (context, stash) =>
						stash == null ? `No stashes found in ${state.repo.formattedName}` : 'Choose a stash',
					picked: state.reference?.ref,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.reference = result;
			}

			// if (!(state.reference instanceof GitStashCommit)) {
			// 	state.reference = await Container.git.getCommit(state.repo.path, state.reference.ref);
			// }

			const result = yield* GitCommandsCommand.getSteps(
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
			if (result === StepResult.Break) {
				QuickCommand.endSteps(state);
			}
		}
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	private async *pushCommandSteps(state: PushStepState, context: Context): StepGenerator {
		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.message == null) {
				const result = yield* this.pushCommandInputMessageStep(state, context);
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.message = result;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.pushCommandConfirmStep(state, context);
				if (result === StepResult.Break) continue;

				state.flags = result;
			}

			QuickCommand.endSteps(state);
			try {
				void (await state.repo.stashSave(state.message, state.uris, {
					includeUntracked: state.flags.includes('--include-untracked'),
					keepIndex: state.flags.includes('--keep-index'),
				}));
			} catch (ex) {
				Logger.error(ex, context.title);

				const msg: string = ex?.toString() ?? '';
				if (msg.includes('newer version of Git')) {
					void window.showErrorMessage(`Unable to stash changes. ${msg}`);

					return;
				}

				void Messages.showGenericErrorMessage('Unable to stash changes');

				return;
			}
		}
	}

	private async *pushCommandInputMessageStep(state: PushStepState, context: Context): StepResultGenerator<string> {
		const step = QuickCommand.createInputStep({
			title: appendReposToTitle(context.title, state, context),
			placeholder: 'Please provide a stash message',
			value: state.message,
			prompt: 'Enter stash message',
		});

		const value: StepSelection<typeof step> = yield step;
		if (
			!QuickCommand.canStepContinue(step, state, value) ||
			!(await QuickCommand.canInputStepContinue(step, state, value))
		) {
			return StepResult.Break;
		}

		return value;
	}

	private *pushCommandConfirmStep(state: PushStepState, context: Context): StepResultGenerator<PushFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<PushFlags>> = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			state.uris == null || state.uris.length === 0
				? [
						FlagsQuickPickItem.create<PushFlags>(state.flags, [], {
							label: context.title,
							detail: 'Will stash uncommitted changes',
						}),
						FlagsQuickPickItem.create<PushFlags>(state.flags, ['--include-untracked'], {
							label: `${context.title} & Include Untracked`,
							description: '--include-untracked',
							detail: 'Will stash uncommitted changes, including untracked files',
						}),
						FlagsQuickPickItem.create<PushFlags>(state.flags, ['--keep-index'], {
							label: `${context.title} & Keep Staged`,
							description: '--keep-index',
							detail: 'Will stash uncommitted changes, but will keep staged files intact',
						}),
				  ]
				: [
						FlagsQuickPickItem.create<PushFlags>(state.flags, [], {
							label: context.title,
							detail: `Will stash changes in ${
								state.uris.length === 1
									? GitUri.getFormattedPath(state.uris[0], { relativeTo: state.repo.path })
									: `${state.uris.length} files`
							}`,
						}),
						FlagsQuickPickItem.create<PushFlags>(state.flags, ['--keep-index'], {
							label: `${context.title} & Keep Staged`,
							detail: `Will stash changes in ${
								state.uris.length === 1
									? GitUri.getFormattedPath(state.uris[0], { relativeTo: state.repo.path })
									: `${state.uris.length} files`
							}, but will keep staged files intact`,
						}),
				  ],
			undefined,
			{ placeholder: `Confirm ${context.title}` },
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}

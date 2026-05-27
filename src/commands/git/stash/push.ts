import type { Uri } from 'vscode';
import { InputBoxValidationSeverity, QuickInputButtons, window } from 'vscode';
import type { AIModel } from '@gitlens/ai/models/model.js';
import { StashPushError } from '@gitlens/git/errors.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { getLoggableName, Logger } from '@gitlens/utils/logger.js';
import { maybeStartScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { defer } from '@gitlens/utils/promise.js';
import { pad } from '@gitlens/utils/string.js';
import { GlyphChars } from '../../../constants.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { showGitErrorMessage } from '../../../messages.js';
import type { FlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { formatPath } from '../../../system/-webview/formatPath.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../../quick-wizard/models/steps.js';
import { StepResultBreak } from '../../quick-wizard/models/steps.js';
import { GenerateStashMessageQuickInputButton } from '../../quick-wizard/quickButtons.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canInputStepContinue,
	canPickStepContinue,
	canStepContinue,
	createInputStep,
} from '../../quick-wizard/utils/steps.utils.js';
import type { StashContext } from '../stash.js';

const Steps = {
	PickRepo: 'stash-push-pick-repo',
	InputMessage: 'stash-push-input-message',
	Confirm: 'stash-push-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type StashPushStepNames = StepNames;

type Context = StashContext<StepNames>;

type Flags = '--include-untracked' | '--keep-index' | '--staged' | '--snapshot';
interface State<Repo = string | GlRepository> {
	repo: Repo;
	message?: string;
	uris?: Uri[];
	onlyStagedUris?: Uri[];
	flags: Flags[];
	reducedConfirm?: boolean;
}
export type StashPushState = State;

export interface StashPushGitCommandArgs {
	readonly command: 'stash-push';
	confirm?: boolean;
	state?: Partial<State>;
}

export class StashPushGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: StashPushGitCommandArgs) {
		super(container, 'stash-push', 'push', 'Push Stash', {
			description: 'stashes local changes',
		});

		this.initialState = { confirm: args?.confirm, flags: [], ...args?.state };
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.stashes,
			readonly: false,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		state.flags ??= [];
		let confirmOverride;

		while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepo) || state.repo == null || typeof state.repo === 'string') {
				// Only show the picker if there are multiple repositories
				if (context.repos.length === 1) {
					[state.repo] = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepo);

					const result = yield* pickRepositoryStep(state, context, step);
					if (result === StepResultBreak) {
						state.repo = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repo = result;
				}
			}

			assertStepState<State<GlRepository>>(state);

			// Skip if the user navigated back to InputMessage — otherwise confirmOverride would trap them in Confirm
			if (!steps.isAtStep(Steps.InputMessage) && this.confirm(confirmOverride ?? state.confirm)) {
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) {
					state.flags = [];
					if (step.goBack() == null) break;
					continue;
				}

				state.flags = result;
			}

			if (steps.isAtStep(Steps.InputMessage) || state.message == null) {
				using step = steps.enterStep(Steps.InputMessage);

				if (state.message == null) {
					const scmRepo = await state.repo.git.getScmRepository();
					state.message = scmRepo?.inputBox.value;
				}

				const result = yield* this.inputMessageStep(state, context);
				if (result === StepResultBreak) {
					state.message = undefined;
					if (step.goBack() == null) break;
					continue;
				}

				state.message = result;
			}

			try {
				if (state.flags.includes('--snapshot')) {
					await state.repo.git.stash?.saveSnapshot(state.message);
				} else {
					await state.repo.git.stash?.saveStash(state.message, state.uris, {
						includeUntracked: state.flags.includes('--include-untracked'),
						keepIndex: state.flags.includes('--keep-index'),
						onlyStaged: state.flags.includes('--staged'),
					});
				}

				steps.markStepsComplete();
			} catch (ex) {
				Logger.error(ex, context.title);

				if (StashPushError.is(ex, 'nothingToSave')) {
					if (!state.flags.includes('--include-untracked') && !state.reducedConfirm) {
						confirmOverride = true;
						void window.showWarningMessage(
							'No changes to stash. Choose the "Push & Include Untracked" option, if you have untracked files.',
						);
						continue;
					}

					void window.showInformationMessage('No changes to stash.');
					return;
				}

				if (StashPushError.is(ex, 'conflictingStagedAndUnstagedLines') && state.flags.includes('--staged')) {
					const confirm = { title: 'Stash Everything' };
					const cancel = { title: 'Cancel', isCloseAffordance: true };
					const result = await window.showErrorMessage(
						`Changes were stashed, but the working tree cannot be updated because at least one file has staged and unstaged changes on the same line(s)\n\nDo you want to try again by stashing both your staged and unstaged changes?`,
						{ modal: true },
						confirm,
						cancel,
					);

					if (result === confirm) {
						state.uris ??= state.onlyStagedUris;
						state.flags.splice(state.flags.indexOf('--staged'), 1);
						continue;
					}

					return;
				}

				const msg: string = ex?.message ?? ex?.toString() ?? '';
				if (msg.includes('newer version of Git')) {
					void window.showErrorMessage(`Unable to stash changes. ${msg}`);
					return;
				}

				void showGitErrorMessage(ex, StashPushError.is(ex) ? undefined : 'Unable to stash changes');
				return;
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async *inputMessageStep(
		state: StepState<State<GlRepository>>,
		context: Context,
	): AsyncStepResultGenerator<string> {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.inputMessageStep`);

		const annotations: string[] = [];
		if (state.uris != null) {
			annotations.push(
				state.uris.length === 1 ? formatPath(state.uris[0], { fileOnly: true }) : `${state.uris.length} files`,
			);
		}

		let scopeLabel: string | undefined;
		if (state.flags.includes('--snapshot')) {
			scopeLabel = 'Snapshot';
		} else if (state.flags.includes('--staged')) {
			scopeLabel = 'Staged';
		} else if (state.flags.includes('--keep-index')) {
			scopeLabel = 'Keep Staged';
		}
		if (scopeLabel != null) {
			annotations.push(scopeLabel);
		}
		if (state.flags.includes('--include-untracked')) {
			annotations.push('Include Untracked');
		}

		const annotation = annotations.length
			? annotations.map(a => `${pad(GlyphChars.Dot, 2, 2)}${a}`).join('')
			: undefined;

		const step = createInputStep({
			title: appendReposToTitle(context.title, state, context, annotation),
			placeholder: 'Stash message',
			value: state.message,
			prompt: 'Please provide a stash message',
			buttons:
				this.container.ai.enabled && this.container.ai.allowed
					? [QuickInputButtons.Back, GenerateStashMessageQuickInputButton]
					: [QuickInputButtons.Back],
			validate: (_value: string | undefined): [boolean, string | undefined] => [true, undefined],
			onDidClickButton: async (input, button) => {
				if (button === GenerateStashMessageQuickInputButton) {
					using resume = step.freeze?.();

					try {
						const uris = state.uris?.length ? { uris: state.uris } : undefined;

						let contents: string | undefined;
						if (state.flags.includes('--staged')) {
							const diff = await state.repo.git.diff.getDiff?.(uncommittedStaged, undefined, uris);
							contents = diff?.contents;
						} else {
							// `git stash push` (without --staged) captures both staged and unstaged tracked changes
							const [stagedDiff, unstagedDiff] = await Promise.all([
								state.repo.git.diff.getDiff?.(uncommittedStaged, undefined, uris),
								state.repo.git.diff.getDiff?.(uncommitted, undefined, uris),
							]);
							const parts: string[] = [];
							if (stagedDiff?.contents) {
								parts.push(stagedDiff.contents);
							}
							if (unstagedDiff?.contents) {
								parts.push(unstagedDiff.contents);
							}
							contents = parts.length ? parts.join('\n') : undefined;
						}

						if (!contents) {
							void window.showInformationMessage('No changes to generate a stash message from.');
							return;
						}

						const generating = defer<AIModel>();
						generating.promise.then(
							m =>
								(input.validationMessage = {
									severity: InputBoxValidationSeverity.Info,
									message: `$(loading~spin) Generating stash message with ${m.name}...`,
								}),
							() => (input.validationMessage = undefined),
						);

						const result = await this.container.ai.actions.generateStashMessage(
							contents,
							{ source: 'quick-wizard' },
							{ generating: generating },
						);

						resume?.dispose();
						input.validationMessage = undefined;

						if (result === 'cancelled') return;

						const message = result?.result.summary;
						if (message != null) {
							state.message = message;
							input.value = message;
						}
					} catch (ex) {
						scope?.error(ex, 'generateStashMessage');

						input.validationMessage = {
							severity: InputBoxValidationSeverity.Error,
							message: ex.message,
						};
					}
				}
			},
		});
		const value: StepSelection<typeof step> = yield step;
		if (!canStepContinue(step, state, value) || !(await canInputStepContinue(step, state, value))) {
			return StepResultBreak;
		}
		return value;
	}

	private *confirmStep(state: StepState<State<GlRepository>>, context: Context): StepResultGenerator<Flags[]> {
		const stagedOnly = state.flags.includes('--staged');

		const baseFlags: Flags[] = [];
		if (stagedOnly) {
			baseFlags.push('--staged');
		}

		type StepType = FlagsQuickPickItem<Flags>;

		const confirmations: StepType[] = [];
		// Show confirmation options with the pre-determined flags (e.g. from the "Stash Unstaged" SCM action)
		if (state.reducedConfirm) {
			if (state.flags.includes('--include-untracked')) {
				const withUntrackedFlags = [...state.flags];
				const withoutUntrackedFlags = state.flags.filter(f => f !== '--include-untracked');

				const withUntrackedDescFlags = withUntrackedFlags.filter(f => f !== '--snapshot');
				const withUntrackedDetails: string[] = [];
				if (state.flags.includes('--keep-index')) {
					withUntrackedDetails.push('keeping staged files intact');
				}
				withUntrackedDetails.push('including untracked files');

				const withoutUntrackedDescFlags = withoutUntrackedFlags.filter(f => f !== '--snapshot');
				const withoutUntrackedDetails: string[] = [];
				if (state.flags.includes('--keep-index')) {
					withoutUntrackedDetails.push('keeping staged files intact');
				}

				confirmations.push(
					createFlagsQuickPickItem<Flags>(state.flags, withUntrackedFlags, {
						label: `${context.title} & Include Untracked`,
						description: withUntrackedDescFlags.length ? withUntrackedDescFlags.join(' ') : undefined,
						detail: `Will stash unstaged changes${withUntrackedDetails.length ? `, ${withUntrackedDetails.join(' and ')}` : ''}`,
					}),
					createFlagsQuickPickItem<Flags>(state.flags, withoutUntrackedFlags, {
						label: context.title,
						description: withoutUntrackedDescFlags.length ? withoutUntrackedDescFlags.join(' ') : undefined,
						detail: `Will stash unstaged changes${withoutUntrackedDetails.length ? `, ${withoutUntrackedDetails.join(' and ')}` : ''}`,
					}),
				);
			} else {
				const descriptionFlags = state.flags.filter(f => f !== '--snapshot');
				const details: string[] = [];
				if (state.flags.includes('--keep-index')) {
					details.push('keeping staged files intact');
				}

				confirmations.push(
					createFlagsQuickPickItem<Flags>(state.flags, [...state.flags], {
						label: context.title,
						description: descriptionFlags.length ? descriptionFlags.join(' ') : undefined,
						detail: `Will stash unstaged changes${details.length ? `, ${details.join(' and ')}` : ''}`,
					}),
				);
			}
		} else if (state.uris?.length) {
			if (state.flags.includes('--include-untracked')) {
				baseFlags.push('--include-untracked');
			}

			confirmations.push(
				createFlagsQuickPickItem<Flags>(state.flags, [...baseFlags], {
					label: context.title,
					detail: `Will stash changes from ${
						state.uris.length === 1
							? formatPath(state.uris[0], { fileOnly: true })
							: `${state.uris.length} files`
					}`,
				}),
			);
			if (!state.flags.includes('--include-untracked')) {
				confirmations.push(
					createFlagsQuickPickItem<Flags>(state.flags, [...baseFlags, '--keep-index'], {
						label: `${context.title} & Keep Staged`,
						detail: `Will stash changes from ${
							state.uris.length === 1
								? formatPath(state.uris[0], { fileOnly: true })
								: `${state.uris.length} files`
						}, but will keep staged files intact`,
					}),
				);
			}
		} else {
			confirmations.push(
				createFlagsQuickPickItem<Flags>(state.flags, [...baseFlags], {
					label: context.title,
					detail: `Will stash ${stagedOnly ? 'staged' : 'uncommitted'} changes`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, [...baseFlags, '--snapshot'], {
					label: `${context.title} Snapshot`,
					detail: 'Will stash uncommitted changes without changing the working tree',
				}),
			);
			if (!stagedOnly) {
				confirmations.push(
					createFlagsQuickPickItem<Flags>(state.flags, [...baseFlags, '--include-untracked'], {
						label: `${context.title} & Include Untracked`,
						description: '--include-untracked',
						detail: 'Will stash uncommitted changes, including untracked files',
					}),
				);
				confirmations.push(
					createFlagsQuickPickItem<Flags>(state.flags, [...baseFlags, '--keep-index'], {
						label: `${context.title} & Keep Staged`,
						description: '--keep-index',
						detail: `Will stash ${stagedOnly ? 'staged' : 'uncommitted'} changes, but will keep staged files intact`,
					}),
				);
			}
		}

		const step = this.createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			confirmations,
			undefined,
			{ placeholder: `Confirm ${context.title}` },
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

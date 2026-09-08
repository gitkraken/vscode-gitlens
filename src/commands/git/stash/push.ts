import type { Uri } from 'vscode';
import { InputBoxValidationSeverity, l10n, QuickInputButtons, window } from 'vscode';
import type { AIModel } from '@gitlens/ai/models/model.js';
import { StashPushError } from '@gitlens/git/errors.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { getNumericFormat } from '@gitlens/utils/date.js';
import { getLoggableName, Logger } from '@gitlens/utils/logger.js';
import { maybeStartScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { defer } from '@gitlens/utils/promise.js';
import { pad, truncate } from '@gitlens/utils/string.js';
import { GlyphChars } from '../../../constants.js';
import type { Container } from '../../../container.js';
import { getPresentableErrorMessage } from '../../../errors.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { showGitErrorMessage } from '../../../messages.js';
import { createQuickPickSeparator } from '../../../quickpicks/items/common.js';
import type { ConfirmToggleQuickPickItem, DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { createConfirmToggleQuickPickItem } from '../../../quickpicks/items/directive.js';
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
import type { QuickPickStep } from '../../quick-wizard/models/steps.quickpick.js';
import { GenerateStashMessageQuickInputButton } from '../../quick-wizard/quickButtons.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { canSkipRepositoryPick, pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canInputStepContinue,
	canPickStepContinue,
	canStepContinue,
	confirmOptionsSeparatorLabel,
	createInputStep,
	refreshConfirmStepItems,
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
		super(container, 'stash-push', 'push', l10n.t('Push Stash'), {
			description: l10n.t('stashes local changes'),
		});

		this.initialState = { confirm: args?.confirm, flags: [], ...args?.state };
	}

	protected override get supportsSkipConfirmToggle(): boolean {
		return true;
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
				// Skip the picker only when the sole available repo is the one requested
				if (canSkipRepositoryPick(context.repos, state.repo)) {
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

			if (steps.isAtStep(Steps.InputMessage) || state.message == null) {
				using step = steps.enterStep(Steps.InputMessage);

				if (state.message == null) {
					// Prefer the graph's WIP commit-box draft for this repo (persisted in `graph:wipDrafts`),
					// then fall back to the SCM commit input box. Covers stashing from the graph and everywhere else.
					const wipMessage =
						this.container.storage.getWorkspace('graph:wipDrafts')?.[state.repo.path]?.message;
					state.message = wipMessage || (await state.repo.git.getScmRepository())?.inputBox.value;
				}

				const result = yield* this.inputMessageStep(state, context);
				if (result === StepResultBreak) {
					state.message = undefined;
					if (step.goBack() == null) break;
					continue;
				}

				state.message = result;
			}

			if (this.confirm(confirmOverride ?? state.confirm)) {
				using step = steps.enterStep(Steps.Confirm);

				const result = yield* this.confirmStep(state, context);
				if (result === StepResultBreak) {
					state.flags = [];
					if (step.goBack() == null) break;
					continue;
				}

				state.flags = result;
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
				Logger.error(ex, 'Push Stash');

				if (StashPushError.is(ex, 'nothingToSave')) {
					if (!state.flags.includes('--include-untracked') && !state.reducedConfirm) {
						confirmOverride = true;
						void window.showWarningMessage(
							l10n.t(
								'No changes to stash. Choose the "Push & Include Untracked" option, if you have untracked files.',
							),
						);
						continue;
					}

					void window.showInformationMessage(l10n.t('No changes to stash.'));
					return;
				}

				if (StashPushError.is(ex, 'conflictingStagedAndUnstagedLines') && state.flags.includes('--staged')) {
					const confirm = { title: l10n.t('Stash Everything') };
					const cancel = { title: l10n.t('Cancel'), isCloseAffordance: true };
					const result = await window.showErrorMessage(
						l10n.t(
							'Changes were stashed, but the working tree cannot be updated because at least one file has staged and unstaged changes on the same line(s)\n\nDo you want to try again by stashing both your staged and unstaged changes?',
						),
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

				// oxlint-disable-next-line @gitlens/no-raw-error-message -- classification only; the notification below uses getPresentableErrorMessage
				const msg: string = ex?.message ?? ex?.toString() ?? '';
				if (msg.includes('newer version of Git')) {
					void window.showErrorMessage(
						l10n.t('Unable to stash changes. {0}', getPresentableErrorMessage(ex)),
					);
					return;
				}

				void showGitErrorMessage(ex, StashPushError.is(ex) ? undefined : l10n.t('Unable to stash changes'));
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
				state.uris.length === 1
					? formatPath(state.uris[0], { fileOnly: true })
					: l10n.t('{0} files', getNumericFormat()(state.uris.length)),
			);
		}

		let scopeLabel: string | undefined;
		if (state.flags.includes('--snapshot')) {
			scopeLabel = l10n.t('Snapshot');
		} else if (state.flags.includes('--staged')) {
			scopeLabel = l10n.t('Staged');
		} else if (state.flags.includes('--keep-index')) {
			scopeLabel = l10n.t('Keep Staged');
		}
		if (scopeLabel != null) {
			annotations.push(scopeLabel);
		}
		if (state.flags.includes('--include-untracked')) {
			annotations.push(l10n.t('Include Untracked'));
		}

		const annotation = annotations.length
			? annotations.map(a => `${pad(GlyphChars.Dot, 2, 2)}${a}`).join('')
			: undefined;

		const step = createInputStep({
			title: appendReposToTitle(context.title, state, context, annotation),
			placeholder: l10n.t('Stash message'),
			value: state.message,
			prompt: l10n.t('Please provide a stash message'),
			buttons: this.container.ai.allowed
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
							void window.showInformationMessage(l10n.t('No changes to generate a stash message from.'));
							return;
						}

						const generating = defer<AIModel>();
						generating.promise.then(
							m =>
								(input.validationMessage = {
									severity: InputBoxValidationSeverity.Info,
									message: l10n.t('$(loading~spin) Generating stash message with {0}...', m.name),
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
							message: getPresentableErrorMessage(ex),
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

		type StepItem = FlagsQuickPickItem<Flags> | DirectiveQuickPickItem;

		let step: QuickPickStep<StepItem>;
		let rows: StepItem[];

		// Show confirmation options with the pre-determined flags (e.g. from the "Stash Unstaged" SCM action)
		if (state.reducedConfirm) {
			const confirmations: FlagsQuickPickItem<Flags>[] = [];
			if (state.flags.includes('--include-untracked')) {
				const withUntrackedFlags = [...state.flags];
				const withoutUntrackedFlags = state.flags.filter(f => f !== '--include-untracked');

				const withUntrackedDescFlags = withUntrackedFlags.filter(f => f !== '--snapshot');
				const withoutUntrackedDescFlags = withoutUntrackedFlags.filter(f => f !== '--snapshot');
				const keepStaged = state.flags.includes('--keep-index');

				confirmations.push(
					createFlagsQuickPickItem<Flags>(state.flags, withUntrackedFlags, {
						label: l10n.t('Push Stash & Include Untracked'),
						description: withUntrackedDescFlags.length ? withUntrackedDescFlags.join(' ') : undefined,
						detail: keepStaged
							? l10n.t(
									'Will stash unstaged changes, keeping staged files intact and including untracked files',
								)
							: l10n.t('Will stash unstaged changes, including untracked files'),
					}),
					createFlagsQuickPickItem<Flags>(state.flags, withoutUntrackedFlags, {
						label: context.title,
						description: withoutUntrackedDescFlags.length ? withoutUntrackedDescFlags.join(' ') : undefined,
						detail: keepStaged
							? l10n.t('Will stash unstaged changes, keeping staged files intact')
							: l10n.t('Will stash unstaged changes'),
					}),
				);
			} else {
				const descriptionFlags = state.flags.filter(f => f !== '--snapshot');

				confirmations.push(
					createFlagsQuickPickItem<Flags>(state.flags, [...state.flags], {
						label: context.title,
						description: descriptionFlags.length ? descriptionFlags.join(' ') : undefined,
						detail: state.flags.includes('--keep-index')
							? l10n.t('Will stash unstaged changes, keeping staged files intact')
							: l10n.t('Will stash unstaged changes'),
					}),
				);
			}
			rows = confirmations;
		} else if (state.uris?.length) {
			const confirmations: FlagsQuickPickItem<Flags>[] = [];
			if (state.flags.includes('--include-untracked')) {
				baseFlags.push('--include-untracked');
			}

			confirmations.push(
				createFlagsQuickPickItem<Flags>(state.flags, [...baseFlags], {
					label: context.title,
					detail:
						state.uris.length === 1
							? l10n.t('Will stash changes from {0}', formatPath(state.uris[0], { fileOnly: true }))
							: l10n.t('Will stash changes from {0} files', getNumericFormat()(state.uris.length)),
				}),
			);
			if (!state.flags.includes('--include-untracked')) {
				confirmations.push(
					createFlagsQuickPickItem<Flags>(state.flags, [...baseFlags, '--keep-index'], {
						label: l10n.t('Push Stash & Keep Staged'),
						detail:
							state.uris.length === 1
								? l10n.t(
										'Will stash changes from {0}, but will keep staged files intact',
										formatPath(state.uris[0], { fileOnly: true }),
									)
								: l10n.t(
										'Will stash changes from {0} files, but will keep staged files intact',
										getNumericFormat()(state.uris.length),
									),
					}),
				);
			}
			rows = confirmations;
		} else {
			let keepStaged = state.flags.includes('--keep-index');
			const message = state.message ? truncate(state.message, 50) : undefined;

			const getStashChangesDetail = (): string => {
				if (stagedOnly) {
					if (message != null) {
						return keepStaged
							? l10n.t(
									'Will stash staged changes with message "{0}", keeping staged changes in the working tree',
									message,
								)
							: l10n.t('Will stash staged changes with message "{0}"', message);
					}

					return keepStaged
						? l10n.t('Will stash staged changes, keeping staged changes in the working tree')
						: l10n.t('Will stash staged changes');
				}

				if (message != null) {
					return keepStaged
						? l10n.t(
								'Will stash uncommitted changes with message "{0}", keeping staged changes in the working tree',
								message,
							)
						: l10n.t('Will stash uncommitted changes with message "{0}"', message);
				}

				return keepStaged
					? l10n.t('Will stash uncommitted changes, keeping staged changes in the working tree')
					: l10n.t('Will stash uncommitted changes');
			};

			const getStashUntrackedChangesDetail = (): string => {
				if (message != null) {
					return keepStaged
						? l10n.t(
								'Will stash uncommitted changes with message "{0}", including untracked files, keeping staged changes in the working tree',
								message,
							)
						: l10n.t(
								'Will stash uncommitted changes with message "{0}", including untracked files',
								message,
							);
				}

				return keepStaged
					? l10n.t(
							'Will stash uncommitted changes, including untracked files, keeping staged changes in the working tree',
						)
					: l10n.t('Will stash uncommitted changes, including untracked files');
			};

			// Folds the live Keep Staged toggle value into each mode's flags and detail — the accepted item's
			// flags are the whole contract with `execute()` — so the list says what will actually happen.
			const buildItems = (): FlagsQuickPickItem<Flags>[] => {
				const items: FlagsQuickPickItem<Flags>[] = [
					createFlagsQuickPickItem<Flags>(
						state.flags,
						keepStaged ? [...baseFlags, '--keep-index'] : [...baseFlags],
						{
							label: l10n.t('Stash Changes'),
							detail: getStashChangesDetail(),
							picked: !state.flags.includes('--snapshot') && !state.flags.includes('--include-untracked'),
						},
					),
				];

				if (!stagedOnly) {
					items.push(
						createFlagsQuickPickItem<Flags>(
							state.flags,
							keepStaged
								? [...baseFlags, '--include-untracked', '--keep-index']
								: [...baseFlags, '--include-untracked'],
							{
								label: l10n.t('Stash Changes & Untracked'),
								description: '--include-untracked',
								detail: getStashUntrackedChangesDetail(),
								picked: state.flags.includes('--include-untracked'),
							},
						),
					);
				}

				items.push(
					createFlagsQuickPickItem<Flags>(state.flags, [...baseFlags, '--snapshot'], {
						label: l10n.t('Stash Snapshot'),
						description: keepStaged ? l10n.t('· not affected — the working tree is untouched') : undefined,
						detail: l10n.t('Will stash uncommitted changes without changing the working tree'),
					}),
				);

				return items;
			};

			let items = buildItems();

			/** Every row the confirm step shows, minus the separator + Cancel that `createConfirmStep` appends. */
			const buildRows = (toggle?: ConfirmToggleQuickPickItem): StepItem[] =>
				toggle != null ? [...items, createQuickPickSeparator(confirmOptionsSeparatorLabel), toggle] : items;

			if (stagedOnly) {
				rows = buildRows();
			} else {
				const keepStagedToggle = createConfirmToggleQuickPickItem({
					label: l10n.t('Keep Staged'),
					description: '--keep-index',
					detail: l10n.t('Leave already-staged changes in the working tree'),
					checked: keepStaged,
					onDidChange: item => {
						keepStaged = item.checked;
						items = buildItems();
						refreshConfirmStepItems(step, buildRows(item));
					},
				});
				rows = buildRows(keepStagedToggle);
			}
		}

		const confirmTitle = l10n.t('Confirm Push Stash');
		step = this.createConfirmStep(appendReposToTitle(confirmTitle, state, context), rows, confirmTitle);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

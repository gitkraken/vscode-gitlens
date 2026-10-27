import type { MessageItem } from 'vscode';
import { l10n, ThemeIcon, window } from 'vscode';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { GitRemoteProbeResult } from '@gitlens/git/providers/remotes.js';
import { Logger } from '@gitlens/utils/logger.js';
import { pad } from '@gitlens/utils/string.js';
import { GlyphChars } from '../../../constants.js';
import type { Container } from '../../../container.js';
import { revealRemote } from '../../../git/actions/remote.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { showGitErrorMessage } from '../../../messages.js';
import { createQuickPickSeparator } from '../../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../../quickpicks/items/flags.js';
import { supportedInVSCodeVersion } from '../../../system/-webview/vscode.js';
import type {
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../../quick-wizard/models/steps.js';
import { StepResultBreak } from '../../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../../quick-wizard/models/steps.quickpick.js';
import { RetryQuickInputButton } from '../../quick-wizard/quickButtons.js';
import { QuickCommand } from '../../quick-wizard/quickCommand.js';
import { inputRemoteNameStep, inputRemoteUrlStep } from '../../quick-wizard/steps/remotes.js';
import { canSkipRepositoryPick, pickRepositoryStep } from '../../quick-wizard/steps/repositories.js';
import { StepsController } from '../../quick-wizard/stepsController.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	createConfirmStep,
	refreshConfirmStepItems,
} from '../../quick-wizard/utils/steps.utils.js';
import type { RemoteContext } from '../remote.js';

const Steps = {
	PickRepo: 'remote-add-pick-repo',
	InputName: 'remote-add-input-name',
	InputUrl: 'remote-add-input-url',
	Confirm: 'remote-add-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];
export type RemoteAddStepNames = StepNames;

type Context = RemoteContext<StepNames>;

type Flags = '-f';
interface State<Repo = string | GlRepository> {
	repo: Repo;
	name: string;
	url: string;
	flags: Flags[];

	/** Pre-fills the name step when no `name` is given */
	defaultName?: string;
	/** `false` never fetches the new remote, and doesn't offer to */
	fetch?: boolean;
	reveal?: boolean;
}
export type RemoteAddState = State;

export interface RemoteAddGitCommandArgs {
	readonly command: 'remote-add';
	confirm?: boolean;
	state?: Partial<State>;
}

type ConfirmItem = FlagsQuickPickItem<Flags> | DirectiveQuickPickItem;

function getProbeFailureText(result: Extract<GitRemoteProbeResult, { reachable: false }>): string {
	switch (result.reason) {
		case 'hostNotFound':
			return l10n.t('The host could not be found');
		case 'hostKeyUnverified':
			return l10n.t("The host's SSH key isn't trusted yet; connect to it once from a terminal");
		case 'notFound':
			return l10n.t('The repository could not be found');
		case 'authRequired':
			return l10n.t('Authentication is required, or the repository does not exist');
		case 'timeout':
			return l10n.t('The remote did not respond in time');
		default:
			return result.message ?? l10n.t('The remote did not respond as a Git repository');
	}
}

export class RemoteAddGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: RemoteAddGitCommandArgs) {
		super(container, 'remote-add', 'add', l10n.t('Add Remote'), {
			description: l10n.t('adds a new remote'),
		});

		this.initialState = { confirm: args?.confirm, flags: ['-f'], ...args?.state };
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.remotes,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		state.flags ??= [];
		if (state.fetch === false) {
			state.flags = state.flags.filter(f => f !== '-f');
		}

		while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepo) || state.repo == null || typeof state.repo === 'string') {
				// Skip the picker only when the sole available repo is the one requested
				if (canSkipRepositoryPick(context.repos, state.repo)) {
					[state.repo] = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepo);

					const result = yield* pickRepositoryStep(state, context, step, { excludeWorktrees: true });
					if (result === StepResultBreak) {
						state.repo = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repo = result;
				}
			}

			assertStepState<State<GlRepository>>(state);

			if (steps.isAtStep(Steps.InputName) || state.name == null) {
				using step = steps.enterStep(Steps.InputName);

				// A repo's first remote is conventionally `origin` — offered, not imposed
				let value = state.name ?? state.defaultName;
				if (value == null && !(await state.repo.git.remotes.getRemotes()).length) {
					value = 'origin';
				}

				const result = yield* inputRemoteNameStep(state, context, {
					prompt: l10n.t('Please provide a name for the remote'),
					value: value,
				});
				if (result === StepResultBreak) {
					state.name = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.name = result;
			}

			if (steps.isAtStep(Steps.InputUrl) || state.url == null) {
				using step = steps.enterStep(Steps.InputUrl);

				const result = yield* inputRemoteUrlStep(state, context, {
					prompt: l10n.t('Please provide a URL for the remote'),
					value: state.url,
				});
				if (result === StepResultBreak) {
					state.url = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.url = result;
			}

			// The confirm doubles as the reachability guard: a skipped confirmation still probes (while the URL
			// input shows busy) and forces the guard open when the URL doesn't answer
			let probe: GitRemoteProbeResult | undefined;
			let showConfirm = this.confirm(state.confirm);
			if (!showConfirm && state.repo.git.remotes.probeRemote != null) {
				// Fail open like the confirm step's probe: a Live Share guest's host allowlist rejects `ls-remote`
				probe = await state.repo.git.remotes.probeRemote(state.url).catch(() => undefined);
				if (probe != null) {
					showConfirm = !probe.reachable;
				}
			}

			if (showConfirm) {
				using step = steps.enterStep(Steps.Confirm);

				const guard = { shown: false };
				const result = yield* this.confirmStep(state, context, probe, guard);
				if (result === StepResultBreak) {
					// Leaving the guard means "fix the URL": land on the URL step (value retained) even when it
					// was never shown, rather than on whatever preceded the confirm
					if (guard.shown) {
						steps.goBackToStep(Steps.InputUrl);
						continue;
					}

					if (step.goBack() == null) break;
					continue;
				}

				state.flags = result;
			}

			steps.markStepsComplete();

			const fetch = state.fetch !== false && state.flags.includes('-f');
			let remote: GitRemote | undefined;
			try {
				remote = await state.repo.git.remotes.addRemoteWithResult?.(
					state.name,
					state.url,
					fetch ? { fetch: true } : undefined,
				);
			} catch (ex) {
				// `remote add -f` keeps the remote when only its fetch fails; without a fetch, a throw means
				// nothing was added (any same-named remote found now isn't ours)
				if (fetch) {
					remote = await state.repo.git.remotes.getRemote(state.name).catch(() => undefined);
				}

				if (remote == null) {
					void showGitErrorMessage(ex, l10n.t('Unable to add remote'));
					// Nothing was added — hand back a break, not a completion, so a calling wizard can recover
					steps.clearStepsComplete();
					break;
				}

				void this.showFetchFailedWarning(state.repo, state.name);
			}

			if (state.reveal !== false) {
				void revealRemote(remote, { focus: true, select: true });
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async showFetchFailedWarning(repo: GlRepository, name: string): Promise<void> {
		const removeItem: MessageItem = { title: l10n.t('Remove Remote') };
		const cancelItem: MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
		// The failed fetch is already in the log (the git exec layer records every failing command), so
		// point there rather than pasting git's multi-line stderr into the toast
		const loggingEnabled = Logger.enabled('error');
		const openOutputChannelItem: MessageItem = { title: l10n.t('Open Output Channel') };

		const result = await window.showWarningMessage(
			loggingEnabled
				? l10n.t("Added remote '{0}' but unable to fetch from it. See output channel for more details.", name)
				: l10n.t("Added remote '{0}' but unable to fetch from it.", name),
			removeItem,
			...(loggingEnabled ? [openOutputChannelItem] : []),
			cancelItem,
		);
		if (result === openOutputChannelItem) {
			Logger.showOutputChannel();
			return;
		}

		if (result !== removeItem) return;

		try {
			await repo.git.remotes.removeRemote?.(name);
		} catch (removeEx) {
			void showGitErrorMessage(removeEx, l10n.t('Unable to remove remote'));
		}
	}

	/**
	 * Shows the confirmation, and — when the provider can probe — checks the URL in place: a reachable remote
	 * keeps the confirmation rows, an unreachable one rewrites the step into a guard whose pre-selected exit
	 * goes back to change the URL. `probed` is a result already in hand (a skipped confirm probes up front).
	 */
	private *confirmStep(
		state: StepState<State<GlRepository>>,
		context: Context,
		probed: GitRemoteProbeResult | undefined,
		guard: { shown: boolean },
	): StepResultGenerator<Flags[]> {
		const confirmTitle = l10n.t('Confirm Add Remote');
		const title = appendReposToTitle(confirmTitle, state, context);
		const canProbe = state.repo.git.remotes.probeRemote != null;

		const confirmRows: FlagsQuickPickItem<Flags>[] = [
			createFlagsQuickPickItem<Flags>(state.flags, [], {
				label: context.title,
				detail: l10n.t("Will add remote '{0}' for {1}", state.name, state.url),
			}),
		];
		if (state.fetch !== false) {
			confirmRows.push(
				createFlagsQuickPickItem<Flags>(state.flags, ['-f'], {
					label: l10n.t('Add Remote and Fetch'),
					description: '-f',
					detail: l10n.t("Will add and fetch remote '{0}' for {1}", state.name, state.url),
				}),
			);
		}
		const defaultRow = confirmRows.find(r => r.picked) ?? confirmRows[0];

		const checkingNotice = createDirectiveQuickPickItem(Directive.Noop, false, {
			// Not `iconPath` — a spinning ThemeIcon renders off-center in a quick pick row
			label: `$(loading~spin) \u00a0${l10n.t('Checking remote…')}`,
		});
		const changeUrlItem = createDirectiveQuickPickItem(Directive.Back, true, { label: l10n.t('Change URL') });

		let step: QuickPickStep<ConfirmItem>;
		let probing = false;
		const abort = new AbortController();

		const apply = (result: GitRemoteProbeResult | undefined) => {
			let rows: ConfirmItem[];
			let active: ConfirmItem;
			let placeholder: string;
			let prompt: string | undefined;
			let cancel: DirectiveQuickPickItem | undefined;

			if (result == null || result.reachable) {
				guard.shown = false;

				rows =
					result == null
						? confirmRows
						: [
								createDirectiveQuickPickItem(Directive.Noop, false, {
									label: l10n.t('Remote reachable'),
									iconPath: new ThemeIcon('check'),
								}),
								createQuickPickSeparator<ConfirmItem>(),
								...confirmRows,
							];
				// Only move the cursor off the "Checking remote…" row — the user may have arrowed to
				// another row while the probe ran, and Enter must land where they put it
				const current = step.quickpick?.activeItems[0];
				active = current != null && current !== checkingNotice && rows.includes(current) ? current : defaultRow;
				placeholder = confirmTitle;
			} else {
				guard.shown = true;

				const reason = getProbeFailureText(result);
				rows = [
					createDirectiveQuickPickItem(Directive.Noop, false, {
						label: l10n.t('Unable to reach {0}', state.url),
						detail: reason,
						iconPath: new ThemeIcon('warning'),
					}),
					createQuickPickSeparator<ConfirmItem>(),
					createFlagsQuickPickItem<Flags>([], [], {
						label: l10n.t('Add Remote Anyway'),
						detail:
							state.fetch === false
								? l10n.t(
										'Will add {0} without checking it; the push will report if it is wrong',
										state.name,
									)
								: l10n.t(
										'Will add {0} without checking it; a later fetch or push will report if it is wrong',
										state.name,
									),
						iconPath: new ThemeIcon('warning'),
					}),
				];
				// Enter must never add an unreachable remote — the way out is the pre-selected row
				active = changeUrlItem;
				cancel = changeUrlItem;
				placeholder = l10n.t('Cannot reach remote; {0}', reason);
				prompt = l10n.t('Check the URL, or add the remote anyway');
			}

			step.title = title;
			step.placeholder = placeholder;
			step.prompt = prompt;
			step.selectedItems = [active];
			refreshConfirmStepItems(step, rows, cancel);

			const quickpick = step.quickpick;
			if (quickpick == null) return;

			quickpick.title = title;
			quickpick.placeholder = placeholder;
			if (supportedInVSCodeVersion('quickpick-prompt')) {
				quickpick.prompt = prompt;
			}
			quickpick.activeItems = [active];
			quickpick.busy = false;
		};

		const runProbe = async (quickpick?: QuickPickStep<ConfirmItem>['quickpick']) => {
			probing = true;
			if (quickpick != null) {
				quickpick.busy = true;
				quickpick.title = appendReposToTitle(
					l10n.t('Confirm Add Remote{0}Checking{1}', pad(GlyphChars.Dot, 2, 2), GlyphChars.Ellipsis),
					state,
					context,
				);
			}

			let result: GitRemoteProbeResult | undefined;
			try {
				result = await state.repo.git.remotes.probeRemote?.(state.url, abort.signal);
			} catch {
				// Cancelled because the step was left — nothing to update
				if (abort.signal.aborted) return;
			} finally {
				probing = false;
			}
			if (abort.signal.aborted) return;

			apply(result);
		};

		const checking = canProbe && probed == null;
		step = createConfirmStep<ConfirmItem>(
			checking
				? appendReposToTitle(
						l10n.t('Confirm Add Remote{0}Checking{1}', pad(GlyphChars.Dot, 2, 2), GlyphChars.Ellipsis),
						state,
						context,
					)
				: title,
			checking ? [checkingNotice, createQuickPickSeparator<ConfirmItem>(), ...confirmRows] : confirmRows,
			confirmTitle,
			undefined,
			{
				// While checking, Enter lands on the notice (a no-op), so it can't race the probe
				selectedItems: [checking ? checkingNotice : defaultRow],
				additionalButtons: canProbe ? [RetryQuickInputButton] : undefined,
				onDidActivate: quickpick => {
					// The wizard clears `busy` once the rows are shown; keep the spinner while still checking
					if (probing) {
						quickpick.busy = true;
					}
				},
				onDidClickButton: (quickpick, button) => {
					if (button !== RetryQuickInputButton || probing) return false;

					// Rebuilt in place — a retry() would feed the generator a Noop and pop back a step
					void runProbe(quickpick);
					return false;
				},
			},
		);

		if (checking) {
			void runProbe();
		} else if (probed != null) {
			apply(probed);
		}

		let selection: StepSelection<typeof step>;
		try {
			selection = yield step;
		} finally {
			abort.abort();
		}

		if (!canPickStepContinue(step, state, selection)) return StepResultBreak;

		const [item] = selection;
		return 'directive' in item ? StepResultBreak : item.item;
	}
}

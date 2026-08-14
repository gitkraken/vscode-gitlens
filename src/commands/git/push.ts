import { ThemeIcon } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitBranchReference, GitReference } from '@gitlens/git/models/reference.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { getReferenceLabel, isBranchReference } from '@gitlens/git/utils/reference.utils.js';
import { isStringArray } from '@gitlens/utils/array.js';
import { fromNow } from '@gitlens/utils/date.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { pad, pluralize, sortCompare } from '@gitlens/utils/string.js';
import { GlyphChars } from '../../constants.js';
import type { Container } from '../../container.js';
import type { GlRepository } from '../../git/models/repository.js';
import { createQuickPickSeparator } from '../../quickpicks/items/common.js';
import { createDirectiveQuickPickItem, Directive } from '../../quickpicks/items/directive.js';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags.js';
import { configuration } from '../../system/-webview/configuration.js';
import { supportedInVSCodeVersion } from '../../system/-webview/vscode.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../quick-wizard/models/steps.quickpick.js';
import { FetchQuickInputButton } from '../quick-wizard/quickButtons.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import {
	canSkipRepositoriesPick,
	pickRepositoriesStep,
	pickRepositoryStep,
} from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { appendReposToTitle, assertStepState, canPickStepContinue } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepos: 'push-pick-repos',
	Confirm: 'push-confirm',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

/** Orders publish rows: the `remote.pushDefault` remote first, then `origin`, then the rest alphabetically. */
function sortRemotesForPublish(remotes: readonly GitRemote[], pushDefault: string | undefined): GitRemote[] {
	return [...remotes].sort(
		(a, b) =>
			remotePublishRank(a.name, pushDefault) - remotePublishRank(b.name, pushDefault) ||
			sortCompare(a.name, b.name),
	);
}

function remotePublishRank(name: string, pushDefault: string | undefined): number {
	if (pushDefault != null && name === pushDefault) return 0;
	if (name === 'origin') return 1;
	return 2;
}

/** Builds the labelled `Publish` separator plus one row per remote (pushDefault first, then origin,
 *  then alphabetical; first row picked), or nothing when the repo has no remotes. */
async function buildPublishItems(
	repo: GlRepository,
	flags: Flags[],
	branch: GitBranch | GitBranchReference,
	upstreamBranchName: string,
	extraDetail: string,
): Promise<FlagsQuickPickItem<Flags>[]> {
	const [remotesResult, pushDefaultResult] = await Promise.allSettled([
		repo.git.remotes.getRemotes(),
		repo.git.config.getConfig?.('remote.pushDefault'),
	]);
	const remotes = getSettledValue(remotesResult) ?? [];
	if (!remotes.length) return [];

	const pushDefault = getSettledValue(pushDefaultResult);
	const items: FlagsQuickPickItem<Flags>[] = [createQuickPickSeparator<FlagsQuickPickItem<Flags>>('Publish')];
	for (const [i, remote] of sortRemotesForPublish(remotes, pushDefault).entries()) {
		items.push(
			createFlagsQuickPickItem<Flags>(flags, ['--set-upstream', remote.name, upstreamBranchName], {
				label: `Publish ${branch.name} to ${remote.name}`,
				detail: `Will publish ${getReferenceLabel(branch)}${extraDetail} to ${remote.name}`,
				picked: i === 0,
			}),
		);
	}

	return items;
}

interface Context extends StepsContext<StepNames> {
	repos: GlRepository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

type Flags = '--force' | '--set-upstream' | string;
interface State<Repos = string | string[] | GlRepository | GlRepository[]> {
	repos: Repos;
	reference?: GitReference;
	flags: Flags[];
}

export interface PushGitCommandArgs {
	readonly command: 'push';
	confirm?: boolean;
	state?: Partial<State>;
}

export class PushGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: PushGitCommandArgs) {
		super(container, 'push', 'push', 'Push', {
			description: 'pushes changes from the current branch to a remote',
		});

		this.initialState = { confirm: args?.confirm, ...args?.state };
	}

	private execute(state: StepState<State<GlRepository[]>>) {
		const index = state.flags.indexOf('--set-upstream');
		if (index !== -1) {
			return this.container.git.pushAll(state.repos, {
				force: false,
				publish: { remote: state.flags[index + 1] },
				reference: state.reference,
			});
		}

		return this.container.git.pushAll(state.repos, {
			force: state.flags.includes('--force'),
			reference: state.reference,
		});
	}

	protected override get supportsSkipConfirmToggle(): boolean {
		return true;
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		state.flags ??= [];

		if (state.repos != null && !Array.isArray(state.repos)) {
			state.repos = typeof state.repos === 'string' ? [state.repos] : [state.repos];
		}

		assertStepState<State<GlRepository[] | string[]>>(state);

		while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepos) || !state.repos?.length || isStringArray(state.repos)) {
				// Skip the picker only when the sole available repo is the one requested
				if (canSkipRepositoriesPick(context.repos, state.repos)) {
					state.repos = context.repos;
				} else if (state.reference != null) {
					// If a reference is specified, only allow picking the repository that contains it
					using step = steps.enterStep(Steps.PickRepos);

					const result = yield* pickRepositoryStep(
						{ ...state, repos: undefined, repo: state.reference.repoPath },
						context,
						step,
					);
					if (result === StepResultBreak) {
						state.repos = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repos = [result];
				} else {
					using step = steps.enterStep(Steps.PickRepos);

					const result = yield* pickRepositoriesStep(state, context, step, {
						skipIfPossible: true,
					});
					if (result === StepResultBreak) {
						state.repos = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repos = result;
				}
			}

			assertStepState<State<GlRepository[]>>(state);

			// An unpublished branch's confirm isn't a yes/no — it's where the publish remote gets
			// picked — so a skipped confirmation must never skip that decision
			let confirmOverride: boolean | undefined;
			if (!this.confirm(state.confirm) && state.repos.length === 1) {
				const branch = isBranchReference(state.reference)
					? await state.repos[0].git.branches.getBranch(state.reference.name)
					: await state.repos[0].git.branches.getBranch();
				if (branch != null && !branch.remote && branch.upstream == null) {
					confirmOverride = true;
				}
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

			steps.markStepsComplete();
			void this.execute(state);
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private async *confirmStep(
		state: StepState<State<GlRepository[]>>,
		context: Context,
	): AsyncStepResultGenerator<Flags[]> {
		const useForceWithLease = configuration.getCore('git.useForcePushWithLease') ?? true;
		const useForceIfIncludes =
			useForceWithLease &&
			(configuration.getCore('git.useForcePushIfIncludes') ?? true) &&
			(await state.repos[0].git.supports('git:push:force-if-includes'));

		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length > 1) {
			step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will push ${state.repos.length} repos`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
					label: `Force ${this.title}${
						useForceIfIncludes ? ' (with lease and if includes)' : useForceWithLease ? ' (with lease)' : ''
					}`,
					description: `--force${
						useForceWithLease ? `-with-lease${useForceIfIncludes ? ' --force-if-includes' : ''}` : ''
					}`,
					detail: `Will force push${
						useForceIfIncludes ? ' (with lease and if includes)' : useForceWithLease ? ' (with lease)' : ''
					} ${state.repos.length} repos`,
					iconPath: new ThemeIcon('warning'),
				}),
			]);
		} else {
			const [repo] = state.repos;

			const items: FlagsQuickPickItem<Flags>[] = [];

			if (isBranchReference(state.reference)) {
				if (state.reference.remote) {
					step = this.createConfirmStep(
						appendReposToTitle(context.title, state, context),
						[],
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: 'OK',
							detail: 'Cannot push a remote branch',
						}),
						{ placeholder: 'Cannot push a remote branch' },
					);
				} else {
					const branch = await repo.git.branches.getBranch(state.reference.name);

					if (branch != null && branch?.upstream == null) {
						items.push(...(await buildPublishItems(repo, state.flags, branch, branch.name, '')));

						if (items.length) {
							step = this.createConfirmStep(
								appendReposToTitle('Confirm Publish', state, context),
								items,
								undefined,
								{ placeholder: 'Confirm Publish' },
							);
						} else {
							step = this.createConfirmStep(
								appendReposToTitle('Publish', state, context),
								[],
								createDirectiveQuickPickItem(Directive.Cancel, true, {
									label: 'OK',
									detail: 'No remotes found',
								}),
								{ placeholder: 'Cannot publish; No remotes found' },
							);
						}
					} else if (branch?.upstream?.state.behind) {
						// Enter must never force -- the Cancel row is the pre-selected one, overriding
						// createConfirmStep's default of the first confirmation
						const cancelItem = createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: `Cancel ${this.title}`,
							detail: `Cannot push; ${getReferenceLabel(
								branch,
							)} is behind ${branch.remoteName} by ${pluralize('commit', branch.upstream.state.behind)}`,
						});
						step = this.createConfirmStep(
							appendReposToTitle(`Confirm ${context.title}`, state, context),
							[
								createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
									label: `Force ${this.title}${
										useForceIfIncludes
											? ' (with lease and if includes)'
											: useForceWithLease
												? ' (with lease)'
												: ''
									}`,
									description: `--force${
										useForceWithLease
											? `-with-lease${useForceIfIncludes ? ' --force-if-includes' : ''}`
											: ''
									}`,
									detail: `Will force push${
										useForceIfIncludes
											? ' (with lease and if includes)'
											: useForceWithLease
												? ' (with lease)'
												: ''
									} ${
										branch?.upstream.state.ahead
											? ` ${pluralize('commit', branch.upstream.state.ahead)}`
											: ''
									}${branch.remoteName ? ` to ${branch.remoteName}` : ''}${
										branch != null && branch.upstream.state.behind > 0
											? `, overwriting ${pluralize('commit', branch.upstream.state.behind)}${
													branch?.remoteName ? ` on ${branch.remoteName}` : ''
												}`
											: ''
									}`,
									iconPath: new ThemeIcon('warning'),
								}),
							],
							cancelItem,
							{
								selectedItems: [cancelItem],
								prompt: supportedInVSCodeVersion('quickpick-prompt')
									? `${getReferenceLabel(branch)} is behind ${branch.remoteName} by ${pluralize(
											'commit',
											branch.upstream.state.behind,
										)} — pull first, or force push to overwrite them`
									: undefined,
							},
						);
					} else if (branch?.upstream?.state.ahead) {
						step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
							createFlagsQuickPickItem<Flags>(state.flags, [branch.remoteName!], {
								label: this.title,
								detail: `Will push ${pluralize(
									'commit',
									branch.upstream.state.ahead,
								)} from ${getReferenceLabel(branch)} to ${branch.remoteName}`,
							}),
						]);
					} else {
						step = this.createConfirmStep(
							appendReposToTitle(context.title, state, context),
							[],
							createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: 'OK',
								detail: 'No commits found to push',
							}),
							{ placeholder: 'Nothing to push; No commits found to push' },
						);
					}
				}
			} else {
				const status = await repo.git.status.getStatus();

				const branch: GitBranchReference = {
					refType: 'branch',
					name: status?.branch ?? 'HEAD',
					ref: status?.branch ?? 'HEAD',
					remote: false,
					repoPath: repo.path,
				};

				if (status?.upstream?.state.ahead === 0) {
					if (!isBranchReference(state.reference) && status.upstream == null) {
						let pushDetails;

						if (state.reference != null) {
							pushDetails = ` up to and including ${getReferenceLabel(state.reference, {
								label: false,
							})}`;
						} else {
							state.reference = branch;
							pushDetails = '';
						}

						items.push(...(await buildPublishItems(repo, state.flags, branch, status.branch, pushDetails)));
					}

					if (items.length) {
						step = this.createConfirmStep(
							appendReposToTitle('Confirm Publish', state, context),
							items,
							undefined,
							{ placeholder: 'Confirm Publish' },
						);
					} else if (status.upstream == null) {
						step = this.createConfirmStep(
							appendReposToTitle('Publish', state, context),
							[],
							createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: 'OK',
								detail: 'No remotes found',
							}),
							{ placeholder: 'Cannot publish; No remotes found' },
						);
					} else {
						step = this.createConfirmStep(
							appendReposToTitle(context.title, state, context),
							[],
							createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: 'OK',
								detail: `No commits ahead of ${status.upstream?.name}`,
							}),
							{
								placeholder: `Nothing to push; No commits ahead of ${status.upstream?.name}`,
							},
						);
					}
				} else {
					const lastFetched = await repo.getLastFetched();

					let lastFetchedOn = '';
					let lastFetchedPrompt: string | undefined;
					if (lastFetched !== 0) {
						lastFetchedOn = `${pad(GlyphChars.Dot, 2, 2)}Last fetched ${fromNow(new Date(lastFetched))}`;
						lastFetchedPrompt = `Last fetched ${fromNow(new Date(lastFetched))}`;
					}

					let pushDetails;
					if (state.reference != null) {
						pushDetails = `${
							status?.upstream?.state.ahead
								? ` commits up to and including ${getReferenceLabel(state.reference, {
										label: false,
									})}`
								: ''
						}${status?.upstream ? ` to ${status.upstream.name}` : ''}`;
					} else {
						pushDetails = `${
							status?.upstream?.state.ahead ? ` ${pluralize('commit', status.upstream.state.ahead)}` : ''
						}${status?.upstream ? ` to ${status.upstream.name}` : ''}`;
					}

					const behindCount = status?.upstream?.state.behind;
					const promptSupported = supportedInVSCodeVersion('quickpick-prompt');

					let prompt: string | undefined;
					let titleSuffix = lastFetchedOn;
					if (promptSupported) {
						if (behindCount) {
							prompt = `${getReferenceLabel(branch)} is behind${
								status?.upstream ? ` ${status.upstream.name}` : ''
							} by ${pluralize('commit', behindCount)} — pull first, or force push to overwrite them`;
						} else {
							prompt = lastFetchedPrompt;
							titleSuffix = '';
						}
					}

					// Enter must never force when the branch is behind -- the Cancel row is the pre-selected
					// one, overriding createConfirmStep's default of the first confirmation
					const behindCancelItem = behindCount
						? createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: `Cancel ${this.title}`,
								detail: `Cannot push; ${getReferenceLabel(branch)} is behind${
									status?.upstream ? ` ${status.upstream.name}` : ''
								} by ${pluralize('commit', behindCount)}`,
							})
						: undefined;
					step = this.createConfirmStep(
						appendReposToTitle(`Confirm ${context.title}`, state, context, titleSuffix),
						[
							...(behindCount
								? []
								: [
										createFlagsQuickPickItem<Flags>(state.flags, [], {
											label: this.title,
											detail: `Will push${pushDetails}`,
										}),
									]),
							createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
								label: `Force ${this.title}${
									useForceIfIncludes
										? ' (with lease and if includes)'
										: useForceWithLease
											? ' (with lease)'
											: ''
								}`,
								description: `--force${
									useForceWithLease
										? `-with-lease${useForceIfIncludes ? ' --force-if-includes' : ''}`
										: ''
								}`,
								detail: `Will force push${
									useForceIfIncludes
										? ' (with lease and if includes)'
										: useForceWithLease
											? ' (with lease)'
											: ''
								} ${pushDetails}${
									behindCount
										? `, overwriting ${pluralize('commit', behindCount)}${
												status?.upstream ? ` on ${status.upstream.name}` : ''
											}`
										: ''
								}`,
								iconPath: new ThemeIcon('warning'),
							}),
						],
						behindCancelItem,
						{
							prompt: prompt,
							// Spread rather than a `?? undefined` value — an explicit `undefined` key would
							// override createConfirmStep's computed default and leave no row pre-selected
							...(behindCancelItem != null ? { selectedItems: [behindCancelItem] } : undefined),
						},
					);

					step.additionalButtons = [FetchQuickInputButton];
					step.onDidClickButton = async (quickpick, button) => {
						if (button !== FetchQuickInputButton || quickpick.busy) return false;

						quickpick.title = `Confirm ${context.title}${pad(GlyphChars.Dot, 2, 2)}Fetching${
							GlyphChars.Ellipsis
						}`;

						quickpick.busy = true;
						try {
							await repo.git.fetch({ progress: true });
							// Signal that the step should be retried
							return true;
						} finally {
							quickpick.busy = false;
						}
					};
				}
			}
		}

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

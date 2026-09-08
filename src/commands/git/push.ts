import { l10n, ThemeIcon } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitBranchReference, GitReference } from '@gitlens/git/models/reference.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { getReferenceLabel, isBranchReference } from '@gitlens/git/utils/reference.utils.js';
import { isStringArray } from '@gitlens/utils/array.js';
import { fromNow, getNumericFormat } from '@gitlens/utils/date.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { pad, sortCompare } from '@gitlens/utils/string.js';
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
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	createConfirmStep,
} from '../quick-wizard/utils/steps.utils.js';

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

type ForcePushMode = 'force' | 'force-with-lease' | 'force-with-lease-and-includes';

function getForcePushMode(useForceWithLease: boolean, useForceIfIncludes: boolean): ForcePushMode {
	if (useForceIfIncludes) return 'force-with-lease-and-includes';
	if (useForceWithLease) return 'force-with-lease';
	return 'force';
}

function getForcePushLabel(mode: ForcePushMode): string {
	switch (mode) {
		case 'force-with-lease-and-includes':
			return l10n.t('Force Push (with lease and if includes)');
		case 'force-with-lease':
			return l10n.t('Force Push (with lease)');
		case 'force':
			return l10n.t('Force Push');
	}
}

function getForcePushDescription(mode: ForcePushMode): string {
	switch (mode) {
		case 'force-with-lease-and-includes':
			return '--force-with-lease --force-if-includes';
		case 'force-with-lease':
			return '--force-with-lease';
		case 'force':
			return '--force';
	}
}

function getForcePushReposDetail(mode: ForcePushMode, count: number): string {
	switch (mode) {
		case 'force-with-lease-and-includes':
			return l10n.t('Will force push (with lease and if includes) {0} repos', count);
		case 'force-with-lease':
			return l10n.t('Will force push (with lease) {0} repos', count);
		case 'force':
			return l10n.t('Will force push {0} repos', count);
	}
}

function getForcePushBehindDetail(
	mode: ForcePushMode,
	ahead: number | undefined,
	remote: string,
	behind: number,
): string {
	const aheadCount = ahead == null ? '' : getNumericFormat()(ahead);
	const behindCount = getNumericFormat()(behind);
	const hasAhead = ahead != null && ahead > 0;
	const hasRemote = remote.length > 0;

	switch (mode) {
		case 'force-with-lease-and-includes':
			if (hasAhead) {
				if (hasRemote) {
					if (ahead === 1) {
						return behind === 1
							? l10n.t(
									'Will force push (with lease and if includes) {0} commit to {1}, overwriting {2} commit on {1}',
									aheadCount,
									remote,
									behindCount,
								)
							: l10n.t(
									'Will force push (with lease and if includes) {0} commit to {1}, overwriting {2} commits on {1}',
									aheadCount,
									remote,
									behindCount,
								);
					}
					return behind === 1
						? l10n.t(
								'Will force push (with lease and if includes) {0} commits to {1}, overwriting {2} commit on {1}',
								aheadCount,
								remote,
								behindCount,
							)
						: l10n.t(
								'Will force push (with lease and if includes) {0} commits to {1}, overwriting {2} commits on {1}',
								aheadCount,
								remote,
								behindCount,
							);
				}
				if (ahead === 1) {
					return behind === 1
						? l10n.t(
								'Will force push (with lease and if includes) {0} commit, overwriting {1} commit',
								aheadCount,
								behindCount,
							)
						: l10n.t(
								'Will force push (with lease and if includes) {0} commit, overwriting {1} commits',
								aheadCount,
								behindCount,
							);
				}
				return behind === 1
					? l10n.t(
							'Will force push (with lease and if includes) {0} commits, overwriting {1} commit',
							aheadCount,
							behindCount,
						)
					: l10n.t(
							'Will force push (with lease and if includes) {0} commits, overwriting {1} commits',
							aheadCount,
							behindCount,
						);
			}
			return hasRemote
				? behind === 1
					? l10n.t(
							'Will force push (with lease and if includes) to {0}, overwriting {1} commit on {0}',
							remote,
							behindCount,
						)
					: l10n.t(
							'Will force push (with lease and if includes) to {0}, overwriting {1} commits on {0}',
							remote,
							behindCount,
						)
				: behind === 1
					? l10n.t('Will force push (with lease and if includes), overwriting {0} commit', behindCount)
					: l10n.t('Will force push (with lease and if includes), overwriting {0} commits', behindCount);
		case 'force-with-lease':
			if (hasAhead) {
				if (hasRemote) {
					if (ahead === 1) {
						return behind === 1
							? l10n.t(
									'Will force push (with lease) {0} commit to {1}, overwriting {2} commit on {1}',
									aheadCount,
									remote,
									behindCount,
								)
							: l10n.t(
									'Will force push (with lease) {0} commit to {1}, overwriting {2} commits on {1}',
									aheadCount,
									remote,
									behindCount,
								);
					}
					return behind === 1
						? l10n.t(
								'Will force push (with lease) {0} commits to {1}, overwriting {2} commit on {1}',
								aheadCount,
								remote,
								behindCount,
							)
						: l10n.t(
								'Will force push (with lease) {0} commits to {1}, overwriting {2} commits on {1}',
								aheadCount,
								remote,
								behindCount,
							);
				}
				if (ahead === 1) {
					return behind === 1
						? l10n.t(
								'Will force push (with lease) {0} commit, overwriting {1} commit',
								aheadCount,
								behindCount,
							)
						: l10n.t(
								'Will force push (with lease) {0} commit, overwriting {1} commits',
								aheadCount,
								behindCount,
							);
				}
				return behind === 1
					? l10n.t(
							'Will force push (with lease) {0} commits, overwriting {1} commit',
							aheadCount,
							behindCount,
						)
					: l10n.t(
							'Will force push (with lease) {0} commits, overwriting {1} commits',
							aheadCount,
							behindCount,
						);
			}
			return hasRemote
				? behind === 1
					? l10n.t('Will force push (with lease) to {0}, overwriting {1} commit on {0}', remote, behindCount)
					: l10n.t('Will force push (with lease) to {0}, overwriting {1} commits on {0}', remote, behindCount)
				: behind === 1
					? l10n.t('Will force push (with lease), overwriting {0} commit', behindCount)
					: l10n.t('Will force push (with lease), overwriting {0} commits', behindCount);
		case 'force':
			if (hasAhead) {
				if (hasRemote) {
					if (ahead === 1) {
						return behind === 1
							? l10n.t(
									'Will force push {0} commit to {1}, overwriting {2} commit on {1}',
									aheadCount,
									remote,
									behindCount,
								)
							: l10n.t(
									'Will force push {0} commit to {1}, overwriting {2} commits on {1}',
									aheadCount,
									remote,
									behindCount,
								);
					}
					return behind === 1
						? l10n.t(
								'Will force push {0} commits to {1}, overwriting {2} commit on {1}',
								aheadCount,
								remote,
								behindCount,
							)
						: l10n.t(
								'Will force push {0} commits to {1}, overwriting {2} commits on {1}',
								aheadCount,
								remote,
								behindCount,
							);
				}
				if (ahead === 1) {
					return behind === 1
						? l10n.t('Will force push {0} commit, overwriting {1} commit', aheadCount, behindCount)
						: l10n.t('Will force push {0} commit, overwriting {1} commits', aheadCount, behindCount);
				}
				return behind === 1
					? l10n.t('Will force push {0} commits, overwriting {1} commit', aheadCount, behindCount)
					: l10n.t('Will force push {0} commits, overwriting {1} commits', aheadCount, behindCount);
			}
			return hasRemote
				? behind === 1
					? l10n.t('Will force push to {0}, overwriting {1} commit on {0}', remote, behindCount)
					: l10n.t('Will force push to {0}, overwriting {1} commits on {0}', remote, behindCount)
				: behind === 1
					? l10n.t('Will force push, overwriting {0} commit', behindCount)
					: l10n.t('Will force push, overwriting {0} commits', behindCount);
	}
}

function getPushDetail(referenceName: string | undefined, ahead: number | undefined, remote: string): string {
	if (referenceName != null) {
		if (ahead) {
			return remote.length === 0
				? l10n.t('Will push commits up to and including {0}', referenceName)
				: l10n.t('Will push commits up to and including {0} to {1}', referenceName, remote);
		}
		return remote.length === 0 ? l10n.t('Will push') : l10n.t('Will push to {0}', remote);
	}

	if (ahead) {
		if (remote.length === 0) {
			return ahead === 1
				? l10n.t('Will push {0} commit', getNumericFormat()(ahead))
				: l10n.t('Will push {0} commits', getNumericFormat()(ahead));
		}
		return ahead === 1
			? l10n.t('Will push {0} commit to {1}', getNumericFormat()(ahead), remote)
			: l10n.t('Will push {0} commits to {1}', getNumericFormat()(ahead), remote);
	}

	return remote.length === 0 ? l10n.t('Will push') : l10n.t('Will push to {0}', remote);
}

function getForcePushNoBehindDetail(
	mode: ForcePushMode,
	referenceName: string | undefined,
	ahead: number | undefined,
	remote: string,
): string {
	if (referenceName != null) {
		if (ahead) {
			switch (mode) {
				case 'force-with-lease-and-includes':
					return remote.length === 0
						? l10n.t(
								'Will force push (with lease and if includes) commits up to and including {0}',
								referenceName,
							)
						: l10n.t(
								'Will force push (with lease and if includes) commits up to and including {0} to {1}',
								referenceName,
								remote,
							);
				case 'force-with-lease':
					return remote.length === 0
						? l10n.t('Will force push (with lease) commits up to and including {0}', referenceName)
						: l10n.t(
								'Will force push (with lease) commits up to and including {0} to {1}',
								referenceName,
								remote,
							);
				case 'force':
					return remote.length === 0
						? l10n.t('Will force push commits up to and including {0}', referenceName)
						: l10n.t('Will force push commits up to and including {0} to {1}', referenceName, remote);
			}
		}

		switch (mode) {
			case 'force-with-lease-and-includes':
				return remote.length === 0
					? l10n.t('Will force push (with lease and if includes)')
					: l10n.t('Will force push (with lease and if includes) to {0}', remote);
			case 'force-with-lease':
				return remote.length === 0
					? l10n.t('Will force push (with lease)')
					: l10n.t('Will force push (with lease) to {0}', remote);
			case 'force':
				return remote.length === 0 ? l10n.t('Will force push') : l10n.t('Will force push to {0}', remote);
		}
	}

	if (ahead) {
		if (remote.length === 0) {
			if (ahead === 1) {
				return mode === 'force-with-lease-and-includes'
					? l10n.t('Will force push (with lease and if includes) {0} commit', getNumericFormat()(ahead))
					: mode === 'force-with-lease'
						? l10n.t('Will force push (with lease) {0} commit', getNumericFormat()(ahead))
						: l10n.t('Will force push {0} commit', getNumericFormat()(ahead));
			}
			return mode === 'force-with-lease-and-includes'
				? l10n.t('Will force push (with lease and if includes) {0} commits', getNumericFormat()(ahead))
				: mode === 'force-with-lease'
					? l10n.t('Will force push (with lease) {0} commits', getNumericFormat()(ahead))
					: l10n.t('Will force push {0} commits', getNumericFormat()(ahead));
		}
		if (ahead === 1) {
			return mode === 'force-with-lease-and-includes'
				? l10n.t(
						'Will force push (with lease and if includes) {0} commit to {1}',
						getNumericFormat()(ahead),
						remote,
					)
				: mode === 'force-with-lease'
					? l10n.t('Will force push (with lease) {0} commit to {1}', getNumericFormat()(ahead), remote)
					: l10n.t('Will force push {0} commit to {1}', getNumericFormat()(ahead), remote);
		}
		return mode === 'force-with-lease-and-includes'
			? l10n.t(
					'Will force push (with lease and if includes) {0} commits to {1}',
					getNumericFormat()(ahead),
					remote,
				)
			: mode === 'force-with-lease'
				? l10n.t('Will force push (with lease) {0} commits to {1}', getNumericFormat()(ahead), remote)
				: l10n.t('Will force push {0} commits to {1}', getNumericFormat()(ahead), remote);
	}

	switch (mode) {
		case 'force-with-lease-and-includes':
			return remote.length === 0
				? l10n.t('Will force push (with lease and if includes)')
				: l10n.t('Will force push (with lease and if includes) to {0}', remote);
		case 'force-with-lease':
			return remote.length === 0
				? l10n.t('Will force push (with lease)')
				: l10n.t('Will force push (with lease) to {0}', remote);
		case 'force':
			return remote.length === 0 ? l10n.t('Will force push') : l10n.t('Will force push to {0}', remote);
	}
}

function getForcePushReferenceBehindDetail(
	mode: ForcePushMode,
	referenceName: string,
	hasAhead: boolean,
	remote: string,
	behind: number,
): string {
	const behindCount = getNumericFormat()(behind);
	switch (mode) {
		case 'force-with-lease-and-includes':
			if (hasAhead) {
				return remote.length === 0
					? behind === 1
						? l10n.t(
								'Will force push (with lease and if includes) commits up to and including {0}, overwriting {1} commit',
								referenceName,
								behindCount,
							)
						: l10n.t(
								'Will force push (with lease and if includes) commits up to and including {0}, overwriting {1} commits',
								referenceName,
								behindCount,
							)
					: behind === 1
						? l10n.t(
								'Will force push (with lease and if includes) commits up to and including {0} to {1}, overwriting {2} commit on {1}',
								referenceName,
								remote,
								behindCount,
							)
						: l10n.t(
								'Will force push (with lease and if includes) commits up to and including {0} to {1}, overwriting {2} commits on {1}',
								referenceName,
								remote,
								behindCount,
							);
			}
			return remote.length === 0
				? behind === 1
					? l10n.t('Will force push (with lease and if includes), overwriting {0} commit', behindCount)
					: l10n.t('Will force push (with lease and if includes), overwriting {0} commits', behindCount)
				: behind === 1
					? l10n.t(
							'Will force push (with lease and if includes) to {0}, overwriting {1} commit on {0}',
							remote,
							behindCount,
						)
					: l10n.t(
							'Will force push (with lease and if includes) to {0}, overwriting {1} commits on {0}',
							remote,
							behindCount,
						);
		case 'force-with-lease':
			if (hasAhead) {
				return remote.length === 0
					? behind === 1
						? l10n.t(
								'Will force push (with lease) commits up to and including {0}, overwriting {1} commit',
								referenceName,
								behindCount,
							)
						: l10n.t(
								'Will force push (with lease) commits up to and including {0}, overwriting {1} commits',
								referenceName,
								behindCount,
							)
					: behind === 1
						? l10n.t(
								'Will force push (with lease) commits up to and including {0} to {1}, overwriting {2} commit on {1}',
								referenceName,
								remote,
								behindCount,
							)
						: l10n.t(
								'Will force push (with lease) commits up to and including {0} to {1}, overwriting {2} commits on {1}',
								referenceName,
								remote,
								behindCount,
							);
			}
			return remote.length === 0
				? behind === 1
					? l10n.t('Will force push (with lease), overwriting {0} commit', behindCount)
					: l10n.t('Will force push (with lease), overwriting {0} commits', behindCount)
				: behind === 1
					? l10n.t('Will force push (with lease) to {0}, overwriting {1} commit on {0}', remote, behindCount)
					: l10n.t(
							'Will force push (with lease) to {0}, overwriting {1} commits on {0}',
							remote,
							behindCount,
						);
		case 'force':
			if (hasAhead) {
				return remote.length === 0
					? behind === 1
						? l10n.t(
								'Will force push commits up to and including {0}, overwriting {1} commit',
								referenceName,
								behindCount,
							)
						: l10n.t(
								'Will force push commits up to and including {0}, overwriting {1} commits',
								referenceName,
								behindCount,
							)
					: behind === 1
						? l10n.t(
								'Will force push commits up to and including {0} to {1}, overwriting {2} commit on {1}',
								referenceName,
								remote,
								behindCount,
							)
						: l10n.t(
								'Will force push commits up to and including {0} to {1}, overwriting {2} commits on {1}',
								referenceName,
								remote,
								behindCount,
							);
			}
			return remote.length === 0
				? behind === 1
					? l10n.t('Will force push, overwriting {0} commit', behindCount)
					: l10n.t('Will force push, overwriting {0} commits', behindCount)
				: behind === 1
					? l10n.t('Will force push to {0}, overwriting {1} commit on {0}', remote, behindCount)
					: l10n.t('Will force push to {0}, overwriting {1} commits on {0}', remote, behindCount);
	}
}

/** Builds the labelled `Publish` separator plus one row per remote (pushDefault first, then origin,
 *  then alphabetical; first row picked), or nothing when the repo has no remotes. */
async function buildPublishItems(
	repo: GlRepository,
	flags: Flags[],
	branch: GitBranch | GitBranchReference,
	upstreamBranchName: string,
	referenceName: string | undefined,
): Promise<FlagsQuickPickItem<Flags>[]> {
	const [remotesResult, pushDefaultResult] = await Promise.allSettled([
		repo.git.remotes.getRemotes(),
		repo.git.config.getConfig?.('remote.pushDefault'),
	]);
	const remotes = getSettledValue(remotesResult) ?? [];
	if (!remotes.length) return [];

	const pushDefault = getSettledValue(pushDefaultResult);
	const items: FlagsQuickPickItem<Flags>[] = [createQuickPickSeparator<FlagsQuickPickItem<Flags>>(l10n.t('Publish'))];
	for (const [i, remote] of sortRemotesForPublish(remotes, pushDefault).entries()) {
		items.push(
			createFlagsQuickPickItem<Flags>(flags, ['--set-upstream', remote.name, upstreamBranchName], {
				label: l10n.t('Publish {0} to {1}', branch.name, remote.name),
				detail:
					referenceName == null
						? l10n.t('Will publish {0} to {1}', getReferenceLabel(branch), remote.name)
						: l10n.t(
								'Will publish {0} up to and including {1} to {2}',
								getReferenceLabel(branch),
								referenceName,
								remote.name,
							),
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
		super(container, 'push', 'push', l10n.t('Push'), {
			description: l10n.t('pushes changes from the current branch to a remote'),
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

		// When confirmations are being skipped, this confirm was forced open because it IS the
		// publish-remote decision — don't offer/echo the Don't Ask Again toggle on a step the
		// setting can never skip
		const confirmForced = !this.confirm(state.confirm);
		const forcePushMode = getForcePushMode(useForceWithLease, useForceIfIncludes);

		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length > 1) {
			step = this.createConfirmStep(
				appendReposToTitle(l10n.t('Confirm Push'), state, context),
				[
					createFlagsQuickPickItem<Flags>(state.flags, [], {
						label: this.title,
						detail: l10n.t('Will push {0} repos', state.repos.length),
					}),
					createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
						label: getForcePushLabel(forcePushMode),
						description: getForcePushDescription(forcePushMode),
						detail: getForcePushReposDetail(forcePushMode, state.repos.length),
						iconPath: new ThemeIcon('warning'),
					}),
				],
				l10n.t('Confirm Push'),
			);
		} else {
			const [repo] = state.repos;

			const items: FlagsQuickPickItem<Flags>[] = [];

			if (isBranchReference(state.reference)) {
				if (state.reference.remote) {
					step = this.createConfirmStep(
						appendReposToTitle(context.title, state, context),
						[],
						l10n.t('Cannot push a remote branch'),
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: l10n.t('OK'),
							detail: l10n.t('Cannot push a remote branch'),
						}),
					);
				} else {
					const branch = await repo.git.branches.getBranch(state.reference.name);

					if (branch != null && (branch.upstream == null || branch.upstream.missing)) {
						items.push(...(await buildPublishItems(repo, state.flags, branch, branch.name, undefined)));

						if (items.length) {
							step = confirmForced
								? createConfirmStep(
										appendReposToTitle(l10n.t('Confirm Publish'), state, context),
										items,
										l10n.t('Confirm Publish'),
									)
								: this.createConfirmStep(
										appendReposToTitle(l10n.t('Confirm Publish'), state, context),
										items,
										l10n.t('Confirm Publish'),
									);
						} else {
							step = this.createConfirmStep(
								appendReposToTitle(l10n.t('Publish'), state, context),
								[],
								l10n.t('Cannot publish; No remotes found'),
								createDirectiveQuickPickItem(Directive.Cancel, true, {
									label: l10n.t('OK'),
									detail: l10n.t('No remotes found'),
								}),
							);
						}
					} else if (branch?.upstream?.state.behind) {
						// Enter must never force -- the Cancel row is the pre-selected one, overriding
						// createConfirmStep's default of the first confirmation
						const cancelItem = createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: l10n.t('Cancel Push'),
							detail:
								branch.upstream.state.behind === 1
									? l10n.t(
											'Cannot push; {0} is behind {1} by {2} commit',
											getReferenceLabel(branch),
											branch.remoteName ?? '',
											getNumericFormat()(branch.upstream.state.behind),
										)
									: l10n.t(
											'Cannot push; {0} is behind {1} by {2} commits',
											getReferenceLabel(branch),
											branch.remoteName ?? '',
											getNumericFormat()(branch.upstream.state.behind),
										),
						});
						step = this.createConfirmStep(
							appendReposToTitle(l10n.t('Confirm Push'), state, context),
							[
								createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
									label: getForcePushLabel(forcePushMode),
									description: getForcePushDescription(forcePushMode),
									detail: getForcePushBehindDetail(
										forcePushMode,
										branch.upstream.state.ahead,
										branch.remoteName ?? '',
										branch.upstream.state.behind,
									),
									iconPath: new ThemeIcon('warning'),
								}),
							],
							l10n.t('Confirm Push'),
							cancelItem,
							{
								selectedItems: [cancelItem],
								prompt: supportedInVSCodeVersion('quickpick-prompt')
									? branch.upstream.state.behind === 1
										? l10n.t(
												'{0} is behind {1} by {2} commit — pull first, or force push to overwrite them',
												getReferenceLabel(branch),
												branch.remoteName ?? '',
												getNumericFormat()(branch.upstream.state.behind),
											)
										: l10n.t(
												'{0} is behind {1} by {2} commits — pull first, or force push to overwrite them',
												getReferenceLabel(branch),
												branch.remoteName ?? '',
												getNumericFormat()(branch.upstream.state.behind),
											)
									: undefined,
							},
						);
					} else if (branch?.upstream?.state.ahead) {
						step = this.createConfirmStep(
							appendReposToTitle(l10n.t('Confirm Push'), state, context),
							[
								createFlagsQuickPickItem<Flags>(state.flags, [branch.remoteName!], {
									label: this.title,
									detail:
										branch.upstream.state.ahead === 1
											? l10n.t(
													'Will push {0} commit from {1} to {2}',
													getNumericFormat()(branch.upstream.state.ahead),
													getReferenceLabel(branch),
													branch.remoteName ?? '',
												)
											: l10n.t(
													'Will push {0} commits from {1} to {2}',
													getNumericFormat()(branch.upstream.state.ahead),
													getReferenceLabel(branch),
													branch.remoteName ?? '',
												),
								}),
							],
							l10n.t('Confirm Push'),
						);
					} else {
						step = this.createConfirmStep(
							appendReposToTitle(context.title, state, context),
							[],
							l10n.t('Nothing to push; No commits found to push'),
							createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: l10n.t('OK'),
								detail: l10n.t('No commits found to push'),
							}),
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
					if (!isBranchReference(state.reference) && (status.upstream == null || status.upstream.missing)) {
						const referenceName =
							state.reference != null ? getReferenceLabel(state.reference, { label: false }) : undefined;
						state.reference ??= branch;

						items.push(
							...(await buildPublishItems(repo, state.flags, branch, status.branch, referenceName)),
						);
					}

					if (items.length) {
						step = confirmForced
							? createConfirmStep(
									appendReposToTitle(l10n.t('Confirm Publish'), state, context),
									items,
									l10n.t('Confirm Publish'),
								)
							: this.createConfirmStep(
									appendReposToTitle(l10n.t('Confirm Publish'), state, context),
									items,
									l10n.t('Confirm Publish'),
								);
					} else if (status.upstream == null || status.upstream.missing) {
						step = this.createConfirmStep(
							appendReposToTitle(l10n.t('Publish'), state, context),
							[],
							l10n.t('Cannot publish; No remotes found'),
							createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: l10n.t('OK'),
								detail: l10n.t('No remotes found'),
							}),
						);
					} else {
						step = this.createConfirmStep(
							appendReposToTitle(context.title, state, context),
							[],
							l10n.t('Nothing to push; No commits ahead of {0}', status.upstream?.name),
							createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: l10n.t('OK'),
								detail: l10n.t('No commits ahead of {0}', status.upstream?.name),
							}),
						);
					}
				} else {
					const lastFetched = await repo.getLastFetched();

					let lastFetchedOn = '';
					let lastFetchedPrompt: string | undefined;
					if (lastFetched !== 0) {
						lastFetchedOn = l10n.t(
							'{0}Last fetched {1}',
							pad(GlyphChars.Dot, 2, 2),
							fromNow(new Date(lastFetched)),
						);
						lastFetchedPrompt = l10n.t('Last fetched {0}', fromNow(new Date(lastFetched)));
					}

					const behindCount = status?.upstream?.state.behind;
					const upstreamName = status?.upstream?.name;
					const aheadCount = status?.upstream?.state.ahead;
					const referenceName =
						state.reference != null ? getReferenceLabel(state.reference, { label: false }) : undefined;
					const promptSupported = supportedInVSCodeVersion('quickpick-prompt');

					let prompt: string | undefined;
					let titleSuffix = lastFetchedOn;
					if (promptSupported) {
						if (behindCount) {
							prompt =
								behindCount === 1
									? l10n.t(
											'{0} is behind {1} by {2} commit — pull first, or force push to overwrite them',
											getReferenceLabel(branch),
											upstreamName ?? '',
											getNumericFormat()(behindCount),
										)
									: l10n.t(
											'{0} is behind {1} by {2} commits — pull first, or force push to overwrite them',
											getReferenceLabel(branch),
											upstreamName ?? '',
											getNumericFormat()(behindCount),
										);
						} else {
							prompt = lastFetchedPrompt;
							titleSuffix = '';
						}
					}

					// Enter must never force when the branch is behind -- the Cancel row is the pre-selected
					// one, overriding createConfirmStep's default of the first confirmation
					const behindCancelItem = behindCount
						? createDirectiveQuickPickItem(Directive.Cancel, true, {
								label: l10n.t('Cancel Push'),
								detail:
									behindCount === 1
										? l10n.t(
												'Cannot push; {0} is behind {1} by {2} commit',
												getReferenceLabel(branch),
												upstreamName ?? '',
												getNumericFormat()(behindCount),
											)
										: l10n.t(
												'Cannot push; {0} is behind {1} by {2} commits',
												getReferenceLabel(branch),
												upstreamName ?? '',
												getNumericFormat()(behindCount),
											),
							})
						: undefined;
					step = this.createConfirmStep(
						appendReposToTitle(l10n.t('Confirm Push'), state, context, titleSuffix),
						[
							...(behindCount
								? []
								: [
										createFlagsQuickPickItem<Flags>(state.flags, [], {
											label: this.title,
											detail: getPushDetail(referenceName, aheadCount, upstreamName ?? ''),
										}),
									]),
							createFlagsQuickPickItem<Flags>(state.flags, ['--force'], {
								label: getForcePushLabel(forcePushMode),
								description: getForcePushDescription(forcePushMode),
								detail: behindCount
									? referenceName != null
										? getForcePushReferenceBehindDetail(
												forcePushMode,
												referenceName,
												Boolean(aheadCount),
												upstreamName ?? '',
												behindCount,
											)
										: getForcePushBehindDetail(
												forcePushMode,
												aheadCount,
												upstreamName ?? '',
												behindCount,
											)
									: getForcePushNoBehindDetail(
											forcePushMode,
											referenceName,
											aheadCount,
											upstreamName ?? '',
										),
								iconPath: new ThemeIcon('warning'),
							}),
						],
						l10n.t('Confirm Push'),
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

						quickpick.title = l10n.t(
							'Confirm Push{0}Fetching{1}',
							pad(GlyphChars.Dot, 2, 2),
							GlyphChars.Ellipsis,
						);

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

import { window } from 'vscode';
import type { Container } from '../../container';
import { skipPausedOperation } from '../../git/actions/pausedOperation';
import { CherryPickError, CherryPickErrorReason } from '../../git/errors';
import type { GitBranch } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus';
import type { GitReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { getReferenceLabel, isRevisionReference } from '../../git/utils/reference.utils';
import { createRevisionRange } from '../../git/utils/revision.utils';
import { showGenericErrorMessage } from '../../messages';
import type { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { createFlagsQuickPickItem } from '../../quickpicks/items/flags';
import { executeCommand } from '../../system/-webview/command';
import { Logger } from '../../system/logger';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { canPickStepContinue, createConfirmStep, endSteps, QuickCommand, StepResultBreak } from '../quickCommand';
import { appendReposToTitle, pickBranchOrTagStep, pickCommitsStep, pickRepositoryStep } from '../quickCommand.steps';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	destination: GitBranch;
	selectedBranchOrTag: GitReference | undefined;
	showTags: boolean;
	title: string;
}

type Flags = '--edit' | '--no-commit';

interface State<Refs = GitReference | GitReference[]> {
	repo: string | Repository;
	references: Refs;
	flags: Flags[];
}

export interface CherryPickGitCommandArgs {
	readonly command: 'cherry-pick';
	state?: Partial<State>;
}

type CherryPickStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class CherryPickGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: CherryPickGitCommandArgs) {
		super(container, 'cherry-pick', 'cherry-pick', 'Cherry Pick', {
			description: 'integrates changes from specified commits into the current branch',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		if (args?.state?.references != null) {
			if (Array.isArray(args.state.references)) {
				if (args.state.references.length > 0) {
					if (isRevisionReference(args.state.references[0])) {
						counter += 2;
					} else {
						counter++;
					}
				}
			} else {
				counter++;
			}
		}

		this.initialState = {
			counter: counter,
			confirm: true,
			...args?.state,
		};
	}

	override get canSkipConfirm(): boolean {
		return false;
	}

	private async execute(state: CherryPickStepState<State<GitReference[]>>) {
		try {
			await state.repo.git.commits().cherryPick?.(
				state.references.map(c => c.ref),
				{
					edit: state.flags.includes('--edit'),
					noCommit: state.flags.includes('--no-commit'),
				},
			);
		} catch (ex) {
			Logger.error(ex, this.title);
			if (ex instanceof CherryPickError && ex.reason === CherryPickErrorReason.EmptyCommit) {
				let pausedOperation: GitPausedOperationStatus | undefined;
				try {
					pausedOperation = await state.repo.git.status().getPausedOperationStatus?.();
					pausedOperation ??= await state.repo
						.waitForRepoChange(500)
						.then(() => state.repo.git.status().getPausedOperationStatus?.());
				} catch {}

				const pausedAt = pausedOperation
					? getReferenceLabel(pausedOperation?.incoming, { icon: false, label: true, quoted: true })
					: undefined;

				const skip = { title: 'Skip' };
				const cancel = { title: 'Cancel', isCloseAffordance: true };
				const result = await window.showInformationMessage(
					`The cherry-pick operation cannot be completed because ${
						pausedAt ?? 'it'
					} resulted in an empty commit.\n\nDo you want to skip ${pausedAt ?? 'this commit'}?`,
					{ modal: true },
					skip,
					cancel,
				);
				if (result === skip) {
					return void skipPausedOperation(state.repo);
				}

				void executeCommand('gitlens.showCommitsView');
				return;
			}

			void showGenericErrorMessage(ex.message);
		}
	}

	override isFuzzyMatch(name: string): boolean {
		return super.isFuzzyMatch(name) || name === 'cherry';
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			destination: undefined!,
			selectedBranchOrTag: undefined,
			showTags: true,
			title: this.title,
		};

		if (state.flags == null) {
			state.flags = [];
		}

		if (state.references != null && !Array.isArray(state.references)) {
			state.references = [state.references];
		}

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.repo == null || typeof state.repo === 'string') {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					skippedStepOne = true;
					if (state.repo == null) {
						state.counter++;
					}

					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					// Always break on the first step (so we will go back)
					if (result === StepResultBreak) break;

					state.repo = result;
				}
			}

			if (context.destination == null) {
				const branch = await state.repo.git.branches().getBranch();
				if (branch == null) break;

				context.destination = branch;
			}

			context.title = `${this.title} into ${getReferenceLabel(context.destination, {
				icon: false,
				label: false,
			})}`;

			if (state.counter < 2 || !state.references?.length) {
				const result: StepResult<GitReference> = yield* pickBranchOrTagStep(
					state as CherryPickStepState,
					context,
					{
						filter: { branches: b => b.id !== context.destination.id },
						placeholder: context =>
							`Choose a branch${context.showTags ? ' or tag' : ''} to cherry-pick from`,
						picked: context.selectedBranchOrTag?.ref,
						value: context.selectedBranchOrTag == null ? state.references?.[0]?.ref : undefined,
					},
				);
				if (result === StepResultBreak) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				if (isRevisionReference(result)) {
					state.references = [result];
					context.selectedBranchOrTag = undefined;
				} else {
					context.selectedBranchOrTag = result;
				}
			}

			if (context.selectedBranchOrTag == null && state.references?.length) {
				const branches = await state.repo.git.branches().getBranchesWithCommits(
					state.references.map(r => r.ref),
					undefined,
					{ mode: 'contains' },
				);
				if (branches.length) {
					const branch = await state.repo.git.branches().getBranch(branches[0]);
					if (branch != null) {
						context.selectedBranchOrTag = branch;
					}
				}
			}

			if (state.counter < 3 && context.selectedBranchOrTag != null) {
				const rev = createRevisionRange(context.destination.ref, context.selectedBranchOrTag.ref, '..');

				let log = context.cache.get(rev);
				if (log == null) {
					log = state.repo.git.commits().getLog(rev, { merges: 'first-parent' });
					context.cache.set(rev, log);
				}

				const result: StepResult<GitReference[]> = yield* pickCommitsStep(
					state as CherryPickStepState,
					context,
					{
						log: await log,
						onDidLoadMore: log => context.cache.set(rev, Promise.resolve(log)),
						picked: state.references?.map(r => r.ref),
						placeholder: (context, log) =>
							log == null
								? `No pickable commits found on ${getReferenceLabel(context.selectedBranchOrTag, {
										icon: false,
								  })}`
								: `Choose commits to cherry-pick into ${getReferenceLabel(context.destination, {
										icon: false,
								  })}`,
					},
				);
				if (result === StepResultBreak) continue;

				state.references = result;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state as CherryPickStepState, context);
				if (result === StepResultBreak) continue;

				state.flags = result;
			}

			endSteps(state);
			void this.execute(state as CherryPickStepState<State<GitReference[]>>);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *confirmStep(state: CherryPickStepState, context: Context): StepResultGenerator<Flags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<Flags>> = createConfirmStep(
			appendReposToTitle(`Confirm ${context.title}`, state, context),
			[
				createFlagsQuickPickItem<Flags>(state.flags, [], {
					label: this.title,
					detail: `Will apply ${getReferenceLabel(state.references, { label: false })} to ${getReferenceLabel(
						context.destination,
						{ label: false },
					)}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--edit'], {
					label: `${this.title} & Edit`,
					description: '--edit',
					detail: `Will edit and apply ${getReferenceLabel(state.references, {
						label: false,
					})} to ${getReferenceLabel(context.destination, { label: false })}`,
				}),
				createFlagsQuickPickItem<Flags>(state.flags, ['--no-commit'], {
					label: `${this.title} without Committing`,
					description: '--no-commit',
					detail: `Will apply ${getReferenceLabel(state.references, { label: false })} to ${getReferenceLabel(
						context.destination,
						{ label: false },
					)} without Committing`,
				}),
			],
			context,
		);
		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}

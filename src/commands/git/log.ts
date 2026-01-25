import { GlyphChars, quickPickTitleMaxChars } from '../../constants.js';
import type { Container } from '../../container.js';
import { showCommitInDetailsView } from '../../git/actions/commit.js';
import { GitCommit } from '../../git/models/commit.js';
import type { GitLog } from '../../git/models/log.js';
import type { GitReference } from '../../git/models/reference.js';
import type { Repository } from '../../git/models/repository.js';
import { getReferenceLabel, isRevisionRangeReference, isRevisionReference } from '../../git/utils/reference.utils.js';
import { formatPath } from '../../system/-webview/formatPath.js';
import { pad } from '../../system/string.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type { PartialStepState, StepGenerator, StepsContext } from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickCommitStep } from '../quick-wizard/steps/commits.js';
import { pickBranchOrTagStep } from '../quick-wizard/steps/references.js';
import { pickRepositoryStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { getSteps } from '../quick-wizard/utils/quickWizard.utils.js';
import { assertStepState } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepo: 'log-pick-repo',
	PickRef: 'log-pick-ref',
	PickCommit: 'log-pick-commit',
	ShowCommit: 'log-show-commit',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	cache: Map<string, Promise<GitLog | undefined>>;
	selectedBranchOrTag: GitReference | undefined;
	title: string;
}

interface State<Repo = string | Repository> {
	repo: Repo;
	reference: GitReference | 'HEAD';

	fileName?: string;
	openPickInView?: boolean;
}

export interface LogGitCommandArgs {
	readonly command: 'log';
	state?: Partial<State>;
}

export class LogGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: LogGitCommandArgs) {
		super(container, 'log', 'history', 'Commits', {
			description: 'aka log, shows commit history',
		});

		this.initialState = { confirm: false, ...args?.state };
	}

	override get canConfirm(): boolean {
		return false;
	}

	override isFuzzyMatch(name: string): boolean {
		return super.isFuzzyMatch(name) || name === 'log';
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.commits,
			cache: new Map<string, Promise<GitLog | undefined>>(),
			selectedBranchOrTag: undefined,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

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

			assertStepState<State<Repository>>(state);

			if (state.reference === 'HEAD') {
				const branch = await state.repo.git.branches.getBranch();
				state.reference = branch!;
			}

			if (steps.isAtStep(Steps.PickRef) || state.reference == null) {
				using step = steps.enterStep(Steps.PickRef);

				const result = yield* pickBranchOrTagStep(state, context, {
					placeholder: 'Choose a branch or tag to show its commit history',
					picked: context.selectedBranchOrTag?.ref,
					value: context.selectedBranchOrTag == null ? state.reference?.ref : undefined,
					ranges: true,
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
				context.selectedBranchOrTag = undefined;
			}

			if (!isRevisionReference(state.reference) || isRevisionRangeReference(state.reference)) {
				context.selectedBranchOrTag = state.reference;
			}

			context.title = `${this.title}${pad(GlyphChars.Dot, 2, 2)}${getReferenceLabel(context.selectedBranchOrTag, {
				icon: false,
			})}`;

			if (state.fileName) {
				context.title += `${pad(GlyphChars.Dot, 2, 2)}${formatPath(state.fileName, {
					fileOnly: true,
					truncateTo: quickPickTitleMaxChars - context.title.length - 3,
				})}`;
			}

			if (context.selectedBranchOrTag != null) {
				using step = steps.enterStep(Steps.PickCommit);

				const rev = context.selectedBranchOrTag.ref;

				let log = context.cache.get(rev);
				if (log == null) {
					log =
						state.fileName != null
							? state.repo.git.commits.getLogForPath(state.fileName, rev, { isFolder: false })
							: state.repo.git.commits.getLog(rev);
					context.cache.set(rev, log);
				}

				const result = yield* pickCommitStep(state, context, {
					ignoreFocusOut: true,
					log: await log,
					onDidLoadMore: log => context.cache.set(rev, Promise.resolve(log)),
					placeholder: (context, log) =>
						log == null
							? `No commits found in ${getReferenceLabel(context.selectedBranchOrTag, {
									icon: false,
								})}`
							: 'Choose a commit',
					picked: state.reference?.ref,
				});
				if (result === StepResultBreak) {
					state.reference = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.reference = result;
			}

			if (!(state.reference instanceof GitCommit) || state.reference.file != null) {
				state.reference = (await state.repo.git.commits.getCommit(state.reference.ref))!;
			}

			if (steps.isAtStepOrUnset(Steps.ShowCommit)) {
				using step = steps.enterStep(Steps.ShowCommit);

				if (state.openPickInView) {
					steps.markStepsComplete();
					void showCommitInDetailsView(state.reference as GitCommit, { pin: false, preserveFocus: false });
					break;
				}

				const result = yield* getSteps(
					this.container,
					{
						command: 'show',
						state: { repo: state.repo, reference: state.reference, fileName: state.fileName },
					},
					context,
					this.startedFrom,
				);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}

				steps.markStepsComplete();
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}
}

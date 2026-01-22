import type { Container } from '../../container.js';
import type { GitContributor } from '../../git/models/contributor.js';
import type { Repository } from '../../git/models/repository.js';
import { executeCoreCommand } from '../../system/-webview/command.js';
import { ensureArray } from '../../system/array.js';
import { normalizePath } from '../../system/path.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type { PartialStepState, StepGenerator, StepsContext, StepState } from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickContributorsStep } from '../quick-wizard/steps/contributors.js';
import { pickRepositoryStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { assertStepState } from '../quick-wizard/utils/steps.utils.js';

const Steps = {
	PickRepo: 'coauthors-pick-repo',
	PickContributors: 'coauthors-pick-contributors',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	repos: Repository[];
	activeRepo: Repository | undefined;
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

interface State<Repo = string | Repository, Contributors = GitContributor | GitContributor[]> {
	repo: Repo;
	contributors: Contributors;
}

export interface CoAuthorsGitCommandArgs {
	readonly command: 'co-authors';
	state?: Partial<State>;
}

export class CoAuthorsGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: CoAuthorsGitCommandArgs) {
		super(container, 'co-authors', 'co-authors', 'Add Co-Authors', {
			description: 'adds co-authors to a commit message',
		});

		this.initialState = { confirm: false, ...args?.state };
	}

	override get canConfirm(): boolean {
		return false;
	}

	private async execute(state: StepState<State<Repository, GitContributor[]>>) {
		const scmRepo = await state.repo.git.getOrOpenScmRepository();
		if (scmRepo == null) return;

		let message = scmRepo.inputBox.value;

		const index = message.indexOf('Co-authored-by: ');
		if (index !== -1) {
			message = message.substring(0, index - 1).trimEnd();
		}

		for (const c of ensureArray(state.contributors)) {
			let newlines;
			if (message.includes('Co-authored-by: ')) {
				newlines = '\n';
			} else if (message.length !== 0 && message.endsWith('\n')) {
				newlines = '\n\n';
			} else {
				newlines = '\n\n\n';
			}

			message += `${newlines}Co-authored-by: ${c.getCoauthor()}`;
		}

		scmRepo.inputBox.value = message;
		void (await executeCoreCommand('workbench.view.scm'));
	}

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			activeRepo: undefined,
			associatedView: this.container.views.contributors,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		const scmRepositories = await this.container.git.getOpenScmRepositories();
		if (scmRepositories.length) {
			// Filter out any repo's that are not known to the built-in git
			context.repos = context.repos.filter(repo =>
				scmRepositories.find(r => normalizePath(r.rootUri.fsPath) === repo.path),
			);

			// Ensure that the active repo is known to the built-in git
			context.activeRepo = await this.container.git.getOrOpenRepositoryForEditor();
			if (
				context.activeRepo != null &&
				!scmRepositories.some(r => r.rootUri.fsPath === context.activeRepo!.path)
			) {
				context.activeRepo = undefined;
			}
		}

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

			if (state.contributors != null && !Array.isArray(state.contributors)) {
				state.contributors = [state.contributors];
			}

			if (steps.isAtStep(Steps.PickContributors) || state.contributors == null) {
				using step = steps.enterStep(Steps.PickContributors);

				const result = yield* pickContributorsStep(state, context, {
					picked: state.contributors?.map(c => c.email)?.filter(<T>(email?: T): email is T => email != null),
					placeholder: 'Choose contributors to add as co-authors',
				});
				if (result === StepResultBreak) {
					state.contributors = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				state.contributors = result;
			}

			assertStepState<State<Repository, GitContributor[]>>(state);

			steps.markStepsComplete();
			void this.execute(state);
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}
}

import type { Container } from '../../container';
import type { GitContributor } from '../../git/models/contributor';
import type { Repository } from '../../git/models/repository';
import { normalizePath } from '../../system/path';
import { executeCoreCommand } from '../../system/vscode/command';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type { PartialStepState, StepGenerator, StepState } from '../quickCommand';
import { endSteps, QuickCommand, StepResultBreak } from '../quickCommand';
import { pickContributorsStep, pickRepositoryStep } from '../quickCommand.steps';

interface Context {
	repos: Repository[];
	activeRepo: Repository | undefined;
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

interface State {
	repo: string | Repository;
	contributors: GitContributor | GitContributor[];
}

export interface CoAuthorsGitCommandArgs {
	readonly command: 'co-authors';
	state?: Partial<State>;
}

type CoAuthorStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class CoAuthorsGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: CoAuthorsGitCommandArgs) {
		super(container, 'co-authors', 'co-authors', 'Add Co-Authors', {
			description: 'adds co-authors to a commit message',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		if (
			args?.state?.contributors != null &&
			(!Array.isArray(args.state.contributors) || args.state.contributors.length !== 0)
		) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: false,
			...args?.state,
		};
	}

	override get canConfirm() {
		return false;
	}

	async execute(state: CoAuthorStepState) {
		const repo = await this.container.git.getOrOpenScmRepository(state.repo.path);
		if (repo == null) return;

		let message = repo.inputBox.value;

		const index = message.indexOf('Co-authored-by: ');
		if (index !== -1) {
			message = message.substring(0, index - 1).trimEnd();
		}

		if (state.contributors != null && !Array.isArray(state.contributors)) {
			state.contributors = [state.contributors];
		}

		for (const c of state.contributors) {
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

		repo.inputBox.value = message;
		void (await executeCoreCommand('workbench.view.scm'));
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			activeRepo: undefined,
			associatedView: this.container.views.contributors,
			title: this.title,
		};

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

			if (state.counter < 2 || state.contributors == null) {
				const result = yield* pickContributorsStep(
					state as CoAuthorStepState,
					context,
					'Choose contributors to add as co-authors',
				);
				if (result === StepResultBreak) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.contributors = result;
			}

			endSteps(state);
			void this.execute(state as CoAuthorStepState);
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}
}

'use strict';
import { commands } from 'vscode';
import { Container } from '../../container';
import { GitContributor, Repository } from '../../git/git';
import { GitService } from '../../git/gitService';
import {
	PartialStepState,
	pickContributorsStep,
	pickRepositoryStep,
	QuickCommand,
	StepGenerator,
	StepResult,
	StepState,
} from '../quickCommand';
import { Strings } from '../../system';

interface Context {
	repos: Repository[];
	activeRepo: Repository | undefined;
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
	constructor(args?: CoAuthorsGitCommandArgs) {
		super('co-authors', 'co-authors', 'Add Co-Authors', { description: 'adds co-authors to a commit message' });

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

	get canConfirm() {
		return false;
	}

	async execute(state: CoAuthorStepState) {
		const repo = (await GitService.getBuiltInGitApi())?.repositories.find(
			r => Strings.normalizePath(r.rootUri.fsPath) === state.repo.path,
		);
		if (repo == null) return;

		let message = repo.inputBox.value;

		const index = message.indexOf('Co-authored-by: ');
		if (index !== -1) {
			message = message.substring(0, index - 1).trimRight();
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

			message += `${newlines}Co-authored-by: ${c.toCoauthor()}`;
		}

		repo.inputBox.value = message;
		void (await commands.executeCommand('workbench.view.scm'));
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
			activeRepo: undefined,
			title: this.title,
		};

		const gitApi = await GitService.getBuiltInGitApi();
		if (gitApi != null) {
			// Filter out any repo's that are not known to the built-in git
			context.repos = context.repos.filter(repo =>
				gitApi.repositories.find(r => Strings.normalizePath(r.rootUri.fsPath) === repo.path),
			);

			// Ensure that the active repo is known to the built-in git
			context.activeRepo = await Container.git.getActiveRepository();
			if (
				context.activeRepo != null &&
				!gitApi.repositories.some(r => r.rootUri.fsPath === context.activeRepo!.path)
			) {
				context.activeRepo = undefined;
			}
		}

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (
				state.counter < 1 ||
				state.repo == null ||
				typeof state.repo === 'string' ||
				!context.repos.includes(state.repo)
			) {
				if (context.repos.length === 1) {
					if (state.repo == null) {
						state.counter++;
					}
					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repo = result;
				}
			}

			if (state.counter < 2 || state.contributors == null) {
				const result = yield* pickContributorsStep(
					state as CoAuthorStepState,
					context,
					'Choose contributors to add as co-authors',
				);
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (context.repos.length === 1) {
						state.counter--;
					}

					continue;
				}

				state.contributors = result;
			}

			QuickCommand.endSteps(state);
			void this.execute(state as CoAuthorStepState);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}
}

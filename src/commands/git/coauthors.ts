/* eslint-disable no-loop-func */
'use strict';
import { commands } from 'vscode';
import { Container } from '../../container';
import { GitContributor, GitService, Repository } from '../../git/gitService';
import { QuickCommandBase, StepAsyncGenerator, StepSelection, StepState } from '../quickCommand';
import { ContributorQuickPickItem, Directive, DirectiveQuickPickItem, RepositoryQuickPickItem } from '../../quickpicks';
import { Logger } from '../../logger';
import { Strings } from '../../system';

interface State {
	repo: Repository;
	contributors: GitContributor[];
}

export interface CoAuthorsGitCommandArgs {
	readonly command: 'co-authors';
	state?: Partial<State>;

	confirm?: boolean;
}

export class CoAuthorsGitCommand extends QuickCommandBase<State> {
	constructor(args?: CoAuthorsGitCommandArgs) {
		super('co-authors', 'co-authors', 'Add Co-Authors', { description: 'adds co-authors to a commit message' });

		if (args == null || args.state === undefined) return;

		let counter = 0;
		if (args.state.repo !== undefined) {
			counter++;
		}

		if (args.state.contributors !== undefined) {
			counter++;
		}

		this._initialState = {
			counter: counter,
			confirm: args.confirm,
			...args.state,
		};
	}

	get canConfirm() {
		return false;
	}

	get hidden(): boolean {
		return true;
	}

	async execute(state: State) {
		const gitApi = await GitService.getBuiltInGitApi();
		if (gitApi === undefined) return;

		const repo = gitApi.repositories.find(r => Strings.normalizePath(r.rootUri.fsPath) === state.repo.path);
		if (repo === undefined) return;

		let message = repo.inputBox.value;

		const index = message.indexOf('Co-authored-by: ');
		if (index !== -1) {
			message = message.substring(0, index - 1).trimRight();
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

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
		let activeRepo: Repository | undefined;
		let repos;

		while (true) {
			try {
				if (repos === undefined) {
					repos = [...(await Container.git.getOrderedRepositories())];

					const gitApi = await GitService.getBuiltInGitApi();
					if (gitApi !== undefined) {
						// Filter out any repo's that are not known to the built-in git
						repos = repos.filter(repo =>
							gitApi.repositories.find(r => Strings.normalizePath(r.rootUri.fsPath) === repo.path),
						);

						// Ensure that the active repo is known to the built-in git
						activeRepo = await Container.git.getActiveRepository();
						if (
							activeRepo !== undefined &&
							!gitApi.repositories.some(r => r.rootUri.fsPath === activeRepo!.path)
						) {
							activeRepo = undefined;
						}
					}
				}

				if (state.repo === undefined || !repos.includes(state.repo) || state.counter < 1) {
					if (repos.length === 1) {
						state.counter++;
						state.repo = repos[0];
					} else {
						const active = state.repo ? state.repo : await Container.git.getActiveRepository();

						const step = this.createPickStep<RepositoryQuickPickItem>({
							title: this.title,
							placeholder: 'Choose a repository',
							items:
								repos.length === 0
									? [DirectiveQuickPickItem.create(Directive.Cancel)]
									: await Promise.all(
											repos.map(r =>
												RepositoryQuickPickItem.create(r, r.id === (active && active.id), {
													branch: true,
													fetched: true,
													status: true,
												}),
											),
									  ),
						});
						const selection: StepSelection<typeof step> = yield step;

						if (!this.canPickStepMoveNext(step, state, selection)) {
							break;
						}

						state.repo = selection[0].item;
					}
				}

				if (state.contributors === undefined || state.counter < 2) {
					const message = (await GitService.getBuiltInGitApi())?.repositories.find(
						r => Strings.normalizePath(r.rootUri.fsPath) === state.repo!.path,
					)?.inputBox.value;

					const step = this.createPickStep<ContributorQuickPickItem>({
						title: `${this.title} to ${state.repo.formattedName}`,
						allowEmpty: true,
						multiselect: true,
						placeholder: 'Choose contributors to add as co-authors',
						matchOnDescription: true,
						items: (await Container.git.getContributors(state.repo.path)).map(c =>
							ContributorQuickPickItem.create(c, message?.includes(c.toCoauthor())),
						),
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						if (repos.length === 1) {
							break;
						}
						continue;
					}

					state.contributors = selection.map(i => i.item);
				}

				await this.execute(state as State);
				break;
			} catch (ex) {
				Logger.error(ex, this.title);

				throw ex;
			}
		}

		return undefined;
	}
}

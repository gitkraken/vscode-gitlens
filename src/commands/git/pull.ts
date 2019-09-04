'use strict';
import { Container } from '../../container';
import { Repository } from '../../git/gitService';
import { QuickCommandBase, StepAsyncGenerator, StepSelection, StepState } from '../quickCommand';
import { GitFlagsQuickPickItem, RepositoryQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';
import { GlyphChars } from '../../constants';
import { Logger } from '../../logger';

interface State {
	repos: Repository[];
	flags: string[];
}

export interface PullGitCommandArgs {
	readonly command: 'pull';
	state?: Partial<State>;

	confirm?: boolean;
}

export class PullGitCommand extends QuickCommandBase<State> {
	constructor(args?: PullGitCommandArgs) {
		super('pull', 'pull', 'Pull');

		if (args == null || args.state === undefined) return;

		let counter = 0;
		if (args.state.repos !== undefined && args.state.repos.length !== 0) {
			counter++;
		}

		this._initialState = {
			counter: counter,
			confirm: args.confirm,
			...args.state
		};
	}

	execute(state: State) {
		return Container.git.pullAll(state.repos, { rebase: state.flags.includes('--rebase') });
	}

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
		let oneRepo = false;

		while (true) {
			try {
				if (state.repos === undefined || state.counter < 1) {
					const repos = [...(await Container.git.getOrderedRepositories())];

					if (repos.length === 1) {
						oneRepo = true;
						state.counter++;
						state.repos = [repos[0]];
					} else {
						const step = this.createPickStep<RepositoryQuickPickItem>({
							multiselect: true,
							title: this.title,
							placeholder: 'Choose repositories',
							items: await Promise.all(
								repos.map(repo =>
									RepositoryQuickPickItem.create(
										repo,
										state.repos ? state.repos.some(r => r.id === repo.id) : undefined,
										{
											branch: true,
											fetched: true,
											status: true
										}
									)
								)
							)
						});
						const selection: StepSelection<typeof step> = yield step;

						if (!this.canPickStepMoveNext(step, state, selection)) {
							break;
						}

						state.repos = selection.map(i => i.item);
					}
				}

				if (this.confirm(state.confirm)) {
					const step = this.createConfirmStep<GitFlagsQuickPickItem>(
						`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repos.length === 1
								? state.repos[0].formattedName
								: `${state.repos.length} repositories`
						}`,
						[
							{
								label: this.title,
								description: '',
								detail: `Will pull ${
									state.repos.length === 1
										? state.repos[0].formattedName
										: `${state.repos.length} repositories`
								}`,
								item: []
							},
							{
								label: `${this.title} with Rebase`,
								description: '--rebase',
								detail: `Will pull with rebase ${
									state.repos.length === 1
										? state.repos[0].formattedName
										: `${state.repos.length} repositories`
								}`,
								item: ['--rebase']
							}
						]
					);
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						if (oneRepo) {
							break;
						}

						continue;
					}

					state.flags = selection[0].item;
				} else {
					state.flags = state.flags || [];
				}

				this.execute(state as State);
				break;
			} catch (ex) {
				Logger.error(ex, this.title);

				throw ex;
			}
		}

		return undefined;
	}
}

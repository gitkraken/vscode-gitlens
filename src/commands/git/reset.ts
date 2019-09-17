'use strict';
/* eslint-disable no-loop-func */
import { Container } from '../../container';
import { GitReference, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { Iterables, Strings } from '../../system';
import { QuickCommandBase, QuickPickStep, StepAsyncGenerator, StepSelection, StepState } from '../quickCommand';
import {
	CommitQuickPickItem,
	Directive,
	DirectiveQuickPickItem,
	FlagsQuickPickItem,
	RepositoryQuickPickItem
} from '../../quickpicks';
import { runGitCommandInTerminal } from '../../terminal';
import { Logger } from '../../logger';

type Flags = '--hard';

interface State {
	repo: Repository;
	reference?: GitReference;
	flags: Flags[];
}

export interface ResetGitCommandArgs {
	readonly command: 'reset';
	state?: Partial<State>;
}

export class ResetGitCommand extends QuickCommandBase<State> {
	constructor(args?: ResetGitCommandArgs) {
		super('reset', 'reset', 'Reset', { description: 'resets the current branch to a specified commit' });

		if (args == null || args.state === undefined) return;

		let counter = 0;
		if (args.state.repo !== undefined) {
			counter++;
		}

		if (args.state.reference !== undefined) {
			counter++;
		}

		this._initialState = {
			counter: counter,
			confirm: true,
			...args.state
		};
	}

	get canSkipConfirm(): boolean {
		return false;
	}

	execute(state: State) {
		runGitCommandInTerminal('reset', [...state.flags, state.reference!.ref].join(' '), state.repo.path, true);
	}

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
		let repos;

		if (state.flags == null) {
			state.flags = [];
		}

		while (true) {
			try {
				if (repos === undefined) {
					repos = [...(await Container.git.getOrderedRepositories())];
				}

				if (state.repo === undefined || state.counter < 1) {
					if (repos.length === 1) {
						state.counter++;
						state.repo = repos[0];
					} else {
						const active = state.repo ? state.repo : await Container.git.getActiveRepository();

						const step = this.createPickStep<RepositoryQuickPickItem>({
							title: this.title,
							placeholder: 'Choose a repository',
							items: await Promise.all(
								repos.map(r =>
									RepositoryQuickPickItem.create(r, r.id === (active && active.id), {
										branch: true,
										fetched: true,
										status: true
									})
								)
							)
						});
						const selection: StepSelection<typeof step> = yield step;

						if (!this.canPickStepMoveNext(step, state, selection)) {
							break;
						}

						state.repo = selection[0].item;
					}
				}

				const destination = await state.repo.getBranch();
				if (destination === undefined) break;

				if (state.reference === undefined || state.counter < 2) {
					const log = await Container.git.getLog(state.repo.path, {
						ref: destination.ref,
						merges: false
					});

					const step = this.createPickStep<CommitQuickPickItem>({
						title: `${this.title} ${destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repo.formattedName
						}`,
						placeholder:
							log === undefined ? `${destination.name} has no commits` : 'Choose commit to reset to',
						matchOnDescription: true,
						matchOnDetail: true,
						items:
							log === undefined
								? [
										DirectiveQuickPickItem.create(Directive.Back, true),
										DirectiveQuickPickItem.create(Directive.Cancel)
								  ]
								: [
										...Iterables.map(log.commits.values(), commit =>
											CommitQuickPickItem.create(
												commit,
												state.reference ? state.reference.ref === commit.ref : undefined,
												{ compact: true, icon: true }
											)
										)
								  ]
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						if (repos.length === 1) {
							break;
						}
						continue;
					}

					state.reference = selection[0].item;
				}

				const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
					`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					[
						FlagsQuickPickItem.create<Flags>(state.flags, [], {
							label: `Soft ${this.title}`,
							description: `--soft ${destination.name} to ${state.reference.name}`,
							detail: `Will soft reset (leaves changes in the working tree) ${destination.name} to ${state.reference.name}`
						}),
						FlagsQuickPickItem.create<Flags>(state.flags, ['--hard'], {
							label: `Hard ${this.title}`,
							description: `--hard ${destination.name} to ${state.reference.name}`,
							detail: `Will hard reset (discards all changes) ${destination.name} to ${state.reference.name}`
						})
					]
				);
				const selection: StepSelection<typeof step> = yield step;

				if (!this.canPickStepMoveNext(step, state, selection)) {
					continue;
				}

				state.flags = selection[0].item;

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

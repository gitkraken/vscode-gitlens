'use strict';
import { Container } from '../../container';
import { Repository } from '../../git/gitService';
import { QuickCommandBase, QuickPickStep, StepAsyncGenerator, StepSelection, StepState } from '../quickCommand';
import { Directive, DirectiveQuickPickItem, FlagsQuickPickItem, RepositoryQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';
import { GlyphChars } from '../../constants';
import { Logger } from '../../logger';

type Flags = '--force';

interface State {
	repos: Repository[];
	flags: Flags[];
}

export interface PushGitCommandArgs {
	readonly command: 'push';
	state?: Partial<State>;

	confirm?: boolean;
}

export class PushGitCommand extends QuickCommandBase<State> {
	constructor(args?: PushGitCommandArgs) {
		super('push', 'push', 'Push', {
			description: 'pushes changes from the current branch to a remote',
		});

		if (args == null || args.state === undefined) return;

		let counter = 0;
		if (args.state.repos !== undefined && args.state.repos.length !== 0) {
			counter++;
		}

		this._initialState = {
			counter: counter,
			confirm: args.confirm,
			...args.state,
		};
	}

	execute(state: State) {
		return Container.git.pushAll(state.repos, { force: state.flags.includes('--force') });
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

				if (state.repos === undefined || state.counter < 1) {
					if (repos.length === 1) {
						state.counter++;
						state.repos = [repos[0]];
					} else {
						let actives: Repository[];
						if (state.repos) {
							actives = state.repos;
						} else {
							const active = await Container.git.getActiveRepository();
							actives = active ? [active] : [];
						}

						const step = this.createPickStep<RepositoryQuickPickItem>({
							multiselect: true,
							title: this.title,
							placeholder: 'Choose repositories',
							items: await Promise.all(
								repos.map(repo =>
									RepositoryQuickPickItem.create(
										repo,
										actives.some(r => r.id === repo.id),
										{
											branch: true,
											fetched: true,
											status: true,
										},
									),
								),
							),
						});
						const selection: StepSelection<typeof step> = yield step;

						if (!this.canPickStepMoveNext(step, state, selection)) {
							break;
						}

						state.repos = selection.map(i => i.item);
					}
				}

				if (this.confirm(state.confirm)) {
					let step: QuickPickStep<FlagsQuickPickItem<Flags>>;
					if (state.repos.length > 1) {
						step = this.createConfirmStep(
							`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
								state.repos.length
							} repositories`,
							[
								FlagsQuickPickItem.create<Flags>(state.flags, [], {
									label: this.title,
									description: '',
									detail: `Will push ${state.repos.length} repositories`,
								}),
								FlagsQuickPickItem.create<Flags>(state.flags, ['--force'], {
									label: `Force ${this.title}`,
									description: '--force',
									detail: `Will force push ${state.repos.length} repositories`,
								}),
							],
						);
					} else {
						step = await this.getSingleRepoConfirmStep(state);
					}

					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						if (repos.length === 1) {
							break;
						}

						continue;
					}

					state.flags = selection[0].item;
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

	private async getSingleRepoConfirmStep(state: StepState<State>) {
		const repo = state.repos![0];
		const status = await repo.getStatus();

		let detail = repo.formattedName;
		if (status !== undefined) {
			if (status.state.ahead === 0) {
				return this.createConfirmStep(
					`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${repo.formattedName}`,
					[],
					DirectiveQuickPickItem.create(Directive.Cancel, true, {
						label: `Cancel ${this.title}`,
						detail: 'No commits to push',
					}),
				);
			}

			detail = Strings.pluralize('commit', status.state.ahead);
		}

		return this.createConfirmStep(
			`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${repo.formattedName}`,
			[
				FlagsQuickPickItem.create<Flags>(state.flags!, [], {
					label: this.title,
					description: '',
					detail: `Will push ${detail}`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags!, ['--force'], {
					label: `Force ${this.title}`,
					description: '--force',
					detail: `Will force push ${detail}`,
				}),
			],
		);
	}
}

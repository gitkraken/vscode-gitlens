'use strict';
import { Container } from '../../container';
import { GitReference, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import {
	getBranchesAndOrTags,
	getValidateGitReferenceFn,
	QuickCommandBase,
	QuickPickStep,
	StepAsyncGenerator,
	StepSelection,
	StepState
} from '../quickCommand';
import {
	Directive,
	DirectiveQuickPickItem,
	FlagsQuickPickItem,
	ReferencesQuickPickItem,
	RepositoryQuickPickItem
} from '../../quickpicks';
import { Strings } from '../../system';
import { Logger } from '../../logger';

type Flags = '--ff-only' | '--no-ff' | '--squash';

interface State {
	repo: Repository;
	reference: GitReference;
	flags: Flags[];
}

export interface MergeGitCommandArgs {
	readonly command: 'merge';
	state?: Partial<State>;
}

export class MergeGitCommand extends QuickCommandBase<State> {
	constructor(args?: MergeGitCommandArgs) {
		super('merge', 'merge', 'Merge', {
			description: 'integrates changes from a specified branch into the current branch'
		});

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
		return state.repo.merge(...state.flags, state.reference.ref);
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
					const destId = destination.id;

					const step = this.createPickStep<ReferencesQuickPickItem>({
						title: `${this.title} into ${destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repo.formattedName
						}`,
						placeholder: `Choose a branch or tag to merge into ${destination.name}${GlyphChars.Space.repeat(
							3
						)}(select or enter a reference)`,
						matchOnDescription: true,
						matchOnDetail: true,
						items: await getBranchesAndOrTags(state.repo, true, {
							filterBranches: b => b.id !== destId,
							picked: state.reference && state.reference.ref
						}),
						onValidateValue: getValidateGitReferenceFn(state.repo)
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

				const count =
					(await Container.git.getCommitCount(state.repo.path, [
						`${destination.name}..${state.reference.name}`
					])) || 0;
				if (count === 0) {
					const step = this.createConfirmStep(
						`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
						[],

						DirectiveQuickPickItem.create(Directive.Cancel, true, {
							label: `Cancel ${this.title}`,
							detail: `${destination.name} is up to date with ${state.reference.name}`
						})
					);
					yield step;

					break;
				}

				const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
					`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					[
						FlagsQuickPickItem.create<Flags>(state.flags, [], {
							label: this.title,
							description: `${state.reference.name} into ${destination.name}`,
							detail: `Will merge ${Strings.pluralize('commit', count)} from ${
								state.reference.name
							} into ${destination.name}`
						}),
						FlagsQuickPickItem.create<Flags>(state.flags, ['--ff-only'], {
							label: `Fast-forward ${this.title}`,
							description: `--ff-only ${state.reference.name} into ${destination.name}`,
							detail: `Will fast-forward merge ${Strings.pluralize('commit', count)} from ${
								state.reference.name
							} into ${destination.name}`
						}),
						FlagsQuickPickItem.create<Flags>(state.flags, ['--no-ff'], {
							label: `No Fast-forward ${this.title}`,
							description: `--no-ff ${state.reference.name} into ${destination.name}`,
							detail: `Will create a merge commit when merging ${Strings.pluralize(
								'commit',
								count
							)} from ${state.reference.name} into ${destination.name}`
						}),
						FlagsQuickPickItem.create<Flags>(state.flags, ['--squash'], {
							label: `Squash ${this.title}`,
							description: `--squash ${state.reference.name} into ${destination.name}`,
							detail: `Will squash ${Strings.pluralize('commit', count)} from ${
								state.reference.name
							} into one when merging into ${destination.name}`
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

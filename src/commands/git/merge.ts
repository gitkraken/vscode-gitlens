'use strict';
import { Container } from '../../container';
import { GitReference, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import {
	getBranchesAndOrTags,
	getValidateGitReferenceFn,
	QuickCommandBase,
	StepAsyncGenerator,
	StepSelection,
	StepState
} from '../quickCommand';
import {
	Directive,
	DirectiveQuickPickItem,
	GitFlagsQuickPickItem,
	ReferencesQuickPickItem,
	RepositoryQuickPickItem
} from '../../quickpicks';
import { Strings } from '../../system';
import { runGitCommandInTerminal } from '../../terminal';
import { Logger } from '../../logger';

interface State {
	repo: Repository;
	reference: GitReference;
	flags: string[];
}

export interface MergeGitCommandArgs {
	readonly command: 'merge';
	state?: Partial<State>;
}

export class MergeGitCommand extends QuickCommandBase<State> {
	constructor(args?: MergeGitCommandArgs) {
		super('merge', 'merge', 'Merge', { description: 'via Terminal' });

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
		runGitCommandInTerminal('merge', [...state.flags, state.reference.ref].join(' '), state.repo.path, true);
	}

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
		let oneRepo = false;

		while (true) {
			try {
				if (state.repo === undefined || state.counter < 1) {
					const repos = [...(await Container.git.getOrderedRepositories())];

					if (repos.length === 1) {
						oneRepo = true;
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
						if (oneRepo) {
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
						{
							cancel: DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: `Cancel ${this.title}`,
								detail: `${destination.name} is up to date with ${state.reference.name}`
							})
						}
					);

					yield step;
					break;
				}

				const step = this.createConfirmStep<GitFlagsQuickPickItem>(
					`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					[
						{
							label: this.title,
							description: `${state.reference.name} into ${destination.name}`,
							detail: `Will merge ${Strings.pluralize('commit', count)} from ${
								state.reference.name
							} into ${destination.name}`,
							item: []
						},
						{
							label: `Fast-forward ${this.title}`,
							description: `--ff-only ${state.reference.name} into ${destination.name}`,
							detail: `Will fast-forward merge ${Strings.pluralize('commit', count)} from ${
								state.reference.name
							} into ${destination.name}`,
							item: ['--ff-only']
						},
						{
							label: `No Fast-forward ${this.title}`,
							description: `--no-ff ${state.reference.name} into ${destination.name}`,
							detail: `Will create a merge commit when merging ${Strings.pluralize(
								'commit',
								count
							)} from ${state.reference.name} into ${destination.name}`,
							item: ['--no-ff']
						},
						{
							label: `Squash ${this.title}`,
							description: `--squash ${state.reference.name} into ${destination.name}`,
							detail: `Will squash ${Strings.pluralize('commit', count)} from ${
								state.reference.name
							} into one when merging into ${destination.name}`,
							item: ['--squash']
						}
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

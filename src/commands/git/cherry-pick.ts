'use strict';
/* eslint-disable no-loop-func */
import { Container } from '../../container';
import { GitReference, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { Iterables, Strings } from '../../system';
import {
	getBranchesAndOrTags,
	getValidateGitReferenceFn,
	QuickCommandBase,
	StepAsyncGenerator,
	StepSelection,
	StepState
} from '../quickCommand';
import {
	CommitQuickPickItem,
	Directive,
	DirectiveQuickPickItem,
	GitFlagsQuickPickItem,
	ReferencesQuickPickItem,
	RepositoryQuickPickItem
} from '../../quickpicks';
import { runGitCommandInTerminal } from '../../terminal';
import { Logger } from '../../logger';

interface State {
	repo: Repository;
	references?: GitReference[];
	flags: string[];
}

export interface CherryPickGitCommandArgs {
	readonly command: 'cherry-pick';
	state?: Partial<State>;
}

export class CherryPickGitCommand extends QuickCommandBase<State> {
	constructor(args?: CherryPickGitCommandArgs) {
		super('cherry-pick', 'cherry-pick', 'Cherry Pick', { description: 'via Terminal' });

		if (args == null || args.state === undefined) return;

		let counter = 0;
		if (args.state.repo !== undefined) {
			counter++;
		}

		if (args.state.references !== undefined) {
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
		runGitCommandInTerminal(
			'cherry-pick',
			[...state.flags, ...state.references!.map(c => c.ref).reverse()].join(' '),
			state.repo.path,
			true
		);
	}

	isMatch(name: string) {
		return super.isMatch(name) || name === 'cherry';
	}

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
		let oneRepo = false;
		let selectedBranchOrTag: GitReference | undefined;

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

				if (state.references === undefined || state.counter < 2) {
					const destId = destination.id;

					const step = this.createPickStep<ReferencesQuickPickItem>({
						title: `${this.title} into ${destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repo.formattedName
						}`,
						placeholder: `Choose a branch or tag to cherry-pick from${GlyphChars.Space.repeat(
							3
						)}(select or enter a reference)`,
						matchOnDescription: true,
						matchOnDetail: true,
						items: await getBranchesAndOrTags(state.repo, true, {
							filterBranches: b => b.id !== destId
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

					if (GitReference.isOfRefType(selection[0].item)) {
						state.references = [selection[0].item];
						selectedBranchOrTag = undefined;
					} else {
						selectedBranchOrTag = selection[0].item;
					}
				}

				if (selectedBranchOrTag !== undefined && state.counter < 3) {
					const log = await Container.git.getLog(state.repo.path, {
						ref: `${destination.ref}..${selectedBranchOrTag.ref}`,
						merges: false
					});

					const step = this.createPickStep<CommitQuickPickItem>({
						title: `${this.title} onto ${destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repo.formattedName
						}`,
						multiselect: log !== undefined,
						placeholder:
							log === undefined
								? `${selectedBranchOrTag.name} has no pickable commits`
								: `Choose commits to cherry-pick onto ${destination.name}`,
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
												state.references
													? state.references.some(r => r.ref === commit.ref)
													: undefined,
												{ compact: true, icon: true }
											)
										)
								  ]
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						continue;
					}

					state.references = selection.map(i => i.item);
				}

				const step = this.createConfirmStep<GitFlagsQuickPickItem>(
					`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					[
						{
							label: this.title,
							description: `${
								state.references!.length === 1
									? state.references![0].name
									: `${state.references!.length} commits`
							} onto ${destination.name}`,
							detail: `Will apply ${
								state.references!.length === 1
									? `commit ${state.references![0].name}`
									: `${state.references!.length} commits`
							} onto ${destination.name}`,
							item: []
						},
						{
							label: `${this.title} & Edit`,
							description: `--edit ${
								state.references!.length === 1
									? state.references![0].name
									: `${state.references!.length} commits`
							} onto ${destination.name}`,
							detail: `Will edit and apply ${
								state.references!.length === 1
									? `commit ${state.references![0].name}`
									: `${state.references!.length} commits`
							} onto ${destination.name}`,
							item: ['--edit']
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

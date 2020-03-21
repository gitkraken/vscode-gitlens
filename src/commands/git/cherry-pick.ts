'use strict';
/* eslint-disable no-loop-func */
import { Container } from '../../container';
import { GitReference, GitRevision, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { Iterables, Strings } from '../../system';
import {
	getBranchesAndOrTags,
	getValidateGitReferenceFn,
	QuickCommandBase,
	QuickPickStep,
	StepAsyncGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import {
	CommitQuickPickItem,
	Directive,
	DirectiveQuickPickItem,
	FlagsQuickPickItem,
	ReferencesQuickPickItem,
	RepositoryQuickPickItem,
} from '../../quickpicks';
import { Logger } from '../../logger';

type Flags = '--edit';

interface State {
	repo: Repository;
	references?: GitReference[];
	flags: Flags[];
}

export interface CherryPickGitCommandArgs {
	readonly command: 'cherry-pick';
	state?: Partial<State>;
}

export class CherryPickGitCommand extends QuickCommandBase<State> {
	constructor(args?: CherryPickGitCommandArgs) {
		super('cherry-pick', 'cherry-pick', 'Cherry Pick', {
			description: 'integrates changes from specified commits into the current branch',
		});

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
			...args.state,
		};
	}

	get canSkipConfirm(): boolean {
		return false;
	}

	execute(state: State) {
		return state.repo.cherryPick(...state.flags, ...state.references!.map(c => c.ref).reverse());
	}

	isMatch(name: string) {
		return super.isMatch(name) || name === 'cherry';
	}

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
		let repos;
		let selectedBranchOrTag: GitReference | undefined;

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

				const destination = await state.repo.getBranch();
				if (destination === undefined) break;

				if (state.references === undefined || state.counter < 2) {
					const destId = destination.id;

					const step = this.createPickStep<ReferencesQuickPickItem>({
						title: `${this.title} into ${destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repo.formattedName
						}`,
						placeholder: `Choose a branch or tag to cherry-pick from${GlyphChars.Space.repeat(
							3,
						)}(select or enter a reference)`,
						matchOnDescription: true,
						matchOnDetail: true,
						items: await getBranchesAndOrTags(state.repo, ['branches', 'tags'], {
							filterBranches: b => b.id !== destId,
						}),
						onValidateValue: getValidateGitReferenceFn(state.repo),
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						if (repos.length === 1) {
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
						ref: GitRevision.createRange(destination.ref, selectedBranchOrTag.ref),
						merges: false,
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
										DirectiveQuickPickItem.create(Directive.Cancel),
								  ]
								: [
										...Iterables.map(log.commits.values(), commit =>
											CommitQuickPickItem.create(
												commit,
												state.references
													? state.references.some(r => r.ref === commit.ref)
													: undefined,
												{ compact: true, icon: true },
											),
										),
								  ],
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						continue;
					}

					state.references = selection.map(i => i.item);
				}

				const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
					`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					[
						FlagsQuickPickItem.create<Flags>(state.flags, [], {
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
						}),
						FlagsQuickPickItem.create<Flags>(state.flags, ['--edit'], {
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
						}),
					],
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

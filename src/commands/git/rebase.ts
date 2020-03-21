'use strict';
import { Container } from '../../container';
import { GitReference, GitRevision, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import {
	getBranchesAndOrTags,
	getValidateGitReferenceFn,
	QuickCommandBase,
	QuickPickStep,
	StepAsyncGenerator,
	StepSelection,
	StepState,
	ToggleQuickInputButton,
} from '../quickCommand';
import {
	CommitQuickPickItem,
	Directive,
	DirectiveQuickPickItem,
	FlagsQuickPickItem,
	ReferencesQuickPickItem,
	RefQuickPickItem,
	RepositoryQuickPickItem,
} from '../../quickpicks';
import { Iterables, Strings } from '../../system';
import { Logger } from '../../logger';

type Flags = '--interactive';

interface State {
	repo: Repository;
	reference: GitReference;
	flags: Flags[];
}

export interface RebaseGitCommandArgs {
	readonly command: 'rebase';
	state?: Partial<State>;
}

export class RebaseGitCommand extends QuickCommandBase<State> {
	private readonly Buttons = class {
		static readonly PickBranchOrCommit = class extends ToggleQuickInputButton {
			constructor(on = false) {
				super(
					{ tooltip: 'Use the selected Branch or Tag', icon: 'branch' },
					{ tooltip: 'Choose a commit from the selected Branch or Tag', icon: 'commit' },
					on,
				);
			}
		};
	};

	constructor(args?: RebaseGitCommandArgs) {
		super('rebase', 'rebase', 'Rebase', {
			description:
				'integrates changes from a specified branch into the current branch, by changing the base of the branch and reapplying the commits on top',
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
			...args.state,
		};
	}

	get canSkipConfirm(): boolean {
		return false;
	}

	execute(state: State) {
		return state.repo.rebase(...state.flags, state.reference.ref);
	}

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
		let repos;
		let selectedBranchOrTag: GitReference | undefined;
		let pickCommit = false;

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

				if (state.reference === undefined || state.counter < 2) {
					const pickBranchOrCommitButton: ToggleQuickInputButton = new this.Buttons.PickBranchOrCommit(
						pickCommit,
					);

					const step = this.createPickStep<ReferencesQuickPickItem>({
						title: `${this.title} ${destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repo.formattedName
						}`,
						placeholder: `Choose a branch or tag to rebase ${
							destination.name
						} onto${GlyphChars.Space.repeat(3)}(select or enter a reference)`,
						matchOnDescription: true,
						matchOnDetail: true,
						items: await getBranchesAndOrTags(state.repo, ['branches', 'tags'], {
							picked: state.reference && state.reference.ref,
						}),
						additionalButtons: [pickBranchOrCommitButton],
						// eslint-disable-next-line no-loop-func
						onDidClickButton: (quickpick, button) => {
							pickCommit = !pickCommit;
							pickBranchOrCommitButton.on = pickCommit;
						},
						onValidateValue: getValidateGitReferenceFn(state.repo),
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						if (repos.length === 1) {
							break;
						}
						continue;
					}

					state.reference = selection[0].item;
					if (state.reference.ref === destination.ref) {
						pickCommit = true;
					}

					selectedBranchOrTag = state.reference;
				}

				if (pickCommit && selectedBranchOrTag !== undefined && state.counter < 3) {
					const log = await Container.git.getLog(state.repo.path, {
						ref: selectedBranchOrTag.ref,
						merges: false,
					});

					const step = this.createPickStep<CommitQuickPickItem | RefQuickPickItem>({
						title: `${this.title} ${destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repo.formattedName
						}`,
						placeholder:
							log === undefined
								? `${selectedBranchOrTag.name} has no commits`
								: `Choose a commit to rebase ${destination.name} onto`,
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
											CommitQuickPickItem.create(commit, undefined, {
												compact: true,
												icon: true,
											}),
										),
								  ],
						onValidateValue: getValidateGitReferenceFn(state.repo),
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						continue;
					}

					state.reference = GitReference.create(selection[0].item.ref);
				}

				const count =
					(await Container.git.getCommitCount(state.repo.path, [
						GitRevision.createRange(state.reference.ref, destination.ref),
					])) || 0;
				if (count === 0) {
					const step = this.createConfirmStep(
						`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
						[],
						DirectiveQuickPickItem.create(Directive.Cancel, true, {
							label: `Cancel ${this.title}`,
							detail: `${destination.name} is up to date with ${state.reference.name}`,
						}),
					);
					yield step;

					break;
				}

				const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
					`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					[
						FlagsQuickPickItem.create<Flags>(state.flags, [], {
							label: this.title,
							description: `${destination.name} with ${state.reference.name}`,
							detail: `Will update ${destination.name} by applying ${Strings.pluralize(
								'commit',
								count,
							)} on top of ${state.reference.name}`,
						}),
						FlagsQuickPickItem.create<Flags>(state.flags, ['--interactive'], {
							label: `Interactive ${this.title}`,
							description: `--interactive ${destination.name} with ${state.reference.name}`,
							detail: `Will interactively update ${destination.name} by applying ${Strings.pluralize(
								'commit',
								count,
							)} on top of ${state.reference.name}`,
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

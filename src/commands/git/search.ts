'use strict';
/* eslint-disable no-loop-func */
import { QuickInputButton } from 'vscode';
import { Container } from '../../container';
import { GitLog, GitLogCommit, GitService, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { QuickCommandBase, StepAsyncGenerator, StepSelection, StepState } from '../quickCommand';
import { RepositoryQuickPickItem } from '../../quickpicks';
import { Iterables, Mutable, Strings } from '../../system';
import { Logger } from '../../logger';
import {
	CommitQuickPickItem,
	Directive,
	DirectiveQuickPickItem,
	QuickPickItemOfT
} from '../../quickpicks/gitQuickPicks';

interface State {
	repo: Repository;
	search: string;
	matchAll: boolean;
	matchCase: boolean;
	matchRegex: boolean;
	showInView: boolean;
}

export interface SearchGitCommandArgs {
	readonly command: 'search';
	state?: Partial<State>;

	confirm?: boolean;
	prefillOnly?: boolean;
}

const searchOperators = new Set<string>(['', 'author:', 'change:', 'commit:', 'file:']);
const searchOperatorToTitleMap = new Map<string, string>([
	['', 'Search by Message'],
	['author:', 'Search by Author or Committer'],
	['change:', 'Search by Changes'],
	['commit:', 'Search by Commit ID'],
	['file:', 'Search by File']
]);

export class SearchGitCommand extends QuickCommandBase<State> {
	constructor(args?: SearchGitCommandArgs) {
		super('search', 'search', 'Search', {
			description: 'aka grep, searches for commits'
		});

		if (args == null || args.state === undefined) return;

		let counter = 0;
		if (args.state.repo !== undefined) {
			counter++;
		}

		if (args.state.search !== undefined && !args.prefillOnly) {
			counter++;
		}

		this._initialState = {
			counter: counter,
			confirm: args.confirm,
			...args.state
		};
	}

	get canConfirm(): boolean {
		return false;
	}

	isMatch(name: string) {
		return super.isMatch(name) || name === 'grep';
	}

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
		let oneRepo = false;
		let pickedCommit: GitLogCommit | undefined;
		let resultsKey: string | undefined;
		let resultsPromise: Promise<GitLog | undefined> | undefined;

		const cfg = Container.config.gitCommands.search;
		if (state.matchAll === undefined) {
			state.matchAll = cfg.matchAll;
		}
		if (state.matchCase === undefined) {
			state.matchCase = cfg.matchCase;
		}
		if (state.matchRegex === undefined) {
			state.matchRegex = cfg.matchRegex;
		}
		if (state.showInView === undefined) {
			state.showInView = cfg.showInView;
		}

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
							multiselect: true,
							title: this.title,
							placeholder: 'Choose repositories',
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

				if (state.search === undefined || state.counter < 2) {
					const items: QuickPickItemOfT<string>[] = [
						{
							label: searchOperatorToTitleMap.get('')!,
							description: `pattern ${GlyphChars.Dash} use quotes to search for phrases`,
							item: ''
						},
						{
							label: searchOperatorToTitleMap.get('author:')!,
							description: 'author: pattern',
							item: 'author:'
						},
						{
							label: searchOperatorToTitleMap.get('commit:')!,
							description: 'commit: sha',
							item: 'commit:'
						},
						{
							label: searchOperatorToTitleMap.get('file:')!,
							description: 'file: glob',
							item: 'file:'
						},
						{
							label: searchOperatorToTitleMap.get('change:')!,
							description: 'change: pattern',
							item: 'change:'
						}
					];
					const titleSuffix = `${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`;

					const matchCaseButton: Mutable<QuickInputButton> = {
						iconPath: state.matchCase
							? {
									dark: Container.context.asAbsolutePath(
										'images/dark/icon-match-case-selected.svg'
									) as any,
									light: Container.context.asAbsolutePath(
										'images/light/icon-match-case-selected.svg'
									) as any
							  }
							: {
									dark: Container.context.asAbsolutePath('images/dark/icon-match-case.svg') as any,
									light: Container.context.asAbsolutePath('images/light/icon-match-case.svg') as any
							  },
						tooltip: 'Match Case'
					};

					const matchAllButton: Mutable<QuickInputButton> = {
						iconPath: state.matchAll
							? {
									dark: Container.context.asAbsolutePath(
										'images/dark/icon-match-all-selected.svg'
									) as any,
									light: Container.context.asAbsolutePath(
										'images/light/icon-match-all-selected.svg'
									) as any
							  }
							: {
									dark: Container.context.asAbsolutePath('images/dark/icon-match-all.svg') as any,
									light: Container.context.asAbsolutePath('images/light/icon-match-all.svg') as any
							  },
						tooltip: 'Match All'
					};

					const matchRegexButton: Mutable<QuickInputButton> = {
						iconPath: state.matchRegex
							? {
									dark: Container.context.asAbsolutePath(
										'images/dark/icon-match-regex-selected.svg'
									) as any,
									light: Container.context.asAbsolutePath(
										'images/light/icon-match-regex-selected.svg'
									) as any
							  }
							: {
									dark: Container.context.asAbsolutePath('images/dark/icon-match-regex.svg') as any,
									light: Container.context.asAbsolutePath('images/light/icon-match-regex.svg') as any
							  },
						tooltip: 'Match using Regular Expressions'
					};

					const showInViewButton: Mutable<QuickInputButton> = {
						iconPath: state.showInView
							? {
									dark: Container.context.asAbsolutePath('images/dark/icon-eye-selected.svg') as any,
									light: Container.context.asAbsolutePath('images/light/icon-eye-selected.svg') as any
							  }
							: {
									dark: Container.context.asAbsolutePath('images/dark/icon-eye.svg') as any,
									light: Container.context.asAbsolutePath('images/light/icon-eye.svg') as any
							  },
						tooltip: 'Show Results in the Search Commits View'
					};

					const step = this.createPickStep<QuickPickItemOfT<string>>({
						title: `${this.title}${titleSuffix}`,
						placeholder: 'e.g. "Updates dependencies" author:eamodio',
						matchOnDescription: true,
						matchOnDetail: true,
						additionalButtons: [matchCaseButton, matchAllButton, matchRegexButton, showInViewButton],
						items: items,
						value: state.search,
						onDidAccept: (quickpick): boolean => {
							const pick = quickpick.selectedItems[0];
							if (!searchOperators.has(pick.item)) return true;

							const value = quickpick.value.trim();
							if (value.length === 0 || searchOperators.has(value)) {
								quickpick.value = pick.item;
							} else {
								quickpick.value = `${value} ${pick.item}`;
							}

							void step.onDidChangeValue!(quickpick);

							return false;
						},
						onDidClickButton: (quickpick, button) => {
							if (button === matchCaseButton) {
								state.matchCase = !state.matchCase;
								matchCaseButton.iconPath = state.matchCase
									? {
											dark: Container.context.asAbsolutePath(
												'images/dark/icon-match-case-selected.svg'
											) as any,
											light: Container.context.asAbsolutePath(
												'images/light/icon-match-case-selected.svg'
											) as any
									  }
									: {
											dark: Container.context.asAbsolutePath(
												'images/dark/icon-match-case.svg'
											) as any,
											light: Container.context.asAbsolutePath(
												'images/light/icon-match-case.svg'
											) as any
									  };

								return;
							}

							if (button === matchAllButton) {
								state.matchAll = !state.matchAll;
								matchAllButton.iconPath = state.matchAll
									? {
											dark: Container.context.asAbsolutePath(
												'images/dark/icon-match-all-selected.svg'
											) as any,
											light: Container.context.asAbsolutePath(
												'images/light/icon-match-all-selected.svg'
											) as any
									  }
									: {
											dark: Container.context.asAbsolutePath(
												'images/dark/icon-match-all.svg'
											) as any,
											light: Container.context.asAbsolutePath(
												'images/light/icon-match-all.svg'
											) as any
									  };

								return;
							}

							if (button === matchRegexButton) {
								state.matchRegex = !state.matchRegex;
								matchRegexButton.iconPath = state.matchRegex
									? {
											dark: Container.context.asAbsolutePath(
												'images/dark/icon-match-regex-selected.svg'
											) as any,
											light: Container.context.asAbsolutePath(
												'images/light/icon-match-regex-selected.svg'
											) as any
									  }
									: {
											dark: Container.context.asAbsolutePath(
												'images/dark/icon-match-regex.svg'
											) as any,
											light: Container.context.asAbsolutePath(
												'images/light/icon-match-regex.svg'
											) as any
									  };

								return;
							}

							if (button === showInViewButton) {
								state.showInView = !state.showInView;
								showInViewButton.iconPath = state.showInView
									? {
											dark: Container.context.asAbsolutePath(
												'images/dark/icon-eye-selected.svg'
											) as any,
											light: Container.context.asAbsolutePath(
												'images/light/icon-eye-selected.svg'
											) as any
									  }
									: {
											dark: Container.context.asAbsolutePath('images/dark/icon-eye.svg') as any,
											light: Container.context.asAbsolutePath('images/light/icon-eye.svg') as any
									  };
							}
						},
						onDidChangeValue: (quickpick): boolean => {
							const operations = GitService.parseSearchOperations(quickpick.value.trim());

							quickpick.title =
								operations.size === 0 || operations.size > 1
									? `${this.title}${titleSuffix}`
									: `${searchOperatorToTitleMap.get(operations.keys().next().value)!}${titleSuffix}`;

							if (quickpick.value.length === 0) {
								quickpick.items = items;
							} else {
								quickpick.items = [
									{
										label: 'Search for commits matching',
										description: quickpick.value,
										item: quickpick.value
									}
								];
							}

							return true;
						}
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						if (oneRepo) {
							break;
						}

						continue;
					}

					state.search = selection[0].item.trim();
				}

				const search = {
					pattern: state.search,
					matchAll: state.matchAll,
					matchCase: state.matchCase,
					matchRegex: state.matchRegex
				};
				const searchKey = JSON.stringify(search);

				if (resultsPromise === undefined || resultsKey !== searchKey) {
					resultsPromise = Container.git.getLogForSearch(state.repo.path, search);
					resultsKey = searchKey;
				}

				if (state.showInView) {
					void Container.searchView.search(
						state.repo.path,
						search,
						{
							label: { label: `commits matching: ${state.search}` }
						},
						resultsPromise
					);

					break;
				}

				const results = await resultsPromise;

				const openInViewButton: QuickInputButton = {
					iconPath: {
						dark: Container.context.asAbsolutePath('images/dark/icon-link.svg') as any,
						light: Container.context.asAbsolutePath('images/light/icon-link.svg') as any
					},
					tooltip: 'Open Results in the Search Commits View'
				};

				const step = this.createPickStep<CommitQuickPickItem>({
					title: `${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					placeholder:
						results === undefined
							? `No results for commits matching: ${state.search}`
							: `${Strings.pluralize('result', results.count, {
									number: results.truncated ? `${results.count}+` : undefined
							  })} for commits matching: ${state.search}`,
					matchOnDescription: true,
					matchOnDetail: true,
					items:
						results === undefined
							? [
									DirectiveQuickPickItem.create(Directive.Back, true),
									DirectiveQuickPickItem.create(Directive.Cancel)
							  ]
							: [
									...Iterables.map(results.commits.values(), commit =>
										CommitQuickPickItem.create(
											commit,
											commit.ref === (pickedCommit && pickedCommit.ref),
											{ compact: true, icon: true }
										)
									)
							  ],
					additionalButtons: [openInViewButton],
					onDidClickButton: (quickpick, button) => {
						if (button !== openInViewButton) return;

						void Container.searchView.search(
							state.repo!.path,
							search,
							{
								label: { label: `commits matching: ${state.search}` }
							},
							results
						);
					}
				});
				const selection: StepSelection<typeof step> = yield step;

				if (!this.canPickStepMoveNext(step, state, selection)) {
					continue;
				}

				state.counter--;
				pickedCommit = selection[0].item;

				void Container.searchView.search(
					pickedCommit.repoPath,
					{ pattern: `commit:${pickedCommit.sha}` },
					{
						label: { label: `commits matching: commit:${pickedCommit.shortSha}` }
					}
				);

				// const gitCommandArgs: GitCommandsCommandArgs = {
				// 	command: 'search',
				// 	state: { ...state }
				// };

				// const commandArgs: ShowQuickCommitDetailsCommandArgs = {
				// 	sha: commit.sha,
				// 	commit: commit,
				// 	goBackCommand: new CommandQuickPickItem(
				// 		{
				// 			label: 'Back',
				// 			description: ''
				// 		},
				// 		Commands.GitCommands,
				// 		[gitCommandArgs]
				// 	)
				// };

				// void commands.executeCommand(Commands.ShowQuickCommitDetails, commit.toGitUri(), commandArgs);

				// break;
			} catch (ex) {
				Logger.error(ex, this.title);

				throw ex;
			}
		}

		return undefined;
	}
}

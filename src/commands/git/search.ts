'use strict';
/* eslint-disable no-loop-func */
import { QuickInputButton } from 'vscode';
import { Container } from '../../container';
import {
	GitLog,
	GitLogCommit,
	GitService,
	Repository,
	searchOperators,
	SearchOperators,
	SearchPattern
} from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { QuickCommandBase, StepAsyncGenerator, StepSelection, StepState } from '../quickCommand';
import { CommandQuickPickItem, CommitQuickPick, RepositoryQuickPickItem } from '../../quickpicks';
import { Iterables, Mutable, Strings } from '../../system';
import { Logger } from '../../logger';
import {
	CommitQuickPickItem,
	Directive,
	DirectiveQuickPickItem,
	QuickPickItemOfT
} from '../../quickpicks/gitQuickPicks';

interface State extends Required<SearchPattern> {
	repo: Repository;
	showInView: boolean;
}

export interface SearchGitCommandArgs {
	readonly command: 'search';
	state?: Partial<State>;

	confirm?: boolean;
	prefillOnly?: boolean;
}

const searchOperatorToTitleMap = new Map<SearchOperators, string>([
	['', 'Search by Message'],
	['=:', 'Search by Message'],
	['message:', 'Search by Message'],
	['@:', 'Search by Author'],
	['author:', 'Search by Author'],
	['#:', 'Search by Commit ID'],
	['commit:', 'Search by Commit ID'],
	['?:', 'Search by File'],
	['file:', 'Search by File'],
	['~:', 'Search by Changes'],
	['change:', 'Search by Changes']
]);

export class SearchGitCommand extends QuickCommandBase<State> {
	private readonly Buttons = class {
		static readonly MatchCase: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-match-case.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-match-case.svg') as any
			},
			tooltip: 'Match Case'
		};

		static readonly MatchCaseSelected: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-match-case-selected.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-match-case-selected.svg') as any
			},
			tooltip: 'Match Case'
		};

		static readonly MatchAll: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-match-all.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-match-all.svg') as any
			},
			tooltip: 'Match All'
		};

		static readonly MatchAllSelected: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-match-all-selected.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-match-all-selected.svg') as any
			},
			tooltip: 'Match All'
		};

		static readonly MatchRegex: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-match-regex.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-match-regex.svg') as any
			},
			tooltip: 'Match using Regular Expressions'
		};

		static readonly MatchRegexSelected: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-match-regex-selected.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-match-regex-selected.svg') as any
			},
			tooltip: 'Match using Regular Expressions'
		};

		static readonly OpenInView: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-link.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-link.svg') as any
			},
			tooltip: 'Open in View'
		};

		static readonly ShowInView: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-eye.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-eye.svg') as any
			},
			tooltip: 'Show Results in Search Commits View'
		};

		static readonly ShowInViewSelected: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-eye-selected.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-eye-selected.svg') as any
			},
			tooltip: 'Show Results in Search Commits View'
		};
	};

	constructor(args?: SearchGitCommandArgs) {
		super('search', 'search', 'Search', {
			description: 'aka grep, searches for commits'
		});

		if (args == null || args.state === undefined) return;

		let counter = 0;
		if (args.state.repo !== undefined) {
			counter++;
		}

		if (args.state.pattern !== undefined && !args.prefillOnly) {
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
		let repos;
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

				if (state.pattern === undefined || state.counter < 2) {
					const items: QuickPickItemOfT<SearchOperators>[] = [
						{
							label: searchOperatorToTitleMap.get('')!,
							description: `pattern or message: pattern or =: pattern ${GlyphChars.Dash} use quotes to search for phrases`,
							item: 'message:'
						},
						{
							label: searchOperatorToTitleMap.get('author:')!,
							description: 'author: pattern or @: pattern',
							item: 'author:'
						},
						{
							label: searchOperatorToTitleMap.get('commit:')!,
							description: 'commit: sha or #: sha',
							item: 'commit:'
						},
						{
							label: searchOperatorToTitleMap.get('file:')!,
							description: 'file: glob or ?: glob',
							item: 'file:'
						},
						{
							label: searchOperatorToTitleMap.get('change:')!,
							description: 'change: pattern or ~: pattern',
							item: 'change:'
						}
					];
					const titleSuffix = `${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`;

					const matchCaseButton: Mutable<QuickInputButton> = {
						...(state.matchCase ? this.Buttons.MatchCaseSelected : this.Buttons.MatchCase)
					};
					const matchAllButton: Mutable<QuickInputButton> = {
						...(state.matchAll ? this.Buttons.MatchAllSelected : this.Buttons.MatchAll)
					};
					const matchRegexButton: Mutable<QuickInputButton> = {
						...(state.matchRegex ? this.Buttons.MatchRegexSelected : this.Buttons.MatchRegex)
					};
					const showInViewButton: Mutable<QuickInputButton> = {
						...(state.showInView ? this.Buttons.ShowInViewSelected : this.Buttons.ShowInView)
					};

					const step = this.createPickStep<QuickPickItemOfT<string>>({
						title: `${this.title}${titleSuffix}`,
						placeholder: 'e.g. "Updates dependencies" author:eamodio',
						matchOnDescription: true,
						matchOnDetail: true,
						additionalButtons: [matchCaseButton, matchAllButton, matchRegexButton, showInViewButton],
						items: items,
						value: state.pattern,
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
									? this.Buttons.MatchCaseSelected.iconPath
									: this.Buttons.MatchCase.iconPath;

								return;
							}

							if (button === matchAllButton) {
								state.matchAll = !state.matchAll;
								matchAllButton.iconPath = state.matchAll
									? this.Buttons.MatchAllSelected.iconPath
									: this.Buttons.MatchAll.iconPath;

								return;
							}

							if (button === matchRegexButton) {
								state.matchRegex = !state.matchRegex;
								matchRegexButton.iconPath = state.matchRegex
									? this.Buttons.MatchRegexSelected.iconPath
									: this.Buttons.MatchRegex.iconPath;

								return;
							}

							if (button === showInViewButton) {
								state.showInView = !state.showInView;
								showInViewButton.iconPath = state.showInView
									? this.Buttons.ShowInViewSelected.iconPath
									: this.Buttons.ShowInView.iconPath;
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
										label: 'Search for',
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
						if (repos.length === 1) {
							break;
						}

						continue;
					}

					state.pattern = selection[0].item.trim();
				}

				const search: SearchPattern = {
					pattern: state.pattern,
					matchAll: state.matchAll,
					matchCase: state.matchCase,
					matchRegex: state.matchRegex
				};
				const searchKey = SearchPattern.toKey(search);

				if (resultsPromise === undefined || resultsKey !== searchKey) {
					resultsPromise = Container.git.getLogForSearch(state.repo.path, search);
					resultsKey = searchKey;
				}

				if (state.showInView) {
					void Container.searchView.search(
						state.repo.path,
						search,
						{
							label: { label: `for ${state.pattern}` }
						},
						resultsPromise
					);

					break;
				}

				const results = await resultsPromise;

				const step = this.createPickStep<CommitQuickPickItem>({
					title: `${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
					placeholder:
						results === undefined
							? `No results for ${state.pattern}`
							: `${Strings.pluralize('result', results.count, {
									number: results.truncated ? `${results.count}+` : undefined
							  })} for ${state.pattern}`,
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
					additionalButtons: [this.Buttons.OpenInView],
					onDidClickButton: (quickpick, button) => {
						if (button !== this.Buttons.OpenInView) return;

						void Container.searchView.search(
							state.repo!.path,
							search,
							{
								label: { label: `for ${state.pattern}` }
							},
							results
						);
					},
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (quickpick, key) => {
						if (quickpick.activeItems.length === 0) return;

						const commit = quickpick.activeItems[0].item;
						if (key === 'ctrl+right') {
							await Container.repositoriesView.revealCommit(commit, {
								select: true,
								focus: false,
								expand: true
							});
						} else {
							await Container.searchView.search(
								commit.repoPath,
								{ pattern: SearchPattern.fromCommit(commit) },
								{
									label: { label: `for commit id ${commit.shortSha}` }
								}
							);
						}
					}
				});
				const selection: StepSelection<typeof step> = yield step;

				if (!this.canPickStepMoveNext(step, state, selection)) {
					continue;
				}

				pickedCommit = selection[0].item;

				if (pickedCommit !== undefined) {
					const step = this.createPickStep<CommandQuickPickItem>({
						title: `${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repo.formattedName
						}${Strings.pad(GlyphChars.Dot, 2, 2)}${pickedCommit.shortSha}`,
						placeholder: `${pickedCommit.shortSha} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${
							pickedCommit.author ? `${pickedCommit.author}, ` : ''
						}${pickedCommit.formattedDate} ${Strings.pad(
							GlyphChars.Dot,
							1,
							1
						)} ${pickedCommit.getShortMessage()}`,
						items: await CommitQuickPick.getItems(pickedCommit, pickedCommit.toGitUri(), {
							showChanges: false
						}),
						additionalButtons: [this.Buttons.OpenInView],
						onDidClickButton: (quickpick, button) => {
							if (button !== this.Buttons.OpenInView) return;

							void Container.searchView.search(
								pickedCommit!.repoPath,
								{ pattern: SearchPattern.fromCommit(pickedCommit!) },
								{
									label: { label: `for commit id ${pickedCommit!.shortSha}` }
								}
							);
						}
					});
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						continue;
					}

					const command = selection[0];
					if (command instanceof CommandQuickPickItem) {
						command.execute();
						break;
					}
				}
			} catch (ex) {
				Logger.error(ex, this.title);

				throw ex;
			}
		}

		return undefined;
	}
}

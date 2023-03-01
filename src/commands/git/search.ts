import { ContextKeys, GlyphChars } from '../../constants';
import type { Container } from '../../container';
import { getContext } from '../../context';
import { showDetailsView } from '../../git/actions/commit';
import type { GitCommit } from '../../git/models/commit';
import type { GitLog } from '../../git/models/log';
import type { Repository } from '../../git/models/repository';
import type { SearchOperators, SearchQuery } from '../../git/search';
import { getSearchQueryComparisonKey, parseSearchQuery, searchOperators } from '../../git/search';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { ActionQuickPickItem } from '../../quickpicks/items/common';
import { configuration } from '../../system/configuration';
import { pluralize } from '../../system/string';
import { SearchResultsNode } from '../../views/nodes/searchResultsNode';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import { getSteps } from '../gitCommands.utils';
import type {
	PartialStepState,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import {
	appendReposToTitle,
	canPickStepContinue,
	createPickStep,
	endSteps,
	MatchAllToggleQuickInputButton,
	MatchCaseToggleQuickInputButton,
	MatchRegexToggleQuickInputButton,
	pickCommitStep,
	pickRepositoryStep,
	QuickCommand,
	ShowResultsInSideBarQuickInputButton,
	StepResultBreak,
} from '../quickCommand';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	commit: GitCommit | undefined;
	hasVirtualFolders: boolean;
	resultsKey: string | undefined;
	resultsPromise: Promise<GitLog | undefined> | undefined;
	title: string;
}

interface State extends Required<SearchQuery> {
	repo: string | Repository;
	openPickInView?: boolean;
	showResultsInSideBar: boolean | SearchResultsNode;
}

export interface SearchGitCommandArgs {
	readonly command: 'search' | 'grep';
	prefillOnly?: boolean;
	state?: Partial<State>;
}

const searchOperatorToTitleMap = new Map<SearchOperators, string>([
	['', 'Search by Message'],
	['=:', 'Search by Message'],
	['message:', 'Search by Message'],
	['@:', 'Search by Author'],
	['author:', 'Search by Author'],
	['#:', 'Search by Commit SHA'],
	['commit:', 'Search by Commit SHA'],
	['?:', 'Search by File'],
	['file:', 'Search by File'],
	['~:', 'Search by Changes'],
	['change:', 'Search by Changes'],
]);

type SearchStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class SearchGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: SearchGitCommandArgs) {
		super(container, 'search', 'search', 'Commit Search', {
			description: 'aka grep, searches for commits',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		if (args?.state?.query != null && !args.prefillOnly) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: false,
			...args?.state,
		};
	}

	override get canConfirm(): boolean {
		return false;
	}

	override isMatch(key: string) {
		return super.isMatch(key) || key === 'grep';
	}

	override isFuzzyMatch(name: string) {
		return super.isFuzzyMatch(name) || name === 'grep';
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.searchAndCompareView,
			commit: undefined,
			hasVirtualFolders: getContext<boolean>(ContextKeys.HasVirtualFolders, false),
			resultsKey: undefined,
			resultsPromise: undefined,
			title: this.title,
		};

		const cfg = configuration.get('gitCommands.search');
		if (state.matchAll == null) {
			state.matchAll = cfg.matchAll;
		}
		if (state.matchCase == null) {
			state.matchCase = cfg.matchCase;
		}
		if (state.matchRegex == null) {
			state.matchRegex = cfg.matchRegex;
		}
		if (state.showResultsInSideBar == null) {
			state.showResultsInSideBar = cfg.showResultsInSideBar ?? undefined;
		}

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.repo == null || typeof state.repo === 'string') {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					skippedStepOne = true;
					if (state.repo == null) {
						state.counter++;
					}

					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					// Always break on the first step (so we will go back)
					if (result === StepResultBreak) break;

					state.repo = result;
				}
			}

			if (state.counter < 2 || state.query == null) {
				const result = yield* this.pickSearchOperatorStep(state as SearchStepState, context);
				if (result === StepResultBreak) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					state.query = undefined;

					continue;
				}

				state.query = result;
			}

			const search: SearchQuery = {
				query: state.query,
				matchAll: state.matchAll,
				matchCase: state.matchCase,
				matchRegex: state.matchRegex,
			};
			const searchKey = getSearchQueryComparisonKey(search);

			if (context.resultsPromise == null || context.resultsKey !== searchKey) {
				context.resultsPromise = state.repo.richSearchCommits(search);
				context.resultsKey = searchKey;
			}

			if (state.showResultsInSideBar) {
				void this.container.searchAndCompareView.search(
					state.repo.path,
					search,
					{
						label: { label: `for ${state.query}` },
					},
					context.resultsPromise,
					state.showResultsInSideBar instanceof SearchResultsNode ? state.showResultsInSideBar : undefined,
				);

				break;
			}

			if (state.counter < 3 || context.commit == null) {
				const repoPath = state.repo.path;
				const result = yield* pickCommitStep(state as SearchStepState, context, {
					ignoreFocusOut: true,
					log: await context.resultsPromise,
					onDidLoadMore: log => (context.resultsPromise = Promise.resolve(log)),
					placeholder: (context, log) =>
						log == null
							? `No results for ${state.query}`
							: `${pluralize('result', log.count, {
									format: c => (log.hasMore ? `${c}+` : undefined),
							  })} for ${state.query}`,
					picked: context.commit?.ref,
					showInSideBarCommand: new ActionQuickPickItem(
						'$(link-external)  Show Results in Side Bar',
						() =>
							void this.container.searchAndCompareView.search(
								repoPath,
								search,
								{
									label: { label: `for ${state.query}` },
									reveal: {
										select: true,
										focus: false,
										expand: true,
									},
								},
								context.resultsPromise,
							),
					),
					showInSideBarButton: {
						button: ShowResultsInSideBarQuickInputButton,
						onDidClick: () =>
							void this.container.searchAndCompareView.search(
								repoPath,
								search,
								{
									label: { label: `for ${state.query}` },
									reveal: {
										select: true,
										focus: false,
										expand: true,
									},
								},
								context.resultsPromise,
							),
					},
				});
				if (result === StepResultBreak) {
					state.counter--;
					continue;
				}

				context.commit = result;
			}

			let result: StepResult<ReturnType<typeof getSteps>>;
			if (state.openPickInView) {
				void showDetailsView(context.commit, {
					pin: false,
					preserveFocus: false,
				});
				result = StepResultBreak;
			} else {
				result = yield* getSteps(
					this.container,
					{
						command: 'show',
						state: {
							repo: state.repo,
							reference: context.commit,
						},
					},
					this.pickedVia,
				);
			}

			state.counter--;
			if (result === StepResultBreak) {
				endSteps(state);
			}
		}

		return state.counter < 0 ? StepResultBreak : undefined;
	}

	private *pickSearchOperatorStep(state: SearchStepState, context: Context): StepResultGenerator<string> {
		const items: QuickPickItemOfT<SearchOperators>[] = [
			{
				label: searchOperatorToTitleMap.get('')!,
				description: `pattern or message: pattern or =: pattern ${GlyphChars.Dash} use quotes to search for phrases`,
				item: 'message:' as const,
			},
			{
				label: searchOperatorToTitleMap.get('author:')!,
				description: 'author: pattern or @: pattern',
				item: 'author:' as const,
			},
			{
				label: searchOperatorToTitleMap.get('commit:')!,
				description: 'commit: sha or #: sha',
				item: 'commit:' as const,
			},
			context.hasVirtualFolders
				? undefined
				: {
						label: searchOperatorToTitleMap.get('file:')!,
						description: 'file: glob or ?: glob',
						item: 'file:' as const,
				  },
			context.hasVirtualFolders
				? undefined
				: {
						label: searchOperatorToTitleMap.get('change:')!,
						description: 'change: pattern or ~: pattern',
						item: 'change:' as const,
				  },
		].filter(<T>(i?: T): i is T => i != null);

		const matchCaseButton = new MatchCaseToggleQuickInputButton(state.matchCase);
		const matchAllButton = new MatchAllToggleQuickInputButton(state.matchAll);
		const matchRegexButton = new MatchRegexToggleQuickInputButton(state.matchRegex);

		const step = createPickStep<QuickPickItemOfT<SearchOperators>>({
			title: appendReposToTitle(context.title, state, context),
			placeholder: 'e.g. "Updates dependencies" author:eamodio',
			matchOnDescription: true,
			matchOnDetail: true,
			additionalButtons: [matchCaseButton, matchAllButton, matchRegexButton],
			items: items,
			value: state.query,
			selectValueWhenShown: false,
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
					matchCaseButton.on = state.matchCase;
				} else if (button === matchAllButton) {
					state.matchAll = !state.matchAll;
					matchAllButton.on = state.matchAll;
				} else if (button === matchRegexButton) {
					state.matchRegex = !state.matchRegex;
					matchRegexButton.on = state.matchRegex;
				}
			},
			onDidChangeValue: (quickpick): boolean => {
				const value = quickpick.value.trim();
				// Simulate an extra step if we have a value
				state.counter = value ? 3 : 2;

				const operations = parseSearchQuery({
					query: value,
					matchCase: state.matchCase,
					matchAll: state.matchAll,
					matchRegex: state.matchRegex,
				});

				quickpick.title = appendReposToTitle(
					operations.size === 0 || operations.size > 1
						? context.title
						: `Commit ${searchOperatorToTitleMap.get(operations.keys().next().value)!}`,
					state,
					context,
				);

				if (quickpick.value.length === 0) {
					quickpick.items = items;
				} else {
					// If something was typed/selected, keep the quick pick open on focus loss
					quickpick.ignoreFocusOut = true;
					step.ignoreFocusOut = true;

					quickpick.items = [
						{
							label: 'Search for',
							description: quickpick.value,
							item: quickpick.value as SearchOperators,
						},
					];
				}

				return true;
			},
		});
		const selection: StepSelection<typeof step> = yield step;
		if (!canPickStepContinue(step, state, selection)) {
			// Since we simulated a step above, we need to remove it here
			state.counter--;
			return StepResultBreak;
		}

		// Since we simulated a step above, we need to remove it here
		state.counter--;
		return selection[0].item.trim();
	}
}

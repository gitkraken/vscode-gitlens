import type { QuickInputButton, QuickPick } from 'vscode';
import { ThemeIcon, window } from 'vscode';
import { GlyphChars } from '../../constants';
import type { SearchOperators, SearchOperatorsLongForm, SearchQuery } from '../../constants.search';
import { searchOperators } from '../../constants.search';
import type { Container } from '../../container';
import { showDetailsView } from '../../git/actions/commit';
import type { GitCommit } from '../../git/models/commit';
import type { GitLog } from '../../git/models/log';
import type { Repository } from '../../git/models/repository';
import { getSearchQueryComparisonKey, parseSearchQuery } from '../../git/search';
import { showContributorsPicker } from '../../quickpicks/contributorsPicker';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { ActionQuickPickItem } from '../../quickpicks/items/common';
import { isDirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { first, join, map } from '../../system/iterable';
import { pluralize } from '../../system/string';
import { configuration } from '../../system/vscode/configuration';
import { getContext } from '../../system/vscode/context';
import { SearchResultsNode } from '../../views/nodes/searchResultsNode';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { canPickStepContinue, createPickStep, endSteps, QuickCommand, StepResultBreak } from '../quickCommand';
import {
	MatchAllToggleQuickInputButton,
	MatchCaseToggleQuickInputButton,
	MatchRegexToggleQuickInputButton,
	ShowResultsInSideBarQuickInputButton,
} from '../quickCommand.buttons';
import { appendReposToTitle, pickCommitStep, pickRepositoryStep } from '../quickCommand.steps';
import { getSteps } from '../quickWizard.utils';

const UseAuthorPickerQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('person-add'),
	tooltip: 'Pick Authors',
};

const UseFilePickerQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('new-file'),
	tooltip: 'Pick Files',
};

const UseFolderPickerQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('new-folder'),
	tooltip: 'Pick Folder',
};

interface Context {
	container: Container;
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
	['type:', 'Search by Type'],
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
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.searchAndCompare,
			commit: undefined,
			hasVirtualFolders: getContext('gitlens:hasVirtualFolders', false),
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
				context.resultsPromise = state.repo.git.richSearchCommits(search);
				context.resultsKey = searchKey;
			}

			if (state.showResultsInSideBar) {
				void this.container.views.searchAndCompare.search(
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
					placeholder: (_context, log) =>
						log == null
							? `No results for ${state.query}`
							: `${pluralize('result', log.count, {
									format: c => (log.hasMore ? `${c}+` : undefined),
							  })} for ${state.query}`,
					picked: context.commit?.ref,
					showInSideBarCommand: new ActionQuickPickItem(
						'$(link-external)  Show Results in Side Bar',
						() =>
							void this.container.views.searchAndCompare.search(
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
							void this.container.views.searchAndCompare.search(
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
		const items: QuickPickItemOfT<SearchOperatorsLongForm>[] = [
			{
				label: searchOperatorToTitleMap.get('')!,
				description: `pattern or message: pattern or =: pattern ${GlyphChars.Dash} use quotes to search for phrases`,
				alwaysShow: true,
				item: 'message:' as const,
			},
			{
				label: searchOperatorToTitleMap.get('author:')!,
				description: 'author: pattern or @: pattern',
				buttons: [UseAuthorPickerQuickInputButton],
				alwaysShow: true,
				item: 'author:' as const,
			},
			{
				label: searchOperatorToTitleMap.get('commit:')!,
				description: 'commit: sha or #: sha',
				alwaysShow: true,
				item: 'commit:' as const,
			},
			context.hasVirtualFolders
				? undefined
				: {
						label: searchOperatorToTitleMap.get('file:')!,
						description: 'file: glob or ?: glob',
						buttons: [UseFilePickerQuickInputButton, UseFolderPickerQuickInputButton],
						alwaysShow: true,
						item: 'file:' as const,
				  },
			context.hasVirtualFolders
				? undefined
				: {
						label: searchOperatorToTitleMap.get('change:')!,
						description: 'change: pattern or ~: pattern',
						alwaysShow: true,
						item: 'change:' as const,
				  },
		].filter(<T>(i?: T): i is T => i != null);

		const matchCaseButton = new MatchCaseToggleQuickInputButton(state.matchCase);
		const matchAllButton = new MatchAllToggleQuickInputButton(state.matchAll);
		const matchRegexButton = new MatchRegexToggleQuickInputButton(state.matchRegex);

		const step = createPickStep<QuickPickItemOfT<SearchOperatorsLongForm>>({
			title: appendReposToTitle(context.title, state, context),
			placeholder: 'e.g. "Updates dependencies" author:eamodio',
			ignoreFocusOut: true,
			matchOnDescription: true,
			matchOnDetail: true,
			additionalButtons: [matchCaseButton, matchAllButton, matchRegexButton],
			items: items,
			value: state.query,
			selectValueWhenShown: false,
			onDidAccept: async quickpick => {
				const item = quickpick.selectedItems[0];
				if (isDirectiveQuickPickItem(item)) return false;
				if (!searchOperators.has(item.item)) return true;

				await updateSearchQuery(item, {}, quickpick, step, state, context);
				return false;
			},
			onDidClickButton: (_quickpick, button) => {
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
			onDidClickItemButton: async function (quickpick, button, item) {
				if (button === UseAuthorPickerQuickInputButton) {
					await updateSearchQuery(item, { author: true }, quickpick, step, state, context);
				} else if (button === UseFilePickerQuickInputButton) {
					await updateSearchQuery(item, { file: { type: 'file' } }, quickpick, step, state, context);
				} else if (button === UseFolderPickerQuickInputButton) {
					await updateSearchQuery(item, { file: { type: 'folder' } }, quickpick, step, state, context);
				}

				return false;
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
					operations.size === 1
						? `Commit ${searchOperatorToTitleMap.get(first(operations.keys())!)}`
						: context.title,
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
							item: quickpick.value as SearchOperatorsLongForm,
							picked: true,
						},
						...items,
					];

					quickpick.activeItems = [quickpick.items[0]];
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

async function updateSearchQuery(
	item: QuickPickItemOfT<SearchOperatorsLongForm>,
	usePickers: { author?: boolean; file?: { type: 'file' | 'folder' } },
	quickpick: QuickPick<any>,
	step: QuickPickStep,
	state: SearchStepState,
	context: Context,
) {
	const ops = parseSearchQuery({
		query: quickpick.value,
		matchCase: state.matchCase,
		matchAll: state.matchAll,
	});

	let append = false;

	if (usePickers?.author && item.item === 'author:') {
		using _frozen = step.freeze?.();

		const authors = ops.get('author:');

		const contributors = await showContributorsPicker(
			context.container,
			state.repo,
			'Search by Author',
			'Choose contributors to include commits from',
			{
				appendReposToTitle: true,
				clearButton: true,
				ignoreFocusOut: true,
				multiselect: true,
				picked: c =>
					authors != null &&
					((c.email != null && authors.has(c.email)) ||
						(c.name != null && authors.has(c.name)) ||
						(c.username != null && authors.has(c.username))),
			},
		);

		if (contributors != null) {
			const authors = contributors
				.map(c => c.email ?? c.name ?? c.username)
				.filter(<T>(c?: T): c is T => c != null);
			if (authors.length) {
				ops.set('author:', new Set(authors));
			} else {
				ops.delete('author:');
			}
		} else {
			append = true;
		}
	} else if (usePickers?.file && item.item === 'file:') {
		using _frozen = step.freeze?.();

		let files = ops.get('file:');

		const uris = await window.showOpenDialog({
			canSelectFiles: usePickers.file.type === 'file',
			canSelectFolders: usePickers.file.type === 'folder',
			canSelectMany: usePickers.file.type === 'file',
			title: 'Search by File',
			openLabel: 'Add to Search',
			defaultUri: state.repo.folder?.uri,
		});

		if (uris?.length) {
			if (files == null) {
				files = new Set();
				ops.set('file:', files);
			}

			for (const uri of uris) {
				files.add(context.container.git.getRelativePath(uri, state.repo.uri));
			}
		} else {
			append = true;
		}

		if (files == null || files.size === 0) {
			ops.delete('file:');
		}
	} else {
		const values = ops.get(item.item);
		append = !values?.has('');
	}

	quickpick.value = `${join(
		map(ops.entries(), ([op, values]) => `${op}${join(values, ` ${op}`)}`),
		' ',
	)}${append ? ` ${item.item}` : ''}`;

	void step.onDidChangeValue!(quickpick);
}

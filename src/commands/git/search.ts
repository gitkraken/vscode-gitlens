import type { QuickInputButton, QuickPick } from 'vscode';
import { ThemeIcon, window } from 'vscode';
import { GlyphChars } from '../../constants';
import type { SearchOperators, SearchOperatorsLongForm, SearchQuery } from '../../constants.search';
import type { Container } from '../../container';
import { showCommitInDetailsView } from '../../git/actions/commit';
import type { SearchCommitsResult } from '../../git/gitProvider';
import type { GitCommit } from '../../git/models/commit';
import type { Repository } from '../../git/models/repository';
import { getSearchQueryComparisonKey, parseSearchQuery } from '../../git/search';
import { showContributorsPicker } from '../../quickpicks/contributorsPicker';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { ActionQuickPickItem, createQuickPickSeparator } from '../../quickpicks/items/common';
import { isDirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { showReferencePicker2 } from '../../quickpicks/referencePicker';
import { configuration } from '../../system/-webview/configuration';
import { getContext } from '../../system/-webview/context';
import { first, join, map } from '../../system/iterable';
import { pluralize } from '../../system/string';
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
	MatchWholeWordToggleQuickInputButton,
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

const UseRefPickerQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('git-branch'),
	tooltip: 'Pick Reference',
};

interface Context {
	container: Container;
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	commit: GitCommit | undefined;
	hasVirtualFolders: boolean;
	resultsKey: string | undefined;
	resultPromise: Promise<SearchCommitsResult> | undefined;
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
	['is:', 'Search by Type'],
	['type:', 'Search by Type'],
	['after:', 'Search After Date'],
	['since:', 'Search After Date'],
	['before:', 'Search Before Date'],
	['until:', 'Search Before Date'],
	['^:', 'Search by Reference or Range'],
	['ref:', 'Search by Reference or Range'],
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

	override isMatch(key: string): boolean {
		return super.isMatch(key) || key === 'grep';
	}

	override isFuzzyMatch(name: string): boolean {
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
			resultPromise: undefined,
			title: this.title,
		};

		const cfg = configuration.get('gitCommands.search');
		state.matchAll ??= cfg.matchAll;
		state.matchCase ??= cfg.matchCase;
		state.matchRegex ??= cfg.matchRegex;
		state.matchWholeWord ??= cfg.matchWholeWord;
		state.showResultsInSideBar ??= cfg.showResultsInSideBar ?? undefined;

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
					const result = yield* pickRepositoryStep(state, context, { excludeWorktrees: true });
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

			let search: SearchQuery = {
				query: state.query,
				naturalLanguage: state.naturalLanguage ?? false,
				matchAll: state.matchAll,
				matchCase: state.matchCase,
				matchRegex: state.matchRegex,
				matchWholeWord: state.matchWholeWord,
			};
			let searchKey = getSearchQueryComparisonKey(search);

			if (context.resultPromise == null || context.resultsKey !== searchKey) {
				context.resultPromise = state.repo.git.commits.searchCommits(search, { source: 'quick-wizard' });
				context.resultsKey = searchKey;

				const result = await context.resultPromise;
				search = result.search;
				searchKey = getSearchQueryComparisonKey(search);
				context.resultsKey = searchKey;
			}

			if (state.showResultsInSideBar) {
				void this.container.views.searchAndCompare.search(
					state.repo.path,
					search,
					{ label: { label: `for ${state.query}` } },
					context.resultPromise.then(r => r.log),
					state.showResultsInSideBar instanceof SearchResultsNode ? state.showResultsInSideBar : undefined,
				);

				break;
			}

			if (state.counter < 3 || context.commit == null) {
				const repoPath = state.repo.path;
				const result = yield* pickCommitStep(state as SearchStepState, context, {
					ignoreFocusOut: true,
					log: await context.resultPromise.then(r => r.log),
					onDidLoadMore: log => (context.resultPromise = Promise.resolve({ search: search, log: log })),
					placeholder: (_context, log) =>
						!log?.commits.size
							? `No results for ${state.query}`
							: `${pluralize('result', log.count, {
									format: c => (log.hasMore ? `${c}+` : String(c)),
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
									reveal: { select: true, focus: false, expand: true },
								},
								context.resultPromise?.then(r => r.log),
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
									reveal: { select: true, focus: false, expand: true },
								},
								context.resultPromise?.then(r => r.log),
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
				void showCommitInDetailsView(context.commit, { pin: false, preserveFocus: false });
				result = StepResultBreak;
			} else {
				result = yield* getSteps(
					this.container,
					{ command: 'show', state: { repo: state.repo, reference: context.commit } },
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
		type Items =
			| { type: 'add'; operator: SearchOperatorsLongForm }
			| { type: 'search'; useNaturalLanguage: boolean; value?: string };

		const items: QuickPickItemOfT<Items>[] = [
			{
				label: searchOperatorToTitleMap.get('')!,
				description: `<message> or message:<message> or =:<message> ${GlyphChars.Dash} use quotes to search for phrases`,
				alwaysShow: true,
				item: { type: 'add', operator: 'message:' },
			},
			{
				label: searchOperatorToTitleMap.get('author:')!,
				description: 'author:<author> or @:<author>',
				buttons: [UseAuthorPickerQuickInputButton],
				alwaysShow: true,
				item: { type: 'add', operator: 'author:' },
			},
			{
				label: searchOperatorToTitleMap.get('commit:')!,
				description: '<sha> or commit:<sha> or #:<sha>',
				alwaysShow: true,
				item: { type: 'add', operator: 'commit:' },
			},
			{
				label: searchOperatorToTitleMap.get('ref:')!,
				description: 'ref:<ref> or ^:<ref> (supports ranges like main..feature)',
				buttons: [UseRefPickerQuickInputButton],
				alwaysShow: true,
				item: { type: 'add', operator: 'ref:' },
			},
		];

		if (!context.hasVirtualFolders) {
			items.push(
				{
					label: searchOperatorToTitleMap.get('type:')!,
					description: 'type:stash or is:stash; type:tip or is:tip',
					alwaysShow: true,
					item: { type: 'add', operator: 'type:' },
				},
				createQuickPickSeparator(),
				{
					label: searchOperatorToTitleMap.get('file:')!,
					description: 'file: glob or ?: glob',
					buttons: [UseFilePickerQuickInputButton, UseFolderPickerQuickInputButton],
					alwaysShow: true,
					item: { type: 'add', operator: 'file:' },
				},
				{
					label: searchOperatorToTitleMap.get('change:')!,
					description: 'change: pattern or ~: pattern',
					alwaysShow: true,
					item: { type: 'add', operator: 'change:' },
				},
				createQuickPickSeparator(),
				{
					label: searchOperatorToTitleMap.get('after:')!,
					description: 'after: date or since: date',
					alwaysShow: true,
					item: { type: 'add', operator: 'after:' },
				},
				{
					label: searchOperatorToTitleMap.get('before:')!,
					description: 'before: date or until: date',
					alwaysShow: true,
					item: { type: 'add', operator: 'before:' },
				},
			);
		}

		const aiAllowed =
			configuration.get('ai.enabled', undefined, true) && getContext('gitlens:gk:organization:ai:enabled', true);

		const matchCaseButton = new MatchCaseToggleQuickInputButton(state.matchCase);
		const matchAllButton = new MatchAllToggleQuickInputButton(state.matchAll);
		const matchRegexButton = new MatchRegexToggleQuickInputButton(state.matchRegex);
		const matchWholeWordButton = new MatchWholeWordToggleQuickInputButton(state.matchWholeWord);

		const step = createPickStep<(typeof items)[number]>({
			title: appendReposToTitle(context.title, state, context),
			placeholder:
				aiAllowed && state.naturalLanguage
					? 'e.g. "Show my commits from last month"'
					: 'e.g. "Updates dependencies" author:eamodio',
			ignoreFocusOut: true,
			matchOnDescription: true,
			matchOnDetail: true,
			additionalButtons: [matchCaseButton, matchWholeWordButton, matchRegexButton, matchAllButton],
			items: items,
			value: typeof state.naturalLanguage === 'object' ? state.naturalLanguage.query : state.query,
			selectValueWhenShown: false,
			onDidAccept: async quickpick => {
				const item = quickpick.selectedItems[0];
				if (isDirectiveQuickPickItem(item)) return false;

				if (item.item.type === 'search') {
					item.item.value = quickpick.value.trim();
					state.naturalLanguage = item.item.useNaturalLanguage;
					return true;
				}

				await updateSearchQuery(item.item.operator, {}, quickpick, step, state, context);
				return false;
			},
			onDidClickButton: (_quickpick, button) => {
				if (button === matchAllButton) {
					state.matchAll = !state.matchAll;
					matchAllButton.on = state.matchAll;
				} else if (button === matchCaseButton) {
					state.matchCase = !state.matchCase;
					matchCaseButton.on = state.matchCase;
				} else if (button === matchRegexButton) {
					state.matchRegex = !state.matchRegex;
					matchRegexButton.on = state.matchRegex;
				} else if (button === matchWholeWordButton) {
					state.matchWholeWord = !state.matchWholeWord;
					matchWholeWordButton.on = state.matchWholeWord;
				}
			},
			onDidClickItemButton: async function (quickpick, button, item) {
				if (item.item.type !== 'add') return false;

				if (button === UseAuthorPickerQuickInputButton) {
					await updateSearchQuery(item.item.operator, { author: true }, quickpick, step, state, context);
				} else if (button === UseFilePickerQuickInputButton) {
					await updateSearchQuery(
						item.item.operator,
						{ file: { type: 'file' } },
						quickpick,
						step,
						state,
						context,
					);
				} else if (button === UseFolderPickerQuickInputButton) {
					await updateSearchQuery(
						item.item.operator,
						{ file: { type: 'folder' } },
						quickpick,
						step,
						state,
						context,
					);
				} else if (button === UseRefPickerQuickInputButton) {
					await updateSearchQuery(item.item.operator, { ref: true }, quickpick, step, state, context);
				}

				return false;
			},
			onDidChangeValue: (quickpick): boolean => {
				const value = quickpick.value.trim();
				// Simulate an extra step if we have a value
				state.counter = value ? 3 : 2;

				const { operations } = parseSearchQuery({
					query: value,
					matchAll: state.matchAll,
					matchCase: state.matchCase,
					matchRegex: state.matchRegex,
					matchWholeWord: state.matchWholeWord,
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

					const newItems: QuickPickItemOfT<Items>[] = [...items];

					const searchItem: QuickPickItemOfT<Items> = {
						label: 'Search for',
						description: quickpick.value,
						iconPath: new ThemeIcon('search'),
						item: { type: 'search', useNaturalLanguage: false },
						picked: true,
					};

					if (aiAllowed) {
						const naturalLanguageItem: QuickPickItemOfT<Items> = {
							label: 'Search using Natural Language',
							description: quickpick.value,
							iconPath: new ThemeIcon('sparkle'),
							alwaysShow: true,
							item: { type: 'search', useNaturalLanguage: true },
						};

						if (state.naturalLanguage) {
							newItems.splice(0, 0, naturalLanguageItem, searchItem);
						} else {
							newItems.splice(0, 0, searchItem, naturalLanguageItem);
						}
					} else {
						newItems.splice(0, 0, searchItem);
					}

					quickpick.items = newItems;
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

		const selectedItem = selection[0].item;
		if (selectedItem.type === 'search' && selectedItem.value != null) {
			return selectedItem.value;
		}
		return '';
	}
}

async function updateSearchQuery(
	operator: SearchOperatorsLongForm,
	usePickers: { author?: boolean; file?: { type: 'file' | 'folder' }; ref?: boolean },
	quickpick: QuickPick<any>,
	step: QuickPickStep,
	state: SearchStepState,
	context: Context,
) {
	const { operations: ops } = parseSearchQuery({
		query: quickpick.value,
		matchAll: state.matchAll,
		matchCase: state.matchCase,
		matchRegex: state.matchRegex,
		matchWholeWord: state.matchWholeWord,
	});

	let append = false;

	if (usePickers?.author && operator === 'author:') {
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
	} else if (usePickers?.file && operator === 'file:') {
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

		if (!files?.size) {
			ops.delete('file:');
		}
	} else if (usePickers?.ref && operator === 'ref:') {
		using _frozen = step.freeze?.();

		const refs = ops.get('ref:');

		const pick = await showReferencePicker2(
			state.repo.path,
			'Search by Reference or Range',
			'Choose a reference to search',
			{
				allowedAdditionalInput: { range: true, rev: false },
				include: ['branches', 'tags', 'HEAD'],
				picked: refs && first(refs),
			},
		);

		if (pick.value != null) {
			ops.set('ref:', new Set([pick.value.ref]));
		} else {
			append = true;
		}
	} else {
		const values = ops.get(operator);
		append = !values?.has('');
	}

	quickpick.value = `${join(
		map(ops.entries(), ([op, values]) => `${op}${join(values, ` ${op}`)}`),
		' ',
	)}${append ? ` ${operator}` : ''}`;

	void step.onDidChangeValue!(quickpick);
}

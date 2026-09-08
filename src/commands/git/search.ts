import type { QuickInputButton, QuickPick } from 'vscode';
import { l10n, ThemeIcon, window } from 'vscode';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import type { SearchOperators, SearchOperatorsLongForm, SearchQuery } from '@gitlens/git/models/search.js';
import type { SearchCommitsResult } from '@gitlens/git/providers/commits.js';
import { getSearchQueryComparisonKey, parseSearchQuery } from '@gitlens/git/utils/search.utils.js';
import { first, join, map } from '@gitlens/utils/iterable.js';
import { GlyphChars } from '../../constants.js';
import type { Container } from '../../container.js';
import { showCommitInDetailsView } from '../../git/actions/commit.js';
import type { GlRepository } from '../../git/models/repository.js';
import { showContributorsPicker } from '../../quickpicks/contributorsPicker.js';
import type { QuickPickItemOfT } from '../../quickpicks/items/common.js';
import { ActionQuickPickItem, createQuickPickSeparator } from '../../quickpicks/items/common.js';
import { isDirectiveQuickPickItem } from '../../quickpicks/items/directive.js';
import { showReferencePicker2 } from '../../quickpicks/referencePicker.js';
import { configuration } from '../../system/-webview/configuration.js';
import { getContext } from '../../system/-webview/context.js';
import { SearchResultsNode } from '../../views/nodes/searchResultsNode.js';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase.js';
import type {
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepsContext,
	StepSelection,
	StepState,
} from '../quick-wizard/models/steps.js';
import { StepResultBreak } from '../quick-wizard/models/steps.js';
import type { QuickPickStep } from '../quick-wizard/models/steps.quickpick.js';
import {
	createMatchAllToggle,
	createMatchCaseToggle,
	createMatchRegexToggle,
	createMatchWholeWordToggle,
	flipToggle,
	ShowResultsInSideBarQuickInputButton,
} from '../quick-wizard/quickButtons.js';
import { QuickCommand } from '../quick-wizard/quickCommand.js';
import { pickCommitStep } from '../quick-wizard/steps/commits.js';
import { canSkipRepositoryPick, pickRepositoryStep } from '../quick-wizard/steps/repositories.js';
import { StepsController } from '../quick-wizard/stepsController.js';
import { getSteps } from '../quick-wizard/utils/quickWizard.utils.js';
import {
	appendReposToTitle,
	assertStepState,
	canPickStepContinue,
	createPickStep,
} from '../quick-wizard/utils/steps.utils.js';

const UseAuthorPickerQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('person-add'),
	tooltip: l10n.t('Pick Authors'),
};

const UseFilePickerQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('new-file'),
	tooltip: l10n.t('Pick Files'),
};

const UseFolderPickerQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('new-folder'),
	tooltip: l10n.t('Pick Folder'),
};

const UseRefPickerQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('git-branch'),
	tooltip: l10n.t('Pick Reference'),
};

const Steps = {
	PickRepo: 'search-pick-repo',
	PickSearchOperator: 'search-pick-search-operator',
	PickCommit: 'search-pick-commit',
	ShowCommit: 'search-show-commit',
} as const;
type StepNames = (typeof Steps)[keyof typeof Steps];

interface Context extends StepsContext<StepNames> {
	container: Container;
	repos: GlRepository[];
	associatedView: ViewsWithRepositoryFolders;
	commit: GitCommit | undefined;
	hasVirtualFolders: boolean;
	resultsKey: string | undefined;
	resultPromise: Promise<SearchCommitsResult> | undefined;
	title: string;
}

interface State<Repo = string | GlRepository> extends Required<SearchQuery> {
	repo: Repo;
	openPickInView?: boolean;
	showResultsInSideBar: boolean | SearchResultsNode;
}

export interface SearchGitCommandArgs {
	readonly command: 'search' | 'grep';
	prefillOnly?: boolean;
	state?: Partial<State>;
}

const searchOperatorToTitleMap = new Map<SearchOperators, string>([
	['', l10n.t('Search by Message')],
	['=:', l10n.t('Search by Message')],
	['message:', l10n.t('Search by Message')],
	['-message:', l10n.t('Exclude by Message')],
	['@:', l10n.t('Search by Author')],
	['author:', l10n.t('Search by Author')],
	['committer:', l10n.t('Search by Committer')],
	['#:', l10n.t('Search by Commit SHA')],
	['commit:', l10n.t('Search by Commit SHA')],
	['?:', l10n.t('Search by File')],
	['file:', l10n.t('Search by File')],
	['~:', l10n.t('Search by Changes')],
	['change:', l10n.t('Search by Changes')],
	['is:', l10n.t('Search by Type')],
	['type:', l10n.t('Search by Type')],
	['after:', l10n.t('Search After Date')],
	['since:', l10n.t('Search After Date')],
	['before:', l10n.t('Search Before Date')],
	['until:', l10n.t('Search Before Date')],
	['^:', l10n.t('Search by Reference or Range')],
	['ref:', l10n.t('Search by Reference or Range')],
]);

export class SearchGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: SearchGitCommandArgs) {
		super(container, 'search', 'search', l10n.t('Commit Search'), {
			description: l10n.t('aka grep, searches for commits'),
		});

		this.initialState = { confirm: false, ...args?.state };
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

	protected createContext(context?: StepsContext<any>): Context {
		return {
			...context,
			container: this.container,
			repos: this.container.git.openRepositories,
			associatedView: this.container.views.searchAndCompare,
			commit: undefined,
			hasVirtualFolders: getContext('gitlens:hasVirtualFolders', false),
			resultsKey: undefined,
			resultPromise: undefined,
			title: this.title,
		};
	}

	protected async *steps(state: PartialStepState<State>, context?: Context): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<StepNames>(context, this);

		const cfg = configuration.get('gitCommands.search');
		state.matchAll ??= cfg.matchAll;
		state.matchCase ??= cfg.matchCase;
		state.matchRegex ??= cfg.matchRegex;
		state.matchWholeWord ??= cfg.matchWholeWord;
		state.showResultsInSideBar ??= cfg.showResultsInSideBar ?? undefined;

		while (!steps.isComplete) {
			context.title = this.title;

			if (steps.isAtStep(Steps.PickRepo) || state.repo == null || typeof state.repo === 'string') {
				// Skip the picker only when the sole available repo is the one requested
				if (canSkipRepositoryPick(context.repos, state.repo)) {
					[state.repo] = context.repos;
				} else {
					using step = steps.enterStep(Steps.PickRepo);

					const result = yield* pickRepositoryStep(state, context, step, { excludeWorktrees: true });
					if (result === StepResultBreak) {
						state.repo = undefined!;
						if (step.goBack() == null) break;
						continue;
					}

					state.repo = result;
				}
			}

			assertStepState<State<GlRepository>>(state);

			if (steps.isAtStep(Steps.PickSearchOperator) || state.query == null) {
				using step = steps.enterStep(Steps.PickSearchOperator);

				const result = yield* this.pickSearchOperatorStep(state, context);
				if (result === StepResultBreak) {
					state.query = undefined!;
					if (step.goBack() == null) break;
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
				context.resultPromise = state.repo.git.commits.searchCommits(search, {
					source: { source: 'quick-wizard' },
				});
				context.resultsKey = searchKey;

				const result = await context.resultPromise;
				search = result.search;
				searchKey = getSearchQueryComparisonKey(search);
				context.resultsKey = searchKey;
			}

			const nl = typeof search.naturalLanguage === 'object' ? search.naturalLanguage : undefined;
			if (nl?.error) {
				void window.showErrorMessage(l10n.t('Unable to build a search from your description — {0}', nl.error));

				// Re-enter the query step with the typed sentence intact: the step reads its value from
				// `naturalLanguage.query` when it's an object.
				state.naturalLanguage = nl;
				state.query = undefined!;
				context.resultPromise = undefined;
				context.resultsKey = undefined;
				continue;
			}

			if (state.showResultsInSideBar) {
				void this.container.views.searchAndCompare.search(
					state.repo.path,
					search,
					{},
					context.resultPromise.then(r => r.log),
					state.showResultsInSideBar instanceof SearchResultsNode ? state.showResultsInSideBar : undefined,
				);

				steps.markStepsComplete();
				break;
			}

			if (steps.isAtStep(Steps.PickCommit) || context.commit == null) {
				using step = steps.enterStep(Steps.PickCommit);

				const repoPath = state.repo.path;
				const result = yield* pickCommitStep(state, context, {
					ignoreFocusOut: true,
					log: await context.resultPromise.then(r => r.log),
					onDidLoadMore: log => (context.resultPromise = Promise.resolve({ search: search, log: log })),
					placeholder: (_context, log) => {
						if (!log?.commits.size) {
							return l10n.t('No results for {0}', state.query);
						}

						const count = log.count;
						if (log.count === 1) {
							return log.hasMore
								? l10n.t('{0}+ result for {1}', count, state.query)
								: l10n.t('{0} result for {1}', count, state.query);
						}

						return log.hasMore
							? l10n.t('{0}+ results for {1}', count, state.query)
							: l10n.t('{0} results for {1}', count, state.query);
					},
					picked: context.commit?.ref,
					showInSideBarCommand: new ActionQuickPickItem(
						l10n.t('$(link-external)  Show Results in Side Bar'),
						() =>
							void this.container.views.searchAndCompare.search(
								repoPath,
								search,
								{
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
									reveal: { select: true, focus: false, expand: true },
								},
								context.resultPromise?.then(r => r.log),
							),
					},
				});
				if (result === StepResultBreak) {
					context.commit = undefined;
					if (step.goBack() == null) break;
					continue;
				}

				context.commit = result;
			}

			if (steps.isAtStepOrUnset(Steps.ShowCommit)) {
				using step = steps.enterStep(Steps.ShowCommit);

				if (state.openPickInView) {
					steps.markStepsComplete();
					void showCommitInDetailsView(context.commit, { pin: false, preserveFocus: false });
					break;
				}

				const result = yield* getSteps(
					this.container,
					{ command: 'show', state: { repo: state.repo, reference: context.commit } },
					context,
					this.startedFrom,
				);
				if (result === StepResultBreak) {
					if (step.goBack() == null) break;
					continue;
				}

				steps.markStepsComplete();
			}
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	private *pickSearchOperatorStep(
		state: StepState<State<GlRepository>>,
		context: Context,
	): StepResultGenerator<string> {
		type Items =
			| { type: 'add'; operator: SearchOperatorsLongForm }
			| { type: 'search'; useNaturalLanguage: boolean; value?: string };

		const items: QuickPickItemOfT<Items>[] = [
			{
				label: searchOperatorToTitleMap.get('')!,
				description: l10n.t(
					'{message} or {messageOperator} or {messageAlias} {dash} use quotes to search for phrases',
					{
						message: '<message>',
						messageOperator: 'message:<message>',
						messageAlias: '=:<message>',
						dash: GlyphChars.Dash,
					},
				),
				alwaysShow: true,
				item: { type: 'add', operator: 'message:' },
			},
			{
				label: searchOperatorToTitleMap.get('-message:')!,
				description: l10n.t('{messageOperator} {dash} excludes commits whose message contains the term', {
					messageOperator: '-message:<message>',
					dash: GlyphChars.Dash,
				}),
				alwaysShow: true,
				item: { type: 'add', operator: '-message:' },
			},
			{
				label: searchOperatorToTitleMap.get('author:')!,
				description: l10n.t('{author} or {authorAlias}', {
					author: 'author:<author>',
					authorAlias: '@:<author>',
				}),
				buttons: [UseAuthorPickerQuickInputButton],
				alwaysShow: true,
				item: { type: 'add', operator: 'author:' },
			},
			{
				label: searchOperatorToTitleMap.get('committer:')!,
				description: 'committer:<committer>',
				alwaysShow: true,
				item: { type: 'add', operator: 'committer:' },
			},
			{
				label: searchOperatorToTitleMap.get('commit:')!,
				description: l10n.t('{sha} or {commit} or {commitAlias}', {
					sha: '<sha>',
					commit: 'commit:<sha>',
					commitAlias: '#:<sha>',
				}),
				alwaysShow: true,
				item: { type: 'add', operator: 'commit:' },
			},
			{
				label: searchOperatorToTitleMap.get('ref:')!,
				description: l10n.t('{ref} or {refAlias} (supports ranges like {range})', {
					ref: 'ref:<ref>',
					refAlias: '^:<ref>',
					range: 'main..feature',
				}),
				buttons: [UseRefPickerQuickInputButton],
				alwaysShow: true,
				item: { type: 'add', operator: 'ref:' },
			},
		];

		if (!context.hasVirtualFolders) {
			items.push(
				{
					label: searchOperatorToTitleMap.get('type:')!,
					description: l10n.t('{stashType} or {stashAlias}; {tipType} or {tipAlias}', {
						stashType: 'type:stash',
						stashAlias: 'is:stash',
						tipType: 'type:tip',
						tipAlias: 'is:tip',
					}),
					alwaysShow: true,
					item: { type: 'add', operator: 'type:' },
				},
				createQuickPickSeparator(),
				{
					label: searchOperatorToTitleMap.get('file:')!,
					description: l10n.t('{fileGlob} or {fileAlias}', {
						fileGlob: 'file: glob',
						fileAlias: '?: glob',
					}),
					buttons: [UseFilePickerQuickInputButton, UseFolderPickerQuickInputButton],
					alwaysShow: true,
					item: { type: 'add', operator: 'file:' },
				},
				{
					label: searchOperatorToTitleMap.get('change:')!,
					description: l10n.t('{changePattern} or {changeAlias}', {
						changePattern: 'change: pattern',
						changeAlias: '~: pattern',
					}),
					alwaysShow: true,
					item: { type: 'add', operator: 'change:' },
				},
				createQuickPickSeparator(),
				{
					label: searchOperatorToTitleMap.get('after:')!,
					description: l10n.t('{afterDate} or {sinceDate}', {
						afterDate: 'after: date',
						sinceDate: 'since: date',
					}),
					alwaysShow: true,
					item: { type: 'add', operator: 'after:' },
				},
				{
					label: searchOperatorToTitleMap.get('before:')!,
					description: l10n.t('{beforeDate} or {untilDate}', {
						beforeDate: 'before: date',
						untilDate: 'until: date',
					}),
					alwaysShow: true,
					item: { type: 'add', operator: 'before:' },
				},
			);
		}

		const aiAllowed = this.container.ai.allowed;

		const matchCaseButton = createMatchCaseToggle(state.matchCase);
		const matchAllButton = createMatchAllToggle(state.matchAll);
		const matchRegexButton = createMatchRegexToggle(state.matchRegex);
		const matchWholeWordButton = createMatchWholeWordToggle(state.matchWholeWord);

		const step = createPickStep<(typeof items)[number]>({
			title: appendReposToTitle(context.title, state, context),
			placeholder:
				aiAllowed && state.naturalLanguage
					? l10n.t('e.g. "Show my commits from last month"')
					: l10n.t('e.g. "Updates dependencies" {authorQuery}', { authorQuery: 'author:eamodio' }),
			ignoreFocusOut: true,
			matchOnDescription: true,
			matchOnDetail: true,
			additionalButtons: [matchCaseButton, matchWholeWordButton, matchRegexButton, matchAllButton],
			items: items,
			value: typeof state.naturalLanguage === 'object' ? state.naturalLanguage.query : state.query,
			selectValueWhenShown: false,
			canGoBack: true, // Always show back button - onGoBack clears query first
			onGoBack: quickpick => {
				// If there's a query, clear it first instead of going back
				if (quickpick.value.length) {
					quickpick.value = '';
					return true; // Prevent default back navigation
				}
				return false; // Allow default back navigation
			},
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
					state.matchAll = flipToggle(button);
				} else if (button === matchCaseButton) {
					state.matchCase = flipToggle(button);
				} else if (button === matchRegexButton) {
					state.matchRegex = flipToggle(button);
				} else if (button === matchWholeWordButton) {
					state.matchWholeWord = flipToggle(button);
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
				const { operations } = parseSearchQuery({
					query: value,
					matchAll: state.matchAll,
					matchCase: state.matchCase,
					matchRegex: state.matchRegex,
					matchWholeWord: state.matchWholeWord,
				});

				quickpick.title = appendReposToTitle(
					operations.size === 1
						? l10n.t('Commit {0}', searchOperatorToTitleMap.get(first(operations.keys())!)!)
						: context.title,
					state,
					context,
				);

				if (!quickpick.value.length) {
					quickpick.items = items;
				} else {
					// If something was typed/selected, keep the quick pick open on focus loss
					quickpick.ignoreFocusOut = true;
					step.ignoreFocusOut = true;

					const newItems: QuickPickItemOfT<Items>[] = [...items];

					const searchItem: QuickPickItemOfT<Items> = {
						label: l10n.t('Search for'),
						description: quickpick.value,
						iconPath: new ThemeIcon('search'),
						item: { type: 'search', useNaturalLanguage: false },
						picked: true,
					};

					if (aiAllowed) {
						const naturalLanguageItem: QuickPickItemOfT<Items> = {
							label: l10n.t('Search using Natural Language'),
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
		if (!canPickStepContinue(step, state, selection)) return StepResultBreak;

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
	state: StepState<State<GlRepository>>,
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
			l10n.t('Search by Author'),
			l10n.t('Choose contributors to include commits from'),
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
			title: l10n.t('Search by File'),
			openLabel: l10n.t('Add to Search'),
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
			l10n.t('Search by Reference or Range'),
			l10n.t('Choose a reference to search'),
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

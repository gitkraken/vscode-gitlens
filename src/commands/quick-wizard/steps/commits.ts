import type { QuickInputButton } from 'vscode';
import { GlyphChars } from '../../../constants.js';
import { openChanges, revealCommit, showCommitInDetailsView } from '../../../git/actions/commit.js';
import { revealStash, showStashInDetailsView } from '../../../git/actions/stash.js';
import type { GitCommit, GitStashCommit } from '../../../git/models/commit.js';
import { isCommit, isStash } from '../../../git/models/commit.js';
import type { GitLog } from '../../../git/models/log.js';
import type { GitRevisionReference } from '../../../git/models/reference.js';
import { RemoteResourceType } from '../../../git/models/remoteResource.js';
import type { Repository } from '../../../git/models/repository.js';
import { createReference, getReferenceLabel, isStashReference } from '../../../git/utils/reference.utils.js';
import { getHighlanderProviderName } from '../../../git/utils/remote.utils.js';
import {
	CommitApplyFileChangesCommandQuickPickItem,
	CommitBrowseRepositoryFromHereCommandQuickPickItem,
	CommitCompareWithHEADCommandQuickPickItem,
	CommitCompareWithWorkingCommandQuickPickItem,
	CommitCopyIdQuickPickItem,
	CommitCopyMessageQuickPickItem,
	CommitExplainCommandQuickPickItem,
	CommitFileQuickPickItem,
	CommitFilesQuickPickItem,
	CommitOpenAllChangesCommandQuickPickItem,
	CommitOpenAllChangesWithDiffToolCommandQuickPickItem,
	CommitOpenAllChangesWithWorkingCommandQuickPickItem,
	CommitOpenChangesCommandQuickPickItem,
	CommitOpenChangesWithDiffToolCommandQuickPickItem,
	CommitOpenChangesWithWorkingCommandQuickPickItem,
	CommitOpenDetailsCommandQuickPickItem,
	CommitOpenDirectoryCompareCommandQuickPickItem,
	CommitOpenDirectoryCompareWithWorkingCommandQuickPickItem,
	CommitOpenFileCommandQuickPickItem,
	CommitOpenFilesCommandQuickPickItem,
	CommitOpenInGraphCommandQuickPickItem,
	CommitOpenRevisionCommandQuickPickItem,
	CommitOpenRevisionsCommandQuickPickItem,
	CommitRestoreFileChangesCommandQuickPickItem,
} from '../../../quickpicks/items/commits.js';
import type { QuickPickSeparator } from '../../../quickpicks/items/common.js';
import { CommandQuickPickItem, createQuickPickSeparator } from '../../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import type { CommitQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import { createCommitQuickPickItem, GitWizardQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import {
	CopyRemoteResourceCommandQuickPickItem,
	OpenRemoteResourceCommandQuickPickItem,
} from '../../../quickpicks/remoteProviderPicker.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { formatPath } from '../../../system/-webview/formatPath.js';
import { filterMap } from '../../../system/array.js';
import { first, map } from '../../../system/iterable.js';
import { pad } from '../../../system/string.js';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	StepResultGenerator,
	StepsContext,
	StepSelection,
} from '../models/steps.js';
import { StepResultBreak } from '../models/steps.js';
import type { QuickPickStep } from '../models/steps.quickpick.js';
import {
	LoadMoreQuickInputButton,
	OpenChangesViewQuickInputButton,
	RevealInSideBarQuickInputButton,
	ShowDetailsViewQuickInputButton,
} from '../quickButtons.js';
import {
	appendReposToTitle,
	canPickStepContinue,
	createPickStep,
	getValidateGitReferenceFn,
} from '../utils/steps.utils.js';

export function* pickCommitStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[] },
>(
	state: State,
	context: Context,
	options: {
		emptyItems?: DirectiveQuickPickItem[];
		ignoreFocusOut?: boolean;
		log: GitLog | undefined;
		onDidLoadMore?: (log: GitLog | undefined) => void;
		picked?: string | string[] | undefined;
		placeholder: string | ((context: Context, log: GitLog | undefined) => string);
		showInSideBarCommand?: CommandQuickPickItem;
		showInSideBarButton?: {
			button: QuickInputButton;
			onDidClick: (items: Readonly<CommitQuickPickItem[]>) => void;
		};
		title?: string;
	},
): StepResultGenerator<GitCommit> {
	async function getItems(log: GitLog | undefined) {
		if (!log?.commits.size) {
			return (
				options?.emptyItems ?? [
					createDirectiveQuickPickItem(Directive.Back, true),
					createDirectiveQuickPickItem(Directive.Cancel),
				]
			);
		}

		const buttons = [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton];

		// If these are "file" commits, then add an Open Changes button
		if (first(log.commits)?.[1].file != null) {
			buttons.splice(0, 0, OpenChangesViewQuickInputButton);
		}

		const items: (CommitQuickPickItem | DirectiveQuickPickItem)[] = filterMap(
			await Promise.allSettled(
				map(log.commits.values(), async commit =>
					createCommitQuickPickItem(
						commit,
						options.picked != null &&
							(typeof options.picked === 'string'
								? commit.ref === options.picked
								: options.picked.includes(commit.ref)),
						{
							buttons: buttons,
							compact: true,
							icon: 'avatar',
						},
					),
				),
			),
			r => (r.status === 'fulfilled' ? r.value : undefined),
		);

		if (log.hasMore) {
			items.push(createDirectiveQuickPickItem(Directive.LoadMore));
		}

		return items;
	}

	const items = getItems(options.log).then(items =>
		options.showInSideBarCommand != null ? [options.showInSideBarCommand, ...items] : items,
	);

	const step = createPickStep<CommandQuickPickItem | CommitQuickPickItem>({
		title: appendReposToTitle(options.title ?? context.title, state, context),
		placeholder:
			typeof options.placeholder === 'string' ? options.placeholder : options.placeholder(context, options.log),
		ignoreFocusOut: options.ignoreFocusOut,
		matchOnDescription: true,
		matchOnDetail: true,
		value: typeof options.picked === 'string' && options.log?.count === 0 ? options.picked : undefined,
		selectValueWhenShown: true,
		items: items,
		canGoBack: context.steps?.canGoBack,
		additionalButtons: [
			...(options.showInSideBarButton?.button != null ? [options.showInSideBarButton.button] : []),
			...(options.log?.hasMore ? [LoadMoreQuickInputButton] : []),
		],
		onDidLoadMore: async quickpick => {
			quickpick.keepScrollPosition = true;
			options.log = await options.log?.more?.(configuration.get('advanced.maxListItems'));
			options.onDidLoadMore?.(options.log);
			if (typeof options.placeholder !== 'string') {
				quickpick.placeholder = options.placeholder(context, options.log);
			}
			return getItems(options.log);
		},
		onDidClickItemButton: (_quickpick, button, item) => {
			if (CommandQuickPickItem.is(item)) return;

			switch (button) {
				case ShowDetailsViewQuickInputButton:
					void showCommitInDetailsView(item.item, { pin: false, preserveFocus: true });
					break;

				case RevealInSideBarQuickInputButton:
					void revealCommit(item.item, { select: true, focus: false, expand: true });
					break;
				case OpenChangesViewQuickInputButton: {
					const path = item.item.file?.path;
					if (path != null) {
						void openChanges(path, item.item);
					}
					break;
				}
			}
		},
		onDidClickButton: (quickpick, button) => {
			if (options.log == null) return;

			const items = quickpick.activeItems.filter<CommitQuickPickItem>(
				(i): i is CommitQuickPickItem => !CommandQuickPickItem.is(i),
			);

			if (button === options.showInSideBarButton?.button) {
				options.showInSideBarButton?.onDidClick(items);
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			const items = quickpick.activeItems.filter<CommitQuickPickItem>(
				(i): i is CommitQuickPickItem => !CommandQuickPickItem.is(i),
			);

			if (key === 'ctrl+right') {
				void showCommitInDetailsView(items[0].item, { pin: false, preserveFocus: true });
			} else {
				await revealCommit(items[0].item, { select: true, focus: false, expand: true });
			}
		},
		onValidateValue: getValidateGitReferenceFn(state.repo, {
			revs: { allow: true, buttons: [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton] },
		}),
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? (selection[0] as CommitQuickPickItem).item : StepResultBreak;
}

export function* pickCommitsStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[] },
>(
	state: State,
	context: Context,
	options: {
		emptyItems?: DirectiveQuickPickItem[];
		log: GitLog | undefined;
		onDidLoadMore?: (log: GitLog | undefined) => void;
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context, log: GitLog | undefined) => string);
		title?: string;
	},
): StepResultGenerator<GitRevisionReference[]> {
	async function getItems(log: GitLog | undefined) {
		if (!log?.commits.size) {
			return (
				options?.emptyItems ?? [
					createDirectiveQuickPickItem(Directive.Back, true),
					createDirectiveQuickPickItem(Directive.Cancel),
				]
			);
		}

		const items = filterMap(
			await Promise.allSettled(
				map(log.commits.values(), async commit =>
					createCommitQuickPickItem(
						commit,
						options.picked != null &&
							(typeof options.picked === 'string'
								? commit.ref === options.picked
								: options.picked.includes(commit.ref)),
						{
							buttons: [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton],
							compact: true,
							icon: 'avatar',
						},
					),
				),
			),
			r => (r.status === 'fulfilled' ? r.value : undefined),
		);

		// Since this is multi-select, we can't have a "Load more" item
		// if (log.hasMore) {
		// 	items.push(createDirectiveQuickPickItem(Directive.LoadMore));
		// }

		return items;
	}

	const step = createPickStep<CommitQuickPickItem>({
		title: appendReposToTitle(options.title ?? context.title, state, context),
		multiselect: (options.log?.commits.size ?? 0) > 0,
		placeholder:
			typeof options.placeholder === 'string' ? options.placeholder : options.placeholder(context, options.log),
		matchOnDescription: true,
		matchOnDetail: true,
		items: getItems(options.log),
		canGoBack: context.steps?.canGoBack,
		onDidLoadMore: async quickpick => {
			quickpick.keepScrollPosition = true;
			options.log = await options.log?.more?.(configuration.get('advanced.maxListItems'));
			options.onDidLoadMore?.(options.log);
			if (typeof options.placeholder !== 'string') {
				quickpick.placeholder = options.placeholder(context, options.log);
			}
			return getItems(options.log);
		},
		additionalButtons: [...(options.log?.hasMore ? [LoadMoreQuickInputButton] : [])],
		onDidClickItemButton: (_quickpick, button, { item }) => {
			switch (button) {
				case ShowDetailsViewQuickInputButton:
					void showCommitInDetailsView(item, { pin: false, preserveFocus: true });
					break;

				case RevealInSideBarQuickInputButton:
					void revealCommit(item, { select: true, focus: false, expand: true });
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, key, { item }) => {
			if (key === 'ctrl+right') {
				void showCommitInDetailsView(item, { pin: false, preserveFocus: true });
			} else {
				await revealCommit(item, { select: true, focus: false, expand: true });
			}
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}

export function* showCommitOrStashStep<
	State extends PartialStepState & { repo: Repository; reference: GitCommit | GitStashCommit },
	Context extends StepsContext<any> & { repos: Repository[] },
>(
	state: State,
	context: Context,
): StepResultGenerator<CommitFilesQuickPickItem | GitWizardQuickPickItem | CommandQuickPickItem> {
	const step: QuickPickStep<CommitFilesQuickPickItem | GitWizardQuickPickItem | CommandQuickPickItem> =
		createPickStep({
			title: appendReposToTitle(
				getReferenceLabel(state.reference, {
					capitalize: true,
					icon: false,
				}),
				state,
				context,
			),
			placeholder: getReferenceLabel(state.reference, { capitalize: true, icon: false }),
			ignoreFocusOut: true,
			items: getShowCommitOrStashStepItems(state),
			canGoBack: context.steps?.canGoBack,
			// additionalButtons: [ShowDetailsView, RevealInSideBar],
			onDidClickItemButton: (_quickpick, button, _item) => {
				switch (button) {
					case ShowDetailsViewQuickInputButton:
						if (isStashReference(state.reference)) {
							void showStashInDetailsView(state.reference, { pin: false, preserveFocus: true });
						} else {
							void showCommitInDetailsView(state.reference, { pin: false, preserveFocus: true });
						}
						break;
					case RevealInSideBarQuickInputButton:
						if (isStashReference(state.reference)) {
							void revealStash(state.reference, { select: true, focus: false, expand: true });
						} else {
							void revealCommit(state.reference, { select: true, focus: false, expand: true });
						}
						break;
				}
			},
			keys: ['right', 'alt+right', 'ctrl+right'],
			onDidPressKey: async (_quickpick, key, item) => {
				await item.onDidPressKey(key);
			},
		});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0] : StepResultBreak;
}

export async function* showCommitOrStashFilesStep<
	State extends PartialStepState & {
		repo: Repository;
		reference: GitCommit | GitStashCommit;
		fileName?: string | undefined;
	},
	Context extends StepsContext<any> & { repos: Repository[] },
>(
	state: State,
	context: Context,
	options?: { picked?: string },
): AsyncStepResultGenerator<CommitFilesQuickPickItem | CommitFileQuickPickItem> {
	if (!state.reference.hasFullDetails()) {
		await state.reference.ensureFullDetails();
	}

	const step: QuickPickStep<CommitFilesQuickPickItem | CommitFileQuickPickItem> = createPickStep({
		title: appendReposToTitle(
			getReferenceLabel(state.reference, {
				capitalize: true,
				icon: false,
			}),
			state,
			context,
		),
		placeholder: getReferenceLabel(state.reference, { capitalize: true, icon: false }),
		ignoreFocusOut: true,
		items: [
			new CommitFilesQuickPickItem(state.reference, {
				picked: state.fileName == null,
				hint: `Click to see ${isStash(state.reference) ? 'stash' : 'commit'} actions`,
			}),
			createQuickPickSeparator('Files'),
			...(state.reference.anyFiles?.map(
				fs => new CommitFileQuickPickItem(state.reference, fs, options?.picked === fs.path),
			) ?? []),
		] as (CommitFilesQuickPickItem | CommitFileQuickPickItem)[],
		matchOnDescription: true,
		canGoBack: context.steps?.canGoBack,
		// additionalButtons: [ShowDetailsView, RevealInSideBar],
		onDidClickItemButton: (_quickpick, button, _item) => {
			switch (button) {
				case ShowDetailsViewQuickInputButton:
					if (isStashReference(state.reference)) {
						void showStashInDetailsView(state.reference, { pin: false, preserveFocus: true });
					} else {
						void showCommitInDetailsView(state.reference, { pin: false, preserveFocus: true });
					}
					break;
				case RevealInSideBarQuickInputButton:
					if (isStashReference(state.reference)) {
						void revealStash(state.reference, { select: true, focus: false, expand: true });
					} else {
						void revealCommit(state.reference, { select: true, focus: false, expand: true });
					}
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, key, item) => {
			await item.onDidPressKey(key);
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0] : StepResultBreak;
}

export function* showCommitOrStashFileStep<
	State extends PartialStepState & {
		repo: Repository;
		reference: GitCommit | GitStashCommit;
		fileName: string;
	},
	Context extends StepsContext<any> & { repos: Repository[] },
>(state: State, context: Context): StepResultGenerator<CommandQuickPickItem> {
	const step: QuickPickStep<CommandQuickPickItem> = createPickStep<CommandQuickPickItem>({
		title: appendReposToTitle(
			getReferenceLabel(state.reference, {
				capitalize: true,
				icon: false,
			}),
			state,
			context,
			`${pad(GlyphChars.Dot, 2, 2)}${formatPath(state.fileName, { fileOnly: true })}`,
		),
		placeholder: `${formatPath(state.fileName, {
			relativeTo: state.repo.path,
		})} in ${getReferenceLabel(state.reference, {
			icon: false,
		})}`,
		ignoreFocusOut: true,
		items: getShowCommitOrStashFileStepItems(state),
		matchOnDescription: true,
		canGoBack: context.steps?.canGoBack,
		// additionalButtons: [ShowDetailsView, RevealInSideBar],
		onDidClickItemButton: (_quickpick, button, _item) => {
			switch (button) {
				case ShowDetailsViewQuickInputButton:
					if (isStashReference(state.reference)) {
						void showStashInDetailsView(state.reference, { pin: false, preserveFocus: true });
					} else {
						void showCommitInDetailsView(state.reference, { pin: false, preserveFocus: true });
					}
					break;
				case RevealInSideBarQuickInputButton:
					if (isStashReference(state.reference)) {
						void revealStash(state.reference, { select: true, focus: false, expand: true });
					} else {
						void revealCommit(state.reference, { select: true, focus: false, expand: true });
					}
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, key, item) => {
			await item.onDidPressKey(key);
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0] : StepResultBreak;
}

async function getShowCommitOrStashStepItems<
	State extends PartialStepState & { repo: Repository; reference: GitCommit | GitStashCommit },
>(state: State): Promise<CommandQuickPickItem[]> {
	const items: (CommandQuickPickItem | QuickPickSeparator)[] = [
		new CommitOpenDetailsCommandQuickPickItem(state.reference),
		new CommitOpenInGraphCommandQuickPickItem(state.reference),
	];

	let unpublished: boolean | undefined;

	if (isStash(state.reference)) {
		items.push(
			createQuickPickSeparator('Actions'),
			new GitWizardQuickPickItem('Apply Stash...', {
				command: 'stash',
				state: {
					subcommand: 'apply',
					repo: state.repo,
					reference: state.reference,
				},
			}),
			new GitWizardQuickPickItem('Rename Stash...', {
				command: 'stash',
				state: {
					subcommand: 'rename',
					repo: state.repo,
					reference: state.reference,
				},
			}),
			new GitWizardQuickPickItem('Drop Stash...', {
				command: 'stash',
				state: {
					subcommand: 'drop',
					repo: state.repo,
					references: [state.reference],
				},
			}),

			createQuickPickSeparator(),
			new CommitCopyMessageQuickPickItem(state.reference),
		);
	} else {
		items.push(createQuickPickSeparator(), new CommitExplainCommandQuickPickItem(state.reference));

		const remotes = await state.repo.git.remotes.getRemotesWithProviders({ sort: true });
		if (remotes?.length) {
			items.push(
				createQuickPickSeparator(getHighlanderProviderName(remotes) ?? 'Remote'),
				new OpenRemoteResourceCommandQuickPickItem(remotes, {
					type: RemoteResourceType.Commit,
					sha: state.reference.sha,
				}),
				new CopyRemoteResourceCommandQuickPickItem(remotes, {
					type: RemoteResourceType.Commit,
					sha: state.reference.sha,
				}),
			);
		}

		items.push(createQuickPickSeparator('Actions'));

		const branch = await state.repo.git.branches.getBranch();
		const [branches, published] = await Promise.all([
			branch != null
				? state.repo.git.branches.getBranchesWithCommits([state.reference.ref], branch.name, {
						commitDate: isCommit(state.reference) ? state.reference.committer.date : undefined,
					})
				: undefined,
			!branch?.remote && branch?.upstream != null ? state.reference.isPushed() : undefined,
		]);

		const commitOnCurrentBranch = Boolean(branches?.length);
		if (commitOnCurrentBranch) {
			unpublished = !published;
			if (unpublished) {
				// TODO@eamodio Add Undo commit, if HEAD & unpushed

				items.push(
					new GitWizardQuickPickItem('Push to Commit...', {
						command: 'push',
						state: {
							repos: state.repo,
							reference: state.reference,
						},
					}),
				);
			}

			items.push(
				new GitWizardQuickPickItem('Revert Commit...', {
					command: 'revert',
					state: {
						repo: state.repo,
						references: [state.reference],
					},
				}),
				new GitWizardQuickPickItem(`Reset ${branch?.name ?? 'Current Branch'} to Commit...`, {
					command: 'reset',
					state: {
						repo: state.repo,
						reference: state.reference,
					},
				}),
				new GitWizardQuickPickItem(`Reset ${branch?.name ?? 'Current Branch'} to Previous Commit...`, {
					command: 'reset',
					state: {
						repo: state.repo,
						reference: createReference(`${state.reference.ref}^`, state.reference.repoPath, {
							refType: 'revision',
							name: `${state.reference.name}^`,
							message: state.reference.message,
						}),
					},
				}),
			);
		} else {
			items.push(
				new GitWizardQuickPickItem('Cherry Pick Commit...', {
					command: 'cherry-pick',
					state: {
						repo: state.repo,
						references: [state.reference],
					},
				}),
			);
		}

		items.push(
			new GitWizardQuickPickItem(`Rebase ${branch?.name ?? 'Current Branch'} onto Commit...`, {
				command: 'rebase',
				state: {
					repo: state.repo,
					destination: state.reference,
				},
			}),
			new GitWizardQuickPickItem('Switch to Commit...', {
				command: 'switch',
				state: {
					repos: [state.repo],
					reference: state.reference,
				},
			}),

			createQuickPickSeparator(),
			new GitWizardQuickPickItem('Create Branch at Commit...', {
				command: 'branch',
				state: {
					subcommand: 'create',
					repo: state.repo,
					reference: state.reference,
				},
			}),
			new GitWizardQuickPickItem('Create Tag at Commit...', {
				command: 'tag',
				state: {
					subcommand: 'create',
					repo: state.repo,
					reference: state.reference,
				},
			}),

			createQuickPickSeparator('Copy'),
			new CommitCopyIdQuickPickItem(state.reference),
			new CommitCopyMessageQuickPickItem(state.reference),
		);
	}

	items.push(
		createQuickPickSeparator('Open'),
		new CommitOpenAllChangesCommandQuickPickItem(state.reference),
		new CommitOpenAllChangesWithWorkingCommandQuickPickItem(state.reference),
		new CommitOpenAllChangesWithDiffToolCommandQuickPickItem(state.reference),
		createQuickPickSeparator(),
		new CommitOpenFilesCommandQuickPickItem(state.reference),
		new CommitOpenRevisionsCommandQuickPickItem(state.reference),
	);

	items.push(
		createQuickPickSeparator('Compare'),
		new CommitCompareWithHEADCommandQuickPickItem(state.reference),
		new CommitCompareWithWorkingCommandQuickPickItem(state.reference),
	);

	items.push(
		createQuickPickSeparator(),
		new CommitOpenDirectoryCompareCommandQuickPickItem(state.reference),
		new CommitOpenDirectoryCompareWithWorkingCommandQuickPickItem(state.reference),
	);

	items.push(
		createQuickPickSeparator('Browse'),
		new CommitBrowseRepositoryFromHereCommandQuickPickItem(state.reference, { openInNewWindow: false }),
		new CommitBrowseRepositoryFromHereCommandQuickPickItem(state.reference, {
			before: true,
			openInNewWindow: false,
		}),
		new CommitBrowseRepositoryFromHereCommandQuickPickItem(state.reference, { openInNewWindow: true }),
		new CommitBrowseRepositoryFromHereCommandQuickPickItem(state.reference, {
			before: true,
			openInNewWindow: true,
		}),
	);

	items.unshift(
		new CommitFilesQuickPickItem(state.reference, {
			unpublished: unpublished,
			hint: 'Click to see all changed files',
		}),
	);
	return items as CommandQuickPickItem[];
}

async function getShowCommitOrStashFileStepItems<
	State extends PartialStepState & {
		repo: Repository;
		reference: GitCommit | GitStashCommit;
		fileName: string;
	},
>(state: State) {
	const file = await state.reference.findFile(state.fileName);
	if (file == null) return [];

	const items: (CommandQuickPickItem | QuickPickSeparator)[] = [
		new CommitOpenDetailsCommandQuickPickItem(state.reference),
		new CommitOpenInGraphCommandQuickPickItem(state.reference),
	];

	if (isStash(state.reference)) {
		items.push(
			createQuickPickSeparator(),
			new CommitCopyMessageQuickPickItem(state.reference),
			createQuickPickSeparator('Actions'),
			new CommitApplyFileChangesCommandQuickPickItem(state.reference, file),
			new CommitRestoreFileChangesCommandQuickPickItem(state.reference, file),
			createQuickPickSeparator(),
			new CommitCopyMessageQuickPickItem(state.reference),
		);
	} else {
		items.push(createQuickPickSeparator(), new CommitExplainCommandQuickPickItem(state.reference));

		const remotes = await state.repo.git.remotes.getRemotesWithProviders({ sort: true });
		if (remotes?.length) {
			items.push(
				createQuickPickSeparator(getHighlanderProviderName(remotes) ?? 'Remote'),
				new OpenRemoteResourceCommandQuickPickItem(remotes, {
					type: RemoteResourceType.Revision,
					fileName: state.fileName,
					commit: state.reference,
				}),
				new CopyRemoteResourceCommandQuickPickItem(remotes, {
					type: RemoteResourceType.Revision,
					fileName: state.fileName,
					commit: state.reference,
				}),
				createQuickPickSeparator(),
				new OpenRemoteResourceCommandQuickPickItem(remotes, {
					type: RemoteResourceType.Commit,
					sha: state.reference.ref,
				}),
				new CopyRemoteResourceCommandQuickPickItem(remotes, {
					type: RemoteResourceType.Commit,
					sha: state.reference.sha,
				}),
			);
		}

		items.push(
			createQuickPickSeparator('Actions'),
			new CommitApplyFileChangesCommandQuickPickItem(state.reference, file),
			new CommitRestoreFileChangesCommandQuickPickItem(state.reference, file),
			createQuickPickSeparator('Copy'),
			new CommitCopyIdQuickPickItem(state.reference),
			new CommitCopyMessageQuickPickItem(state.reference),
		);
	}

	items.push(
		createQuickPickSeparator('Open'),
		new CommitOpenChangesCommandQuickPickItem(state.reference, state.fileName),
		new CommitOpenChangesWithWorkingCommandQuickPickItem(state.reference, state.fileName),
		new CommitOpenChangesWithDiffToolCommandQuickPickItem(state.reference, state.fileName),
		createQuickPickSeparator(),
	);

	if (file.status !== 'D') {
		items.push(new CommitOpenFileCommandQuickPickItem(state.reference, file));
	}
	items.push(new CommitOpenRevisionCommandQuickPickItem(state.reference, file));

	items.push(
		createQuickPickSeparator('Compare'),
		new CommitCompareWithHEADCommandQuickPickItem(state.reference),
		new CommitCompareWithWorkingCommandQuickPickItem(state.reference),
	);

	items.push(
		createQuickPickSeparator('Browse'),
		new CommitBrowseRepositoryFromHereCommandQuickPickItem(state.reference, { openInNewWindow: false }),
		new CommitBrowseRepositoryFromHereCommandQuickPickItem(state.reference, {
			before: true,
			openInNewWindow: false,
		}),
		new CommitBrowseRepositoryFromHereCommandQuickPickItem(state.reference, { openInNewWindow: true }),
		new CommitBrowseRepositoryFromHereCommandQuickPickItem(state.reference, {
			before: true,
			openInNewWindow: true,
		}),
	);

	items.unshift(
		new CommitFilesQuickPickItem(state.reference, { file: file, hint: 'Click to see all changed files' }),
	);
	return items as CommandQuickPickItem[];
}

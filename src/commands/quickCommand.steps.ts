import type { QuickInputButton, QuickPick } from 'vscode';
import { BranchSorting, configuration, TagSorting } from '../configuration';
import { Commands, GlyphChars, quickPickTitleMaxChars } from '../constants';
import { Container } from '../container';
import type { PlusFeatures } from '../features';
import type { PagedResult } from '../git/gitProvider';
import type { BranchSortOptions, GitBranch } from '../git/models/branch';
import { sortBranches } from '../git/models/branch';
import type { GitCommit, GitStashCommit } from '../git/models/commit';
import { isCommit, isStash } from '../git/models/commit';
import type { GitContributor } from '../git/models/contributor';
import type { GitLog } from '../git/models/log';
import type { GitBranchReference, GitRevisionReference, GitTagReference } from '../git/models/reference';
import { GitReference, GitRevision } from '../git/models/reference';
import { GitRemote } from '../git/models/remote';
import { RemoteResourceType } from '../git/models/remoteResource';
import { Repository } from '../git/models/repository';
import type { GitStash } from '../git/models/stash';
import type { GitStatus } from '../git/models/status';
import type { GitTag, TagSortOptions } from '../git/models/tag';
import { sortTags } from '../git/models/tag';
import type { GitWorktree } from '../git/models/worktree';
import {
	CommitApplyFileChangesCommandQuickPickItem,
	CommitBrowseRepositoryFromHereCommandQuickPickItem,
	CommitCompareWithHEADCommandQuickPickItem,
	CommitCompareWithWorkingCommandQuickPickItem,
	CommitCopyIdQuickPickItem,
	CommitCopyMessageQuickPickItem,
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
	OpenChangedFilesCommandQuickPickItem,
} from '../quickpicks/items/commits';
import { CommandQuickPickItem, QuickPickSeparator } from '../quickpicks/items/common';
import { Directive, DirectiveQuickPickItem } from '../quickpicks/items/directive';
import {
	BranchQuickPickItem,
	CommitQuickPickItem,
	ContributorQuickPickItem,
	GitCommandQuickPickItem,
	RefQuickPickItem,
	RepositoryQuickPickItem,
	TagQuickPickItem,
	WorktreeQuickPickItem,
} from '../quickpicks/items/gitCommands';
import type { ReferencesQuickPickItem } from '../quickpicks/referencePicker';
import {
	CopyRemoteResourceCommandQuickPickItem,
	OpenRemoteResourceCommandQuickPickItem,
} from '../quickpicks/remoteProviderPicker';
import { isSubscriptionPaidPlan, isSubscriptionPreviewTrialExpired } from '../subscription';
import { filterMap, intersection, isStringArray } from '../system/array';
import { formatPath } from '../system/formatPath';
import { map } from '../system/iterable';
import { getSettledValue } from '../system/promise';
import { pad, pluralize, truncate } from '../system/string';
import { OpenWorkspaceLocation } from '../system/utils';
import type { ViewsWithRepositoryFolders } from '../views/viewBase';
import { GitActions } from './gitCommands.actions';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	QuickPickStep,
	StepResultGenerator,
	StepSelection,
	StepState,
} from './quickCommand';
import { QuickCommand, QuickCommandButtons, StepResult } from './quickCommand';

export function appendReposToTitle<
	State extends { repo: Repository } | { repos: Repository[] },
	Context extends { repos: Repository[] },
>(title: string, state: State, context: Context, additionalContext?: string) {
	if (context.repos.length === 1) {
		return `${title}${truncate(additionalContext ?? '', quickPickTitleMaxChars - title.length)}`;
	}

	let repoContext;
	if ((state as { repo: Repository }).repo != null) {
		repoContext = `${additionalContext ?? ''}${pad(GlyphChars.Dot, 2, 2)}${
			(state as { repo: Repository }).repo.formattedName
		}`;
	} else if ((state as { repos: Repository[] }).repos.length === 1) {
		repoContext = `${additionalContext ?? ''}${pad(GlyphChars.Dot, 2, 2)}${
			(state as { repos: Repository[] }).repos[0].formattedName
		}`;
	} else {
		repoContext = `${pad(GlyphChars.Dot, 2, 2)}${(state as { repos: Repository[] }).repos.length} repositories`;
	}

	return `${title}${truncate(repoContext, quickPickTitleMaxChars - title.length)}`;
}

export async function getBranches(
	repos: Repository | Repository[],
	options: {
		buttons?: QuickInputButton[];
		filter?: (b: GitBranch) => boolean;
		picked?: string | string[];
		sort?: BranchSortOptions;
	},
): Promise<BranchQuickPickItem[]> {
	return getBranchesAndOrTags(repos, ['branches'], {
		buttons: options?.buttons,
		filter: options?.filter != null ? { branches: options.filter } : undefined,
		picked: options?.picked,
		sort: options?.sort != null ? { branches: options.sort } : true,
	}) as Promise<BranchQuickPickItem[]>;
}

export async function getTags(
	repos: Repository | Repository[],
	options?: {
		buttons?: QuickInputButton[];
		filter?: (t: GitTag) => boolean;
		picked?: string | string[];
		sort?: TagSortOptions;
	},
): Promise<TagQuickPickItem[]> {
	return getBranchesAndOrTags(repos, ['tags'], {
		buttons: options?.buttons,
		filter: options?.filter != null ? { tags: options.filter } : undefined,
		picked: options?.picked,
		sort: options?.sort != null ? { tags: options.sort } : true,
	}) as Promise<TagQuickPickItem[]>;
}

export async function getWorktrees(
	repoOrWorktrees: Repository | GitWorktree[],
	{
		buttons,
		filter,
		includeStatus,
		picked,
	}: {
		buttons?: QuickInputButton[];
		filter?: (t: GitWorktree) => boolean;
		includeStatus?: boolean;
		picked?: string | string[];
	},
): Promise<WorktreeQuickPickItem[]> {
	const worktrees = repoOrWorktrees instanceof Repository ? await repoOrWorktrees.getWorktrees() : repoOrWorktrees;
	return Promise.all<WorktreeQuickPickItem>([
		...worktrees
			.filter(w => filter == null || filter(w))
			.map(async w =>
				WorktreeQuickPickItem.create(
					w,
					picked != null &&
						(typeof picked === 'string' ? w.uri.toString() === picked : picked.includes(w.uri.toString())),
					{
						buttons: buttons,
						path: true,
						status: includeStatus ? await w.getStatus() : undefined,
					},
				),
			),
	]);
}

export async function getBranchesAndOrTags(
	repos: Repository | Repository[] | undefined,
	include: ('tags' | 'branches')[],
	{
		buttons,
		filter,
		picked,
		sort,
	}: {
		buttons?: QuickInputButton[];
		filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		picked?: string | string[];
		sort?: boolean | { branches?: BranchSortOptions; tags?: TagSortOptions };
	} = {},
): Promise<(BranchQuickPickItem | TagQuickPickItem)[]> {
	if (repos == null) return [];

	let branches: GitBranch[] | undefined;
	let tags: GitTag[] | undefined;

	let singleRepo = false;
	if (repos instanceof Repository || repos.length === 1) {
		singleRepo = true;
		const repo = repos instanceof Repository ? repos : repos[0];

		// TODO@eamodio handle paging
		const [branchesResult, tagsResult] = await Promise.allSettled([
			include.includes('branches')
				? repo.getBranches({
						filter: filter?.branches,
						sort: typeof sort === 'boolean' ? sort : sort?.branches,
				  })
				: undefined,
			include.includes('tags') ? repo.getTags({ filter: filter?.tags, sort: true }) : undefined,
		]);

		branches = getSettledValue(branchesResult)?.values ?? [];
		tags = getSettledValue(tagsResult)?.values ?? [];
	} else {
		// TODO@eamodio handle paging
		const [branchesByRepoResult, tagsByRepoResult] = await Promise.allSettled([
			include.includes('branches')
				? Promise.allSettled(
						repos.map(r =>
							r.getBranches({
								filter: filter?.branches,
								sort: typeof sort === 'boolean' ? sort : sort?.branches,
							}),
						),
				  )
				: undefined,
			include.includes('tags')
				? Promise.allSettled(
						repos.map(r =>
							r.getTags({ filter: filter?.tags, sort: typeof sort === 'boolean' ? sort : sort?.tags }),
						),
				  )
				: undefined,
		]);

		const branchesByRepo =
			branchesByRepoResult.status === 'fulfilled'
				? branchesByRepoResult.value
						?.filter((r): r is PromiseFulfilledResult<PagedResult<GitBranch>> => r.status === 'fulfilled')
						?.map(r => r.value.values)
				: undefined;
		const tagsByRepo =
			tagsByRepoResult.status === 'fulfilled'
				? tagsByRepoResult.value
						?.filter((r): r is PromiseFulfilledResult<PagedResult<GitTag>> => r.status === 'fulfilled')
						?.map(r => r.value.values)
				: undefined;

		if (include.includes('branches') && branchesByRepo != null) {
			branches = sortBranches(
				intersection(...branchesByRepo, (b1: GitBranch, b2: GitBranch) => b1.name === b2.name),
			);
		}

		if (include.includes('tags') && tagsByRepo != null) {
			tags = sortTags(intersection(...tagsByRepo, (t1: GitTag, t2: GitTag) => t1.name === t2.name));
		}
	}

	if ((branches == null || branches.length === 0) && (tags == null || tags.length === 0)) return [];

	if (branches != null && branches.length !== 0 && (tags == null || tags.length === 0)) {
		return [
			QuickPickSeparator.create('Branches'),
			...(await Promise.all(
				branches
					.filter(b => !b.remote)
					.map(b =>
						BranchQuickPickItem.create(
							b,
							picked != null && (typeof picked === 'string' ? b.ref === picked : picked.includes(b.ref)),
							{
								buttons: buttons,
								current: singleRepo ? 'checkmark' : false,
								ref: singleRepo,
								status: singleRepo,
								type: 'remote',
							},
						),
					),
			)),
			QuickPickSeparator.create('Remote Branches'),
			...(await Promise.all(
				branches
					.filter(b => b.remote)
					.map(b =>
						BranchQuickPickItem.create(
							b,
							picked != null && (typeof picked === 'string' ? b.ref === picked : picked.includes(b.ref)),
							{
								buttons: buttons,
								current: singleRepo ? 'checkmark' : false,
								ref: singleRepo,
								status: singleRepo,
								type: 'remote',
							},
						),
					),
			)),
		] as BranchQuickPickItem[];
	}

	if (tags != null && tags.length !== 0 && (branches == null || branches.length === 0)) {
		return tags.map(t =>
			TagQuickPickItem.create(
				t,
				picked != null && (typeof picked === 'string' ? t.ref === picked : picked.includes(t.ref)),
				{
					buttons: buttons,
					message: false, //singleRepo,
					ref: singleRepo,
				},
			),
		);
	}

	return [
		QuickPickSeparator.create('Branches'),
		...(await Promise.all(
			branches!
				.filter(b => !b.remote)
				.map(b =>
					BranchQuickPickItem.create(
						b,
						picked != null && (typeof picked === 'string' ? b.ref === picked : picked.includes(b.ref)),
						{
							buttons: buttons,
							current: singleRepo ? 'checkmark' : false,
							ref: singleRepo,
							status: singleRepo,
						},
					),
				),
		)),
		QuickPickSeparator.create('Tags'),
		...tags!.map(t =>
			TagQuickPickItem.create(
				t,
				picked != null && (typeof picked === 'string' ? t.ref === picked : picked.includes(t.ref)),
				{
					buttons: buttons,
					message: false, //singleRepo,
					ref: singleRepo,
					type: true,
				},
			),
		),
		QuickPickSeparator.create('Remote Branches'),
		...(await Promise.all(
			branches!
				.filter(b => b.remote)
				.map(b =>
					BranchQuickPickItem.create(
						b,
						picked != null && (typeof picked === 'string' ? b.ref === picked : picked.includes(b.ref)),
						{
							buttons: buttons,
							current: singleRepo ? 'checkmark' : false,
							ref: singleRepo,
							status: singleRepo,
							type: 'remote',
						},
					),
				),
		)),
	] as (BranchQuickPickItem | TagQuickPickItem)[];
}

export function getValidateGitReferenceFn(
	repos: Repository | Repository[] | undefined,
	options?: { buttons?: QuickInputButton[]; ranges?: boolean },
) {
	return async (quickpick: QuickPick<any>, value: string) => {
		let inRefMode = false;
		if (value.startsWith('#')) {
			inRefMode = true;
			value = value.substring(1);
		}

		if (repos == null) return false;
		if (Array.isArray(repos)) {
			if (repos.length !== 1) return false;

			repos = repos[0];
		}

		if (inRefMode && options?.ranges && GitRevision.isRange(value)) {
			quickpick.items = [
				RefQuickPickItem.create(value, repos.path, true, {
					alwaysShow: true,
					buttons: options?.buttons,
					ref: false,
					icon: false,
				}),
			];
			return true;
		}

		if (!(await Container.instance.git.validateReference(repos.path, value))) {
			if (inRefMode) {
				quickpick.items = [
					DirectiveQuickPickItem.create(Directive.Back, true, {
						label: 'Enter a reference or commit SHA',
					}),
				];
				return true;
			}

			return false;
		}

		if (!inRefMode) {
			if (
				await Container.instance.git.hasBranchOrTag(repos.path, {
					filter: { branches: b => b.name.includes(value), tags: t => t.name.includes(value) },
				})
			) {
				return false;
			}
		}

		const commit = await Container.instance.git.getCommit(repos.path, value);
		quickpick.items = [
			CommitQuickPickItem.create(commit!, true, {
				alwaysShow: true,
				buttons: options?.buttons,
				compact: true,
				icon: true,
			}),
		];
		return true;
	};
}

export async function* inputBranchNameStep<
	State extends PartialStepState & ({ repo: Repository } | { repos: Repository[] }),
	Context extends { repos: Repository[]; showTags?: boolean; title: string },
>(
	state: State,
	context: Context,
	options: { placeholder: string; titleContext?: string; value?: string },
): AsyncStepResultGenerator<string> {
	const step = QuickCommand.createInputStep({
		title: appendReposToTitle(`${context.title}${options.titleContext ?? ''}`, state, context),
		placeholder: options.placeholder,
		value: options.value,
		prompt: 'Enter branch name',
		validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
			if (value == null) return [false, undefined];

			value = value.trim();
			if (value.length === 0) return [false, 'Please enter a valid branch name'];

			if ('repo' in state) {
				const valid = await Container.instance.git.validateBranchOrTagName(state.repo.path, value);
				return [valid, valid ? undefined : `'${value}' isn't a valid branch name`];
			}

			let valid = true;

			for (const repo of state.repos) {
				valid = await Container.instance.git.validateBranchOrTagName(repo.path, value);
				if (!valid) {
					return [false, `'${value}' isn't a valid branch name`];
				}
			}

			return [true, undefined];
		},
	});

	const value: StepSelection<typeof step> = yield step;
	if (
		!QuickCommand.canStepContinue(step, state, value) ||
		!(await QuickCommand.canInputStepContinue(step, state, value))
	) {
		return StepResult.Break;
	}

	return value;
}

export async function* inputTagNameStep<
	State extends PartialStepState & ({ repo: Repository } | { repos: Repository[] }),
	Context extends { repos: Repository[]; showTags?: boolean; title: string },
>(
	state: State,
	context: Context,
	options: { placeholder: string; titleContext?: string; value?: string },
): AsyncStepResultGenerator<string> {
	const step = QuickCommand.createInputStep({
		title: appendReposToTitle(`${context.title}${options.titleContext ?? ''}`, state, context),
		placeholder: options.placeholder,
		value: options.value,
		prompt: 'Enter tag name',
		validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
			if (value == null) return [false, undefined];

			value = value.trim();
			if (value.length === 0) return [false, 'Please enter a valid tag name'];

			if ('repo' in state) {
				const valid = await Container.instance.git.validateBranchOrTagName(state.repo.path, value);
				return [valid, valid ? undefined : `'${value}' isn't a valid tag name`];
			}

			let valid = true;

			for (const repo of state.repos) {
				valid = await Container.instance.git.validateBranchOrTagName(repo.path, value);
				if (!valid) {
					return [false, `'${value}' isn't a valid branch name`];
				}
			}

			return [true, undefined];
		},
	});

	const value: StepSelection<typeof step> = yield step;
	if (
		!QuickCommand.canStepContinue(step, state, value) ||
		!(await QuickCommand.canInputStepContinue(step, state, value))
	) {
		return StepResult.Break;
	}

	return value;
}

export async function* pickBranchStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; showTags?: boolean; title: string },
>(
	state: State,
	context: Context,
	{
		filter,
		picked,
		placeholder,
		titleContext,
	}: {
		filter?: (b: GitBranch) => boolean;
		picked?: string | string[];
		placeholder: string;
		titleContext?: string;
	},
): AsyncStepResultGenerator<GitBranchReference> {
	const branches = await getBranches(state.repo, {
		buttons: [QuickCommandButtons.RevealInSideBar],
		filter: filter,
		picked: picked,
	});

	const step = QuickCommand.createPickStep<BranchQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: branches.length === 0 ? `No branches found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			branches.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: branches,
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === QuickCommandButtons.RevealInSideBar) {
				void GitActions.Branch.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await GitActions.Branch.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export async function* pickBranchesStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; showTags?: boolean; title: string },
>(
	state: State,
	context: Context,
	{
		filter,
		picked,
		placeholder,
		sort,
		titleContext,
	}: {
		filter?: (b: GitBranch) => boolean;
		picked?: string | string[];
		placeholder: string;
		sort?: BranchSortOptions;
		titleContext?: string;
	},
): AsyncStepResultGenerator<GitBranchReference[]> {
	const branches = await getBranches(state.repo, {
		buttons: [QuickCommandButtons.RevealInSideBar],
		filter: filter,
		picked: picked,
		sort: sort,
	});

	const step = QuickCommand.createPickStep<BranchQuickPickItem>({
		multiselect: branches.length !== 0,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: branches.length === 0 ? `No branches found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			branches.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: branches,
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === QuickCommandButtons.RevealInSideBar) {
				void GitActions.Branch.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await GitActions.Branch.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResult.Break;
}

export async function* pickBranchOrTagStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; pickCommitForItem?: boolean; showTags?: boolean; title: string },
>(
	state: State,
	context: Context,
	{
		filter,
		picked,
		placeholder,
		titleContext,
		value,
		additionalButtons,
		ranges,
	}: {
		filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context) => string);
		titleContext?: string;
		value: string | undefined;
		additionalButtons?: QuickInputButton[];
		ranges?: boolean;
	},
): AsyncStepResultGenerator<GitReference> {
	context.showTags = true;

	const showTagsButton = new QuickCommandButtons.ShowTagsToggle(context.showTags);

	const getBranchesAndOrTagsFn = async () => {
		return getBranchesAndOrTags(state.repo, context.showTags ? ['branches', 'tags'] : ['branches'], {
			buttons:
				typeof context.pickCommitForItem === 'boolean'
					? [QuickCommandButtons.PickCommit, QuickCommandButtons.RevealInSideBar]
					: [QuickCommandButtons.RevealInSideBar],
			filter: filter,
			picked: picked,
			sort: true,
		});
	};
	const branchesAndOrTags = await getBranchesAndOrTagsFn();

	const step = QuickCommand.createPickStep<ReferencesQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder:
			branchesAndOrTags.length === 0
				? `No branches${context.showTags ? ' or tags' : ''} found in ${state.repo.formattedName}`
				: `${typeof placeholder === 'string' ? placeholder : placeholder(context)}${GlyphChars.Space.repeat(
						3,
				  )}(or enter a reference using #)`,
		matchOnDescription: true,
		matchOnDetail: true,
		value: value,
		selectValueWhenShown: true,
		items:
			branchesAndOrTags.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: branchesAndOrTags,
		additionalButtons: [...(additionalButtons ?? []), showTagsButton],
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === QuickCommandButtons.PickCommit) {
				context.pickCommitForItem = true;
				return true;
			}

			if (button === QuickCommandButtons.RevealInSideBar) {
				if (GitReference.isBranch(item)) {
					void GitActions.Branch.reveal(item, { select: true, focus: false, expand: true });
				} else if (GitReference.isTag(item)) {
					void GitActions.Tag.reveal(item, { select: true, focus: false, expand: true });
				} else if (GitReference.isRevision(item)) {
					void GitActions.Commit.showDetailsView(item, { pin: false, preserveFocus: true });
				}
			}
			return false;
		},
		onDidClickButton: async (quickpick, button) => {
			if (button === showTagsButton) {
				quickpick.busy = true;

				try {
					context.showTags = !context.showTags;
					showTagsButton.on = context.showTags;

					const branchesAndOrTags = await getBranchesAndOrTagsFn();
					quickpick.placeholder =
						branchesAndOrTags.length === 0
							? `${state.repo.formattedName} has no branches${context.showTags ? ' or tags' : ''}`
							: `${
									typeof placeholder === 'string' ? placeholder : placeholder(context)
							  }${GlyphChars.Space.repeat(3)}(or enter a reference using #)`;
					quickpick.items = branchesAndOrTags;
				} finally {
					quickpick.busy = false;
				}
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			const item = quickpick.activeItems[0].item;
			if (GitReference.isBranch(item)) {
				void GitActions.Branch.reveal(item, { select: true, focus: false, expand: true });
			} else if (GitReference.isTag(item)) {
				void GitActions.Tag.reveal(item, { select: true, focus: false, expand: true });
			} else if (GitReference.isRevision(item)) {
				void GitActions.Commit.showDetailsView(item, { pin: false, preserveFocus: true });
			}
		},
		onValidateValue: getValidateGitReferenceFn(state.repo, { ranges: ranges }),
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export async function* pickBranchOrTagStepMultiRepo<
	State extends StepState & { repos: Repository[]; reference?: GitReference },
	Context extends { repos: Repository[]; showTags?: boolean; title: string },
>(
	state: State,
	context: Context,
	{
		filter,
		picked,
		placeholder,
		titleContext,
		value,
	}: {
		filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		picked?: string | string[];
		placeholder: string | ((context: Context) => string);
		titleContext?: string;
		value?: string;
	},
): AsyncStepResultGenerator<GitReference> {
	context.showTags = state.repos.length === 1;

	const showTagsButton = new QuickCommandButtons.ShowTagsToggle(context.showTags);

	const getBranchesAndOrTagsFn = () => {
		return getBranchesAndOrTags(state.repos, context.showTags ? ['branches', 'tags'] : ['branches'], {
			buttons: [QuickCommandButtons.RevealInSideBar],
			// Filter out remote branches if we are going to affect multiple repos
			filter: { branches: state.repos.length === 1 ? undefined : b => !b.remote, ...filter },
			picked: picked ?? state.reference?.ref,
			sort: { branches: { orderBy: BranchSorting.DateDesc }, tags: { orderBy: TagSorting.DateDesc } },
		});
	};
	const branchesAndOrTags = await getBranchesAndOrTagsFn();

	const step = QuickCommand.createPickStep<ReferencesQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder:
			branchesAndOrTags.length === 0
				? `No ${state.repos.length === 1 ? '' : 'common '}branches${
						context.showTags ? ' or tags' : ''
				  } found in ${
						state.repos.length === 1 ? state.repos[0].formattedName : `${state.repos.length} repositories`
				  }`
				: `${typeof placeholder === 'string' ? placeholder : placeholder(context)}${GlyphChars.Space.repeat(
						3,
				  )}(or enter a reference using #)`,
		matchOnDescription: true,
		matchOnDetail: true,
		value: value ?? (GitReference.isRevision(state.reference) ? state.reference.ref : undefined),
		selectValueWhenShown: true,
		items:
			branchesAndOrTags.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: branchesAndOrTags,
		additionalButtons: [showTagsButton],
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === QuickCommandButtons.RevealInSideBar) {
				if (GitReference.isBranch(item)) {
					void GitActions.Branch.reveal(item, { select: true, focus: false, expand: true });
				} else if (GitReference.isTag(item)) {
					void GitActions.Tag.reveal(item, { select: true, focus: false, expand: true });
				} else if (GitReference.isRevision(item)) {
					void GitActions.Commit.showDetailsView(item, { pin: false, preserveFocus: true });
				}
			}
		},
		onDidClickButton: async (quickpick, button) => {
			if (button === showTagsButton) {
				quickpick.busy = true;

				try {
					context.showTags = !context.showTags;
					showTagsButton.on = context.showTags;

					const branchesAndOrTags = await getBranchesAndOrTagsFn();
					quickpick.placeholder =
						branchesAndOrTags.length === 0
							? `No ${state.repos.length === 1 ? '' : 'common '}branches${
									context.showTags ? ' or tags' : ''
							  } found in ${
									state.repos.length === 1
										? state.repos[0].formattedName
										: `${state.repos.length} repositories`
							  }`
							: `${
									typeof placeholder === 'string' ? placeholder : placeholder(context)
							  }${GlyphChars.Space.repeat(3)}(or enter a reference using #)`;
					quickpick.items = branchesAndOrTags;
				} finally {
					quickpick.busy = false;
				}
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			const item = quickpick.activeItems[0].item;
			if (GitReference.isBranch(item)) {
				void GitActions.Branch.reveal(item, { select: true, focus: false, expand: true });
			} else if (GitReference.isTag(item)) {
				void GitActions.Tag.reveal(item, { select: true, focus: false, expand: true });
			} else if (GitReference.isRevision(item)) {
				void GitActions.Commit.showDetailsView(item, { pin: false, preserveFocus: true });
			}
		},
		onValidateValue: getValidateGitReferenceFn(state.repos),
	});

	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export async function* pickCommitStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
	{
		ignoreFocusOut,
		log,
		onDidLoadMore,
		picked,
		placeholder,
		showInSideBarCommand,
		showInSideBarButton: showInSideBar,
		titleContext,
	}: {
		ignoreFocusOut?: boolean;
		log: GitLog | undefined;
		onDidLoadMore?: (log: GitLog | undefined) => void;
		picked?: string | string[] | undefined;
		placeholder: string | ((context: Context, log: GitLog | undefined) => string);
		showInSideBarCommand?: CommandQuickPickItem;
		showInSideBarButton?: {
			button: QuickInputButton;
			onDidClick: (items: Readonly<CommitQuickPickItem<GitCommit>[]>) => void;
		};
		titleContext?: string;
	},
): AsyncStepResultGenerator<GitCommit> {
	function getItems(log: GitLog | undefined) {
		return log == null
			? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
			: [
					...map(log.commits.values(), commit =>
						CommitQuickPickItem.create(
							commit,
							picked != null &&
								(typeof picked === 'string' ? commit.ref === picked : picked.includes(commit.ref)),
							{
								buttons: [QuickCommandButtons.ShowDetailsView, QuickCommandButtons.RevealInSideBar],
								compact: true,
								icon: true,
							},
						),
					),
					...(log?.hasMore ? [DirectiveQuickPickItem.create(Directive.LoadMore)] : []),
			  ];
	}

	const step = QuickCommand.createPickStep<CommandQuickPickItem | CommitQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: typeof placeholder === 'string' ? placeholder : placeholder(context, log),
		ignoreFocusOut: ignoreFocusOut,
		matchOnDescription: true,
		matchOnDetail: true,
		value: typeof picked === 'string' && log?.count === 0 ? picked : undefined,
		selectValueWhenShown: true,
		items: showInSideBarCommand != null ? [showInSideBarCommand, ...getItems(log)] : getItems(log),
		onDidLoadMore: async quickpick => {
			quickpick.keepScrollPosition = true;
			log = await log?.more?.(configuration.get('advanced.maxListItems'));
			onDidLoadMore?.(log);
			if (typeof placeholder !== 'string') {
				quickpick.placeholder = placeholder(context, log);
			}
			return getItems(log);
		},
		additionalButtons: [
			...(showInSideBar?.button != null ? [showInSideBar?.button] : []),
			...(log?.hasMore ? [QuickCommandButtons.LoadMore] : []),
		],
		onDidClickItemButton: (quickpick, button, item) => {
			if (CommandQuickPickItem.is(item)) return;

			switch (button) {
				case QuickCommandButtons.ShowDetailsView:
					void GitActions.Commit.showDetailsView(item.item, { pin: false, preserveFocus: true });
					break;

				case QuickCommandButtons.RevealInSideBar:
					void GitActions.Commit.reveal(item.item, {
						select: true,
						focus: false,
						expand: true,
					});
					break;
			}
		},
		onDidClickButton: (quickpick, button) => {
			if (log == null) return;

			const items = quickpick.activeItems.filter<CommitQuickPickItem<GitCommit>>(
				(i): i is CommitQuickPickItem<GitCommit> => !CommandQuickPickItem.is(i),
			);

			if (button === showInSideBar?.button) {
				showInSideBar.onDidClick(items);
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			const items = quickpick.activeItems.filter<CommitQuickPickItem<GitCommit>>(
				(i): i is CommitQuickPickItem<GitCommit> => !CommandQuickPickItem.is(i),
			);

			if (key === 'ctrl+right') {
				void GitActions.Commit.showDetailsView(items[0].item, { pin: false, preserveFocus: true });
			} else {
				await GitActions.Commit.reveal(items[0].item, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
		onValidateValue: getValidateGitReferenceFn(state.repo, {
			buttons: [QuickCommandButtons.ShowDetailsView, QuickCommandButtons.RevealInSideBar],
		}),
	});
	const selection: StepSelection<typeof step> = yield step;
	if (!QuickCommand.canPickStepContinue(step, state, selection)) return StepResult.Break;

	if (CommandQuickPickItem.is(selection[0])) {
		QuickCommand.endSteps(state);

		await selection[0].execute();
		return StepResult.Break;
	}

	return selection[0].item;
}

export function* pickCommitsStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
	{
		log,
		onDidLoadMore,
		picked,
		placeholder,
		titleContext,
	}: {
		log: GitLog | undefined;
		onDidLoadMore?: (log: GitLog | undefined) => void;
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context, log: GitLog | undefined) => string);
		titleContext?: string;
	},
): StepResultGenerator<GitRevisionReference[]> {
	function getItems(log: GitLog | undefined) {
		return log == null
			? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
			: [
					...map(log.commits.values(), commit =>
						CommitQuickPickItem.create(
							commit,
							picked != null &&
								(typeof picked === 'string' ? commit.ref === picked : picked.includes(commit.ref)),
							{
								buttons: [QuickCommandButtons.ShowDetailsView, QuickCommandButtons.RevealInSideBar],
								compact: true,
								icon: true,
							},
						),
					),
					// Since this is multi-select, we can't have a "Load more" item
					// ...(log?.hasMore ? [DirectiveQuickPickItem.create(Directive.LoadMore)] : []),
			  ];
	}

	const step = QuickCommand.createPickStep<CommitQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		multiselect: log != null,
		placeholder: typeof placeholder === 'string' ? placeholder : placeholder(context, log),
		matchOnDescription: true,
		matchOnDetail: true,
		items: getItems(log),
		onDidLoadMore: async quickpick => {
			quickpick.keepScrollPosition = true;
			log = await log?.more?.(configuration.get('advanced.maxListItems'));
			onDidLoadMore?.(log);
			if (typeof placeholder !== 'string') {
				quickpick.placeholder = placeholder(context, log);
			}
			return getItems(log);
		},
		additionalButtons: [...(log?.hasMore ? [QuickCommandButtons.LoadMore] : [])],
		onDidClickItemButton: (quickpick, button, { item }) => {
			switch (button) {
				case QuickCommandButtons.ShowDetailsView:
					void GitActions.Commit.showDetailsView(item, { pin: false, preserveFocus: true });
					break;

				case QuickCommandButtons.RevealInSideBar:
					void GitActions.Commit.reveal(item, {
						select: true,
						focus: false,
						expand: true,
					});
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			if (key === 'ctrl+right') {
				void GitActions.Commit.showDetailsView(quickpick.activeItems[0].item, {
					pin: false,
					preserveFocus: true,
				});
			} else {
				await GitActions.Commit.reveal(quickpick.activeItems[0].item, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResult.Break;
}

export async function* pickContributorsStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
	placeholder: string = 'Choose contributors',
): AsyncStepResultGenerator<GitContributor[]> {
	const message = (await Container.instance.git.getOrOpenScmRepository(state.repo.path))?.inputBox.value;

	const step = QuickCommand.createPickStep<ContributorQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		allowEmpty: true,
		multiselect: true,
		placeholder: placeholder,
		matchOnDescription: true,
		items: (await Container.instance.git.getContributors(state.repo.path)).map(c =>
			ContributorQuickPickItem.create(c, message?.includes(c.getCoauthor()), {
				buttons: [QuickCommandButtons.RevealInSideBar],
			}),
		),
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === QuickCommandButtons.RevealInSideBar) {
				void GitActions.Contributor.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			void GitActions.Contributor.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResult.Break;
}

export async function* pickRepositoryStep<
	State extends PartialStepState & { repo?: string | Repository },
	Context extends { repos: Repository[]; title: string; associatedView: ViewsWithRepositoryFolders },
>(state: State, context: Context, placeholder: string = 'Choose a repository'): AsyncStepResultGenerator<Repository> {
	if (typeof state.repo === 'string') {
		state.repo = Container.instance.git.getRepository(state.repo);
		if (state.repo != null) return state.repo;
	}
	const active = state.repo ?? (await Container.instance.git.getOrOpenRepositoryForEditor());

	const step = QuickCommand.createPickStep<RepositoryQuickPickItem>({
		title: context.title,
		placeholder: placeholder,
		items:
			context.repos.length === 0
				? [DirectiveQuickPickItem.create(Directive.Cancel)]
				: await Promise.all(
						context.repos.map(r =>
							RepositoryQuickPickItem.create(r, r.id === active?.id, {
								branch: true,
								buttons: [QuickCommandButtons.RevealInSideBar],
								fetched: true,
								status: true,
							}),
						),
				  ),
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === QuickCommandButtons.RevealInSideBar) {
				void GitActions.Repository.reveal(item.path, context.associatedView, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			void GitActions.Repository.reveal(quickpick.activeItems[0].item.path, context.associatedView, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export async function* pickRepositoriesStep<
	State extends PartialStepState & { repos?: string[] | Repository[] },
	Context extends { repos: Repository[]; title: string; associatedView: ViewsWithRepositoryFolders },
>(
	state: State,
	context: Context,
	options?: { placeholder?: string; skipIfPossible?: boolean },
): AsyncStepResultGenerator<Repository[]> {
	options = { placeholder: 'Choose repositories', skipIfPossible: false, ...options };

	let actives: Repository[];
	if (state.repos != null) {
		if (isStringArray(state.repos)) {
			actives = filterMap(state.repos, path => context.repos.find(r => r.path === path));
			if (options.skipIfPossible && actives.length !== 0 && state.repos.length === actives.length) {
				return actives;
			}
		} else {
			actives = state.repos;
		}
	} else {
		const active = await Container.instance.git.getOrOpenRepositoryForEditor();
		actives = active != null ? [active] : [];
	}

	const step = QuickCommand.createPickStep<RepositoryQuickPickItem>({
		multiselect: true,
		title: context.title,
		placeholder: options.placeholder,
		items:
			context.repos.length === 0
				? [DirectiveQuickPickItem.create(Directive.Cancel)]
				: await Promise.all(
						context.repos.map(repo =>
							RepositoryQuickPickItem.create(
								repo,
								actives.some(r => r.id === repo.id),
								{
									branch: true,
									buttons: [QuickCommandButtons.RevealInSideBar],
									fetched: true,
									status: true,
								},
							),
						),
				  ),
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === QuickCommandButtons.RevealInSideBar) {
				void GitActions.Repository.reveal(item.path, context.associatedView, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			void GitActions.Repository.reveal(quickpick.activeItems[0].item.path, context.associatedView, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResult.Break;
}

export function* pickStashStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
	{
		ignoreFocusOut,
		stash,
		picked,
		placeholder,
		titleContext,
	}: {
		ignoreFocusOut?: boolean;
		stash: GitStash | undefined;
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context, stash: GitStash | undefined) => string);
		titleContext?: string;
	},
): StepResultGenerator<GitStashCommit> {
	const step = QuickCommand.createPickStep<CommitQuickPickItem<GitStashCommit>>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: typeof placeholder === 'string' ? placeholder : placeholder(context, stash),
		ignoreFocusOut: ignoreFocusOut,
		matchOnDescription: true,
		matchOnDetail: true,
		items:
			stash == null
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: [
						...map(stash.commits.values(), commit =>
							CommitQuickPickItem.create(
								commit,
								picked != null &&
									(typeof picked === 'string' ? commit.ref === picked : picked.includes(commit.ref)),
								{
									buttons: [QuickCommandButtons.ShowDetailsView],
									compact: true,
									icon: true,
								},
							),
						),
				  ],
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === QuickCommandButtons.ShowDetailsView) {
				void GitActions.Stash.showDetailsView(item, { pin: false, preserveFocus: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await GitActions.Stash.showDetailsView(quickpick.activeItems[0].item, { pin: false, preserveFocus: true });
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export async function* pickTagsStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; showTags?: boolean; title: string },
>(
	state: State,
	context: Context,
	{
		filter,
		picked,
		placeholder,
		titleContext,
	}: {
		filter?: (b: GitTag) => boolean;
		picked?: string | string[];
		placeholder: string;
		titleContext?: string;
	},
): AsyncStepResultGenerator<GitTagReference[]> {
	const tags = await getTags(state.repo, {
		buttons: [QuickCommandButtons.RevealInSideBar],
		filter: filter,
		picked: picked,
	});

	const step = QuickCommand.createPickStep<TagQuickPickItem>({
		multiselect: tags.length !== 0,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: tags.length === 0 ? `No tags found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			tags.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: tags,
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === QuickCommandButtons.RevealInSideBar) {
				void GitActions.Tag.reveal(item, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await GitActions.Tag.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResult.Break;
}

export async function* pickWorktreeStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string; worktrees?: GitWorktree[] },
>(
	state: State,
	context: Context,
	{
		filter,
		includeStatus,
		picked,
		placeholder,
		titleContext,
	}: {
		filter?: (b: GitWorktree) => boolean;
		includeStatus?: boolean;
		picked?: string | string[];
		placeholder: string;
		titleContext?: string;
	},
): AsyncStepResultGenerator<GitWorktree> {
	const worktrees = await getWorktrees(context.worktrees ?? state.repo, {
		buttons: [QuickCommandButtons.OpenInNewWindow, QuickCommandButtons.RevealInSideBar],
		filter: filter,
		includeStatus: includeStatus,
		picked: picked,
	});

	const step = QuickCommand.createPickStep<WorktreeQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: worktrees.length === 0 ? `No worktrees found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			worktrees.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: worktrees,
		onDidClickItemButton: (quickpick, button, { item }) => {
			switch (button) {
				case QuickCommandButtons.OpenInNewWindow:
					GitActions.Worktree.open(item, { location: OpenWorkspaceLocation.NewWindow });
					break;
				case QuickCommandButtons.RevealInSideBar:
					void GitActions.Worktree.reveal(item, { select: true, focus: false, expand: true });
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await GitActions.Worktree.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export async function* pickWorktreesStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string; worktrees?: GitWorktree[] },
>(
	state: State,
	context: Context,
	{
		filter,
		includeStatus,
		picked,
		placeholder,
		titleContext,
	}: {
		filter?: (b: GitWorktree) => boolean;
		includeStatus?: boolean;
		picked?: string | string[];
		placeholder: string;
		titleContext?: string;
	},
): AsyncStepResultGenerator<GitWorktree[]> {
	const worktrees = await getWorktrees(context.worktrees ?? state.repo, {
		buttons: [QuickCommandButtons.OpenInNewWindow, QuickCommandButtons.RevealInSideBar],
		filter: filter,
		includeStatus: includeStatus,
		picked: picked,
	});

	const step = QuickCommand.createPickStep<WorktreeQuickPickItem>({
		multiselect: worktrees.length !== 0,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: worktrees.length === 0 ? `No worktrees found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			worktrees.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: worktrees,
		onDidClickItemButton: (quickpick, button, { item }) => {
			switch (button) {
				case QuickCommandButtons.OpenInNewWindow:
					GitActions.Worktree.open(item, { location: OpenWorkspaceLocation.NewWindow });
					break;
				case QuickCommandButtons.RevealInSideBar:
					void GitActions.Worktree.reveal(item, { select: true, focus: false, expand: true });
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await GitActions.Worktree.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResult.Break;
}

export async function* showCommitOrStashStep<
	State extends PartialStepState & { repo: Repository; reference: GitCommit | GitStashCommit },
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
): AsyncStepResultGenerator<CommitFilesQuickPickItem | GitCommandQuickPickItem | CommandQuickPickItem> {
	const step: QuickPickStep<CommitFilesQuickPickItem | GitCommandQuickPickItem | CommandQuickPickItem> =
		QuickCommand.createPickStep({
			title: appendReposToTitle(
				GitReference.toString(state.reference, {
					capitalize: true,
					icon: false,
				}),
				state,
				context,
			),
			placeholder: GitReference.toString(state.reference, { capitalize: true, icon: false }),
			ignoreFocusOut: true,
			items: await getShowCommitOrStashStepItems(state),
			// additionalButtons: [QuickCommandButtons.ShowDetailsView, QuickCommandButtons.RevealInSideBar],
			onDidClickItemButton: (quickpick, button, _item) => {
				switch (button) {
					case QuickCommandButtons.ShowDetailsView:
						if (GitReference.isStash(state.reference)) {
							void GitActions.Stash.showDetailsView(state.reference, { pin: false, preserveFocus: true });
						} else {
							void GitActions.Commit.showDetailsView(state.reference, {
								pin: false,
								preserveFocus: true,
							});
						}
						break;
					case QuickCommandButtons.RevealInSideBar:
						if (GitReference.isStash(state.reference)) {
							void GitActions.Stash.reveal(state.reference, {
								select: true,
								focus: false,
								expand: true,
							});
						} else {
							void GitActions.Commit.reveal(state.reference, {
								select: true,
								focus: false,
								expand: true,
							});
						}
						break;
				}
			},
			keys: ['right', 'alt+right', 'ctrl+right'],
			onDidPressKey: async (quickpick, key) => {
				if (quickpick.activeItems.length === 0) return;

				await quickpick.activeItems[0].onDidPressKey(key);
			},
		});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0] : StepResult.Break;
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
			QuickPickSeparator.create('Actions'),
			new GitCommandQuickPickItem('Apply Stash...', {
				command: 'stash',
				state: {
					subcommand: 'apply',
					repo: state.repo,
					reference: state.reference,
				},
			}),
			new GitCommandQuickPickItem('Delete Stash...', {
				command: 'stash',
				state: {
					subcommand: 'drop',
					repo: state.repo,
					reference: state.reference,
				},
			}),

			QuickPickSeparator.create(),
			new CommitCopyMessageQuickPickItem(state.reference),
		);
	} else {
		const remotes = await Container.instance.git.getRemotesWithProviders(state.repo.path, { sort: true });
		if (remotes?.length) {
			items.push(
				QuickPickSeparator.create(GitRemote.getHighlanderProviderName(remotes) ?? 'Remote'),
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

		items.push(QuickPickSeparator.create('Actions'));

		const branch = await Container.instance.git.getBranch(state.repo.path);
		const [branches, published] = await Promise.all([
			branch != null
				? Container.instance.git.getCommitBranches(state.repo.path, state.reference.ref, {
						branch: branch.name,
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
					new GitCommandQuickPickItem('Push to Commit...', {
						command: 'push',
						state: {
							repos: state.repo,
							reference: state.reference,
						},
					}),
				);
			}

			items.push(
				new GitCommandQuickPickItem('Revert Commit...', {
					command: 'revert',
					state: {
						repo: state.repo,
						references: [state.reference],
					},
				}),
				new GitCommandQuickPickItem(`Reset ${branch?.name ?? 'Current Branch'} to Commit...`, {
					command: 'reset',
					state: {
						repo: state.repo,
						reference: state.reference,
					},
				}),
				new GitCommandQuickPickItem(`Reset ${branch?.name ?? 'Current Branch'} to Previous Commit...`, {
					command: 'reset',
					state: {
						repo: state.repo,
						reference: GitReference.create(`${state.reference.ref}^`, state.reference.repoPath, {
							refType: 'revision',
							name: `${state.reference.name}^`,
							message: state.reference.message,
						}),
					},
				}),
			);
		} else {
			items.push(
				new GitCommandQuickPickItem('Cherry Pick Commit...', {
					command: 'cherry-pick',
					state: {
						repo: state.repo,
						references: [state.reference],
					},
				}),
			);
		}

		items.push(
			new GitCommandQuickPickItem(`Rebase ${branch?.name ?? 'Current Branch'} onto Commit...`, {
				command: 'rebase',
				state: {
					repo: state.repo,
					reference: state.reference,
				},
			}),
			new GitCommandQuickPickItem('Switch to Commit...', {
				command: 'switch',
				state: {
					repos: [state.repo],
					reference: state.reference,
				},
			}),

			QuickPickSeparator.create(),
			new GitCommandQuickPickItem('Create Branch at Commit...', {
				command: 'branch',
				state: {
					subcommand: 'create',
					repo: state.repo,
					reference: state.reference,
				},
			}),
			new GitCommandQuickPickItem('Create Tag at Commit...', {
				command: 'tag',
				state: {
					subcommand: 'create',
					repo: state.repo,
					reference: state.reference,
				},
			}),

			QuickPickSeparator.create('Copy'),
			new CommitCopyIdQuickPickItem(state.reference),
			new CommitCopyMessageQuickPickItem(state.reference),
		);
	}

	items.push(
		QuickPickSeparator.create('Open'),
		new CommitOpenAllChangesCommandQuickPickItem(state.reference),
		new CommitOpenAllChangesWithWorkingCommandQuickPickItem(state.reference),
		new CommitOpenAllChangesWithDiffToolCommandQuickPickItem(state.reference),
		QuickPickSeparator.create(),
		new CommitOpenFilesCommandQuickPickItem(state.reference),
		new CommitOpenRevisionsCommandQuickPickItem(state.reference),
	);

	items.push(
		QuickPickSeparator.create('Compare'),
		new CommitCompareWithHEADCommandQuickPickItem(state.reference),
		new CommitCompareWithWorkingCommandQuickPickItem(state.reference),
	);

	items.push(
		QuickPickSeparator.create(),
		new CommitOpenDirectoryCompareCommandQuickPickItem(state.reference),
		new CommitOpenDirectoryCompareWithWorkingCommandQuickPickItem(state.reference),
	);

	items.push(
		QuickPickSeparator.create('Browse'),
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

	items.splice(
		0,
		0,
		new CommitFilesQuickPickItem(state.reference, {
			unpublished: unpublished,
			hint: 'Click to see all changed files',
		}),
	);
	return items as CommandQuickPickItem[];
}

export function* showCommitOrStashFilesStep<
	State extends PartialStepState & {
		repo: Repository;
		reference: GitCommit | GitStashCommit;
		fileName?: string | undefined;
	},
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
	options?: { picked?: string },
): StepResultGenerator<CommitFilesQuickPickItem | CommitFileQuickPickItem> {
	if (state.reference.files == null) {
		debugger;
	}

	const step: QuickPickStep<CommitFilesQuickPickItem | CommitFileQuickPickItem> = QuickCommand.createPickStep({
		title: appendReposToTitle(
			GitReference.toString(state.reference, {
				capitalize: true,
				icon: false,
			}),
			state,
			context,
		),
		placeholder: GitReference.toString(state.reference, { capitalize: true, icon: false }),
		ignoreFocusOut: true,
		items: [
			new CommitFilesQuickPickItem(state.reference, {
				picked: state.fileName == null,
				hint: `Click to see ${isStash(state.reference) ? 'stash' : 'commit'} actions`,
			}),
			QuickPickSeparator.create('Files'),
			...(state.reference.files?.map(
				fs => new CommitFileQuickPickItem(state.reference, fs, options?.picked === fs.path),
			) ?? []),
		] as (CommitFilesQuickPickItem | CommitFileQuickPickItem)[],
		matchOnDescription: true,
		// additionalButtons: [QuickCommandButtons.ShowDetailsView, QuickCommandButtons.RevealInSideBar],
		onDidClickItemButton: (quickpick, button, _item) => {
			switch (button) {
				case QuickCommandButtons.ShowDetailsView:
					if (GitReference.isStash(state.reference)) {
						void GitActions.Stash.showDetailsView(state.reference, { pin: false, preserveFocus: true });
					} else {
						void GitActions.Commit.showDetailsView(state.reference, { pin: false, preserveFocus: true });
					}
					break;
				case QuickCommandButtons.RevealInSideBar:
					if (GitReference.isStash(state.reference)) {
						void GitActions.Stash.reveal(state.reference, {
							select: true,
							focus: false,
							expand: true,
						});
					} else {
						void GitActions.Commit.reveal(state.reference, {
							select: true,
							focus: false,
							expand: true,
						});
					}
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			await quickpick.activeItems[0].onDidPressKey(key);
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0] : StepResult.Break;
}

export async function* showCommitOrStashFileStep<
	State extends PartialStepState & {
		repo: Repository;
		reference: GitCommit | GitStashCommit;
		fileName: string;
	},
	Context extends { repos: Repository[]; title: string },
>(state: State, context: Context): AsyncStepResultGenerator<CommandQuickPickItem> {
	const step: QuickPickStep<CommandQuickPickItem> = QuickCommand.createPickStep<CommandQuickPickItem>({
		title: appendReposToTitle(
			GitReference.toString(state.reference, {
				capitalize: true,
				icon: false,
			}),
			state,
			context,
			`${pad(GlyphChars.Dot, 2, 2)}${formatPath(state.fileName, { fileOnly: true })}`,
		),
		placeholder: `${formatPath(state.fileName, {
			relativeTo: state.repo.path,
		})} in ${GitReference.toString(state.reference, {
			icon: false,
		})}`,
		ignoreFocusOut: true,
		items: await getShowCommitOrStashFileStepItems(state),
		matchOnDescription: true,
		// additionalButtons: [QuickCommandButtons.ShowDetailsView, QuickCommandButtons.RevealInSideBar],
		onDidClickItemButton: (quickpick, button, _item) => {
			switch (button) {
				case QuickCommandButtons.ShowDetailsView:
					if (GitReference.isStash(state.reference)) {
						void GitActions.Stash.showDetailsView(state.reference, { pin: false, preserveFocus: true });
					} else {
						void GitActions.Commit.showDetailsView(state.reference, { pin: false, preserveFocus: true });
					}
					break;
				case QuickCommandButtons.RevealInSideBar:
					if (GitReference.isStash(state.reference)) {
						void GitActions.Stash.reveal(state.reference, {
							select: true,
							focus: false,
							expand: true,
						});
					} else {
						void GitActions.Commit.reveal(state.reference, {
							select: true,
							focus: false,
							expand: true,
						});
					}
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			await quickpick.activeItems[0].onDidPressKey(key);
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0] : StepResult.Break;
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
			QuickPickSeparator.create(),
			new CommitCopyMessageQuickPickItem(state.reference),
			QuickPickSeparator.create('Actions'),
			new CommitApplyFileChangesCommandQuickPickItem(state.reference, file),
			new CommitRestoreFileChangesCommandQuickPickItem(state.reference, file),
			QuickPickSeparator.create(),
			new CommitCopyMessageQuickPickItem(state.reference),
		);
	} else {
		const remotes = await Container.instance.git.getRemotesWithProviders(state.repo.path, { sort: true });
		if (remotes?.length) {
			items.push(
				QuickPickSeparator.create(GitRemote.getHighlanderProviderName(remotes) ?? 'Remote'),
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
				QuickPickSeparator.create(),
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
			QuickPickSeparator.create('Actions'),
			new CommitApplyFileChangesCommandQuickPickItem(state.reference, file),
			new CommitRestoreFileChangesCommandQuickPickItem(state.reference, file),
			QuickPickSeparator.create('Copy'),
			new CommitCopyIdQuickPickItem(state.reference),
			new CommitCopyMessageQuickPickItem(state.reference),
		);
	}

	items.push(
		QuickPickSeparator.create('Open'),
		new CommitOpenChangesCommandQuickPickItem(state.reference, state.fileName),
		new CommitOpenChangesWithWorkingCommandQuickPickItem(state.reference, state.fileName),
		new CommitOpenChangesWithDiffToolCommandQuickPickItem(state.reference, state.fileName),
		QuickPickSeparator.create(),
	);

	if (file.status !== 'D') {
		items.push(new CommitOpenFileCommandQuickPickItem(state.reference, file));
	}
	items.push(new CommitOpenRevisionCommandQuickPickItem(state.reference, file));

	items.push(
		QuickPickSeparator.create('Compare'),
		new CommitCompareWithHEADCommandQuickPickItem(state.reference),
		new CommitCompareWithWorkingCommandQuickPickItem(state.reference),
	);

	items.push(
		QuickPickSeparator.create('Browse'),
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

	items.splice(
		0,
		0,
		new CommitFilesQuickPickItem(state.reference, { file: file, hint: 'Click to see all changed files' }),
	);
	return items as CommandQuickPickItem[];
}

export function* showRepositoryStatusStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string; status: GitStatus },
>(state: State, context: Context): StepResultGenerator<CommandQuickPickItem> {
	const upstream = context.status.getUpstreamStatus({ expand: true, separator: ', ' });
	const working = context.status.getFormattedDiffStatus({ expand: true, separator: ', ' });
	const step: QuickPickStep<CommandQuickPickItem> = QuickCommand.createPickStep<CommandQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		placeholder: `${upstream ? `${upstream}, ${working}` : working}`, //'Changes to be committed',
		ignoreFocusOut: true,
		items: getShowRepositoryStatusStepItems(state, context),
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			await quickpick.activeItems[0].onDidPressKey(key);
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0] : StepResult.Break;
}

function getShowRepositoryStatusStepItems<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string; status: GitStatus },
>(state: State, context: Context) {
	const items: (DirectiveQuickPickItem | CommandQuickPickItem)[] = [];

	const computed = context.status.computeWorkingTreeStatus();

	let workingTreeStatus;
	if (computed.staged === 0 && computed.unstaged === 0) {
		workingTreeStatus = 'No working tree changes';
	} else {
		workingTreeStatus = `$(files) ${
			computed.staged ? `${pluralize('staged file', computed.staged)} (${computed.stagedStatus})` : ''
		}${
			computed.unstaged
				? `${computed.staged ? ', ' : ''}${pluralize('unstaged file', computed.unstaged)} (${
						computed.unstagedStatus
				  })`
				: ''
		}`;
	}

	if (context.status.upstream) {
		if (context.status.state.ahead === 0 && context.status.state.behind === 0) {
			items.push(
				DirectiveQuickPickItem.create(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is up to date with $(git-branch) ${context.status.upstream}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.ahead !== 0 && context.status.state.behind !== 0) {
			items.push(
				DirectiveQuickPickItem.create(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} has diverged from $(git-branch) ${context.status.upstream}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.ahead !== 0) {
			items.push(
				DirectiveQuickPickItem.create(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is ahead of $(git-branch) ${context.status.upstream}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.behind !== 0) {
			items.push(
				DirectiveQuickPickItem.create(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is behind $(git-branch) ${context.status.upstream}`,
					detail: workingTreeStatus,
				}),
			);
		}

		if (context.status.state.behind !== 0) {
			items.push(
				new GitCommandQuickPickItem(
					`$(cloud-download) ${pluralize('commit', context.status.state.behind)} behind`,
					{
						command: 'log',
						state: {
							repo: state.repo,
							reference: GitReference.create(
								GitRevision.createRange(context.status.ref, context.status.upstream),
								state.repo.path,
							),
						},
					},
				),
			);
		}

		if (context.status.state.ahead !== 0) {
			items.push(
				new GitCommandQuickPickItem(
					`$(cloud-upload) ${pluralize('commit', context.status.state.ahead)} ahead`,
					{
						command: 'log',
						state: {
							repo: state.repo,
							reference: GitReference.create(
								GitRevision.createRange(context.status.upstream, context.status.ref),
								state.repo.path,
							),
						},
					},
				),
			);
		}
	} else {
		items.push(
			DirectiveQuickPickItem.create(Directive.Noop, true, {
				label: `$(git-branch) ${context.status.branch} has no upstream`,
				detail: workingTreeStatus,
			}),
		);
	}

	if (context.status.files.length) {
		items.push(
			new OpenChangedFilesCommandQuickPickItem(
				computed.stagedAddsAndChanges.concat(computed.unstagedAddsAndChanges),
			),
		);
	}

	if (computed.staged > 0) {
		items.push(
			new OpenChangedFilesCommandQuickPickItem(computed.stagedAddsAndChanges, {
				label: '$(files) Open Staged Files',
			}),
		);
	}

	if (computed.unstaged > 0) {
		items.push(
			new OpenChangedFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, {
				label: '$(files) Open Unstaged Files',
			}),
		);
	}

	if (context.status.files.length) {
		items.push(new CommandQuickPickItem('$(x) Close Unchanged Files', Commands.CloseUnchangedFiles));
	}

	return items;
}

export async function* ensureAccessStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string },
>(state: State, context: Context, feature: PlusFeatures): AsyncStepResultGenerator<void> {
	const access = await Container.instance.git.access(feature, state.repo.path);
	if (access.allowed) return undefined;

	const directives: DirectiveQuickPickItem[] = [];
	let placeholder: string;
	if (access.subscription.current.account?.verified === false) {
		directives.push(DirectiveQuickPickItem.create(Directive.RequiresVerification, true));
		placeholder = 'You must verify your email address before you can continue';
	} else {
		if (access.subscription.required == null) return undefined;

		placeholder = 'You need GitLens Pro to access GitLens+ features on this repo';
		if (isSubscriptionPaidPlan(access.subscription.required) && access.subscription.current.account != null) {
			directives.push(DirectiveQuickPickItem.create(Directive.RequiresPaidSubscription, true));
		} else if (
			access.subscription.current.account == null &&
			!isSubscriptionPreviewTrialExpired(access.subscription.current)
		) {
			directives.push(DirectiveQuickPickItem.create(Directive.StartPreviewTrial, true));
		} else {
			directives.push(DirectiveQuickPickItem.create(Directive.ExtendTrial));
		}
	}

	const step = QuickCommand.createPickStep<DirectiveQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		placeholder: placeholder,
		items: [...directives, DirectiveQuickPickItem.create(Directive.Cancel)],
	});

	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? undefined : StepResult.Break;
}

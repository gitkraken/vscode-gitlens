import type { QuickInputButton, QuickPick } from 'vscode';
import { Commands, GlyphChars, quickPickTitleMaxChars } from '../constants';
import { Container } from '../container';
import type { PlusFeatures } from '../features';
import * as BranchActions from '../git/actions/branch';
import * as CommitActions from '../git/actions/commit';
import * as ContributorActions from '../git/actions/contributor';
import * as RemoteActions from '../git/actions/remote';
import * as RepositoryActions from '../git/actions/repository';
import * as StashActions from '../git/actions/stash';
import * as TagActions from '../git/actions/tag';
import * as WorktreeActions from '../git/actions/worktree';
import type { PagedResult } from '../git/gitProvider';
import type { BranchSortOptions, GitBranch } from '../git/models/branch';
import { sortBranches } from '../git/models/branch';
import type { GitCommit, GitStashCommit } from '../git/models/commit';
import { isCommit, isStash } from '../git/models/commit';
import type { GitContributor } from '../git/models/contributor';
import type { GitLog } from '../git/models/log';
import type { GitBranchReference, GitReference, GitRevisionReference, GitTagReference } from '../git/models/reference';
import {
	createReference,
	createRevisionRange,
	getReferenceLabel,
	isBranchReference,
	isRevisionRange,
	isRevisionReference,
	isStashReference,
	isTagReference,
} from '../git/models/reference';
import { GitRemote } from '../git/models/remote';
import { RemoteResourceType } from '../git/models/remoteResource';
import { Repository } from '../git/models/repository';
import type { GitStash } from '../git/models/stash';
import type { GitStatus } from '../git/models/status';
import type { GitTag, TagSortOptions } from '../git/models/tag';
import { sortTags } from '../git/models/tag';
import type { GitWorktree } from '../git/models/worktree';
import { remoteUrlRegex } from '../git/parsers/remoteParser';
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
	OpenOnlyChangedFilesCommandQuickPickItem,
} from '../quickpicks/items/commits';
import type { QuickPickSeparator } from '../quickpicks/items/common';
import { CommandQuickPickItem, createQuickPickSeparator } from '../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../quickpicks/items/directive';
import type {
	BranchQuickPickItem,
	CommitQuickPickItem,
	ContributorQuickPickItem,
	RemoteQuickPickItem,
	RepositoryQuickPickItem,
	TagQuickPickItem,
	WorktreeQuickPickItem,
} from '../quickpicks/items/gitCommands';
import {
	createBranchQuickPickItem,
	createCommitQuickPickItem,
	createContributorQuickPickItem,
	createRefQuickPickItem,
	createRemoteQuickPickItem,
	createRepositoryQuickPickItem,
	createTagQuickPickItem,
	createWorktreeQuickPickItem,
	GitCommandQuickPickItem,
} from '../quickpicks/items/gitCommands';
import type { ReferencesQuickPickItem } from '../quickpicks/referencePicker';
import {
	CopyRemoteResourceCommandQuickPickItem,
	OpenRemoteResourceCommandQuickPickItem,
} from '../quickpicks/remoteProviderPicker';
import { isSubscriptionPaidPlan, isSubscriptionPreviewTrialExpired } from '../subscription';
import { filterMap, intersection, isStringArray } from '../system/array';
import { configuration } from '../system/configuration';
import { formatPath } from '../system/formatPath';
import { first, map } from '../system/iterable';
import { getSettledValue } from '../system/promise';
import { pad, pluralize, truncate } from '../system/string';
import { openWorkspace } from '../system/utils';
import type { ViewsWithRepositoryFolders } from '../views/viewBase';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	QuickPickStep,
	StepResultGenerator,
	StepSelection,
	StepState,
} from './quickCommand';
import {
	canInputStepContinue,
	canPickStepContinue,
	canStepContinue,
	createInputStep,
	createPickStep,
	endSteps,
	LoadMoreQuickInputButton,
	OpenChangesViewQuickInputButton,
	OpenInNewWindowQuickInputButton,
	PickCommitQuickInputButton,
	RevealInSideBarQuickInputButton,
	ShowDetailsViewQuickInputButton,
	ShowTagsToggleQuickInputButton,
	StepResultBreak,
} from './quickCommand';

export function appendReposToTitle<
	State extends { repo: Repository } | { repos: Repository[] },
	Context extends { repos: Repository[] },
>(title: string, state: State, context: Context, additionalContext?: string) {
	if (context.repos.length === 1) {
		return additionalContext
			? `${title}${truncate(additionalContext, quickPickTitleMaxChars - title.length)}`
			: title;
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

export async function getRemotes(
	repo: Repository,
	options: {
		buttons?: QuickInputButton[];
		filter?: (b: GitRemote) => boolean;
		picked?: string | string[];
	},
): Promise<RemoteQuickPickItem[]> {
	if (repo == null) return [];

	const remotes = (await repo.getRemotes(options?.filter != null ? { filter: options.filter } : undefined)).map(r =>
		createRemoteQuickPickItem(
			r,
			options?.picked != null &&
				(typeof options.picked === 'string' ? r.name === options.picked : options.picked.includes(r.name)),
			{
				buttons: options?.buttons,
				upstream: true,
			},
		),
	);
	return remotes;
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
			.map(async w => {
				let missing = false;
				let status;
				if (includeStatus) {
					try {
						status = await w.getStatus();
					} catch {
						missing = true;
					}
				}

				return createWorktreeQuickPickItem(
					w,
					picked != null &&
						(typeof picked === 'string' ? w.uri.toString() === picked : picked.includes(w.uri.toString())),
					missing,
					{
						buttons: buttons,
						path: true,
						status: status,
					},
				);
			}),
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
				intersection(branchesByRepo, (b1: GitBranch, b2: GitBranch) => b1.name === b2.name),
			);
		}

		if (include.includes('tags') && tagsByRepo != null) {
			tags = sortTags(intersection(tagsByRepo, (t1: GitTag, t2: GitTag) => t1.name === t2.name));
		}
	}

	if ((branches == null || branches.length === 0) && (tags == null || tags.length === 0)) return [];

	if (branches != null && branches.length !== 0 && (tags == null || tags.length === 0)) {
		return [
			createQuickPickSeparator('Branches'),
			...(await Promise.all(
				branches
					.filter(b => !b.remote)
					.map(b =>
						createBranchQuickPickItem(
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
			createQuickPickSeparator('Remote Branches'),
			...(await Promise.all(
				branches
					.filter(b => b.remote)
					.map(b =>
						createBranchQuickPickItem(
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
			createTagQuickPickItem(
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
		createQuickPickSeparator('Branches'),
		...(await Promise.all(
			branches!
				.filter(b => !b.remote)
				.map(b =>
					createBranchQuickPickItem(
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
		createQuickPickSeparator('Tags'),
		...tags!.map(t =>
			createTagQuickPickItem(
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
		createQuickPickSeparator('Remote Branches'),
		...(await Promise.all(
			branches!
				.filter(b => b.remote)
				.map(b =>
					createBranchQuickPickItem(
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

		if (inRefMode && options?.ranges && isRevisionRange(value)) {
			quickpick.items = [
				createRefQuickPickItem(value, repos.path, true, {
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
					createDirectiveQuickPickItem(Directive.Back, true, {
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
			createCommitQuickPickItem(commit!, true, {
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
	const step = createInputStep({
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
				if (!valid) {
					return [false, `'${value}' isn't a valid branch name`];
				}

				const alreadyExists = await state.repo.getBranch(value);
				if (alreadyExists) {
					return [false, `A branch named '${value}' already exists`];
				}

				return [true, undefined];
			}

			let valid = true;

			for (const repo of state.repos) {
				valid = await Container.instance.git.validateBranchOrTagName(repo.path, value);
				if (!valid) {
					return [false, `'${value}' isn't a valid branch name`];
				}

				const alreadyExists = await repo.getBranch(value);
				if (alreadyExists) {
					return [false, `A branch named '${value}' already exists`];
				}
			}

			return [true, undefined];
		},
	});

	const value: StepSelection<typeof step> = yield step;
	if (!canStepContinue(step, state, value) || !(await canInputStepContinue(step, state, value))) {
		return StepResultBreak;
	}

	return value;
}

export async function* inputRemoteNameStep<
	State extends PartialStepState & ({ repo: Repository } | { repos: Repository[] }),
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
	options: { placeholder: string; titleContext?: string; value?: string },
): AsyncStepResultGenerator<string> {
	const step = createInputStep({
		title: appendReposToTitle(`${context.title}${options.titleContext ?? ''}`, state, context),
		placeholder: options.placeholder,
		value: options.value,
		prompt: 'Enter remote name',
		validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
			if (value == null) return [false, undefined];

			value = value.trim();
			if (value.length === 0) return [false, 'Please enter a valid remote name'];

			const valid = !/[^a-zA-Z0-9-_.]/.test(value);
			if (!valid) return [false, `'${value}' isn't a valid remote name`];

			if ('repo' in state) {
				const alreadyExists = (await state.repo.getRemotes({ filter: r => r.name === value })).length !== 0;
				if (alreadyExists) {
					return [false, `A remote named '${value}' already exists`];
				}
			}

			return [true, undefined];
		},
	});

	const value: StepSelection<typeof step> = yield step;
	if (!canStepContinue(step, state, value) || !(await canInputStepContinue(step, state, value))) {
		return StepResultBreak;
	}

	return value;
}

export async function* inputRemoteUrlStep<
	State extends PartialStepState & ({ repo: Repository } | { repos: Repository[] }),
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
	options: { placeholder: string; titleContext?: string; value?: string },
): AsyncStepResultGenerator<string> {
	const step = createInputStep({
		title: appendReposToTitle(`${context.title}${options.titleContext ?? ''}`, state, context),
		placeholder: options.placeholder,
		value: options.value,
		prompt: 'Enter remote URL',
		validate: (value: string | undefined): [boolean, string | undefined] => {
			if (value == null) return [false, undefined];

			value = value.trim();
			if (value.length === 0) return [false, 'Please enter a valid remote URL'];

			const valid = remoteUrlRegex.test(value);
			return [valid, valid ? undefined : `'${value}' isn't a valid remote URL`];
		},
	});

	const value: StepSelection<typeof step> = yield step;
	if (!canStepContinue(step, state, value) || !(await canInputStepContinue(step, state, value))) {
		return StepResultBreak;
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
	const step = createInputStep({
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
	if (!canStepContinue(step, state, value) || !(await canInputStepContinue(step, state, value))) {
		return StepResultBreak;
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
		buttons: [RevealInSideBarQuickInputButton],
		filter: filter,
		picked: picked,
	});

	const step = createPickStep<BranchQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: branches.length === 0 ? `No branches found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			branches.length === 0
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: branches,
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void BranchActions.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await BranchActions.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
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
		buttons: [RevealInSideBarQuickInputButton],
		filter: filter,
		picked: picked,
		sort: sort,
	});

	const step = createPickStep<BranchQuickPickItem>({
		multiselect: branches.length !== 0,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: branches.length === 0 ? `No branches found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			branches.length === 0
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: branches,
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void BranchActions.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await BranchActions.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
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

	const showTagsButton = new ShowTagsToggleQuickInputButton(context.showTags);

	const getBranchesAndOrTagsFn = async () => {
		return getBranchesAndOrTags(state.repo, context.showTags ? ['branches', 'tags'] : ['branches'], {
			buttons:
				typeof context.pickCommitForItem === 'boolean'
					? [PickCommitQuickInputButton, RevealInSideBarQuickInputButton]
					: [RevealInSideBarQuickInputButton],
			filter: filter,
			picked: picked,
			sort: true,
		});
	};
	const branchesAndOrTags = await getBranchesAndOrTagsFn();

	const step = createPickStep<ReferencesQuickPickItem>({
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
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: branchesAndOrTags,
		additionalButtons: [...(additionalButtons ?? []), showTagsButton],
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === PickCommitQuickInputButton) {
				context.pickCommitForItem = true;
				return true;
			}

			if (button === RevealInSideBarQuickInputButton) {
				if (isBranchReference(item)) {
					void BranchActions.reveal(item, { select: true, focus: false, expand: true });
				} else if (isTagReference(item)) {
					void TagActions.reveal(item, { select: true, focus: false, expand: true });
				} else if (isRevisionReference(item)) {
					void CommitActions.showDetailsView(item, { pin: false, preserveFocus: true });
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
			if (isBranchReference(item)) {
				void BranchActions.reveal(item, { select: true, focus: false, expand: true });
			} else if (isTagReference(item)) {
				void TagActions.reveal(item, { select: true, focus: false, expand: true });
			} else if (isRevisionReference(item)) {
				void CommitActions.showDetailsView(item, { pin: false, preserveFocus: true });
			}
		},
		onValidateValue: getValidateGitReferenceFn(state.repo, { ranges: ranges }),
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
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

	const showTagsButton = new ShowTagsToggleQuickInputButton(context.showTags);

	const getBranchesAndOrTagsFn = () => {
		return getBranchesAndOrTags(state.repos, context.showTags ? ['branches', 'tags'] : ['branches'], {
			buttons: [RevealInSideBarQuickInputButton],
			// Filter out remote branches if we are going to affect multiple repos
			filter: { branches: state.repos.length === 1 ? undefined : b => !b.remote, ...filter },
			picked: picked ?? state.reference?.ref,
			sort: { branches: { orderBy: 'date:desc' }, tags: { orderBy: 'date:desc' } },
		});
	};
	const branchesAndOrTags = await getBranchesAndOrTagsFn();

	const step = createPickStep<ReferencesQuickPickItem>({
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
		value: value ?? (isRevisionReference(state.reference) ? state.reference.ref : undefined),
		selectValueWhenShown: true,
		items:
			branchesAndOrTags.length === 0
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: branchesAndOrTags,
		additionalButtons: [showTagsButton],
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				if (isBranchReference(item)) {
					void BranchActions.reveal(item, { select: true, focus: false, expand: true });
				} else if (isTagReference(item)) {
					void TagActions.reveal(item, { select: true, focus: false, expand: true });
				} else if (isRevisionReference(item)) {
					void CommitActions.showDetailsView(item, { pin: false, preserveFocus: true });
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
			if (isBranchReference(item)) {
				void BranchActions.reveal(item, { select: true, focus: false, expand: true });
			} else if (isTagReference(item)) {
				void TagActions.reveal(item, { select: true, focus: false, expand: true });
			} else if (isRevisionReference(item)) {
				void CommitActions.showDetailsView(item, { pin: false, preserveFocus: true });
			}
		},
		onValidateValue: getValidateGitReferenceFn(state.repos),
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
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
			onDidClick: (items: Readonly<CommitQuickPickItem[]>) => void;
		};
		titleContext?: string;
	},
): AsyncStepResultGenerator<GitCommit> {
	function getItems(log: GitLog | undefined) {
		if (log == null) {
			return [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)];
		}

		const buttons = [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton];

		// If these are "file" commits, then add an Open Changes button
		if (first(log.commits)?.[1].file != null) {
			buttons.splice(0, 0, OpenChangesViewQuickInputButton);
		}

		return [
			...map(log.commits.values(), commit =>
				createCommitQuickPickItem(
					commit,
					picked != null &&
						(typeof picked === 'string' ? commit.ref === picked : picked.includes(commit.ref)),
					{
						buttons: buttons,
						compact: true,
						icon: true,
					},
				),
			),
			...(log?.hasMore ? [createDirectiveQuickPickItem(Directive.LoadMore)] : []),
		];
	}

	const step = createPickStep<CommandQuickPickItem | CommitQuickPickItem>({
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
			...(log?.hasMore ? [LoadMoreQuickInputButton] : []),
		],
		onDidClickItemButton: (quickpick, button, item) => {
			if (CommandQuickPickItem.is(item)) return;

			switch (button) {
				case ShowDetailsViewQuickInputButton:
					void CommitActions.showDetailsView(item.item, { pin: false, preserveFocus: true });
					break;

				case RevealInSideBarQuickInputButton:
					void CommitActions.reveal(item.item, {
						select: true,
						focus: false,
						expand: true,
					});
					break;
				case OpenChangesViewQuickInputButton: {
					const path = item.item.file?.path;
					if (path != null) {
						void CommitActions.openChanges(path, item.item);
					}
					break;
				}
			}
		},
		onDidClickButton: (quickpick, button) => {
			if (log == null) return;

			const items = quickpick.activeItems.filter<CommitQuickPickItem>(
				(i): i is CommitQuickPickItem => !CommandQuickPickItem.is(i),
			);

			if (button === showInSideBar?.button) {
				showInSideBar.onDidClick(items);
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			const items = quickpick.activeItems.filter<CommitQuickPickItem>(
				(i): i is CommitQuickPickItem => !CommandQuickPickItem.is(i),
			);

			if (key === 'ctrl+right') {
				void CommitActions.showDetailsView(items[0].item, { pin: false, preserveFocus: true });
			} else {
				await CommitActions.reveal(items[0].item, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
		onValidateValue: getValidateGitReferenceFn(state.repo, {
			buttons: [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton],
		}),
	});
	const selection: StepSelection<typeof step> = yield step;
	if (!canPickStepContinue(step, state, selection)) return StepResultBreak;

	if (CommandQuickPickItem.is(selection[0])) {
		endSteps(state);

		await selection[0].execute();
		return StepResultBreak;
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
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: [
					...map(log.commits.values(), commit =>
						createCommitQuickPickItem(
							commit,
							picked != null &&
								(typeof picked === 'string' ? commit.ref === picked : picked.includes(commit.ref)),
							{
								buttons: [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton],
								compact: true,
								icon: true,
							},
						),
					),
					// Since this is multi-select, we can't have a "Load more" item
					// ...(log?.hasMore ? [DirectiveQuickPickItem.create(Directive.LoadMore)] : []),
			  ];
	}

	const step = createPickStep<CommitQuickPickItem>({
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
		additionalButtons: [...(log?.hasMore ? [LoadMoreQuickInputButton] : [])],
		onDidClickItemButton: (quickpick, button, { item }) => {
			switch (button) {
				case ShowDetailsViewQuickInputButton:
					void CommitActions.showDetailsView(item, { pin: false, preserveFocus: true });
					break;

				case RevealInSideBarQuickInputButton:
					void CommitActions.reveal(item, {
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
				void CommitActions.showDetailsView(quickpick.activeItems[0].item, {
					pin: false,
					preserveFocus: true,
				});
			} else {
				await CommitActions.reveal(quickpick.activeItems[0].item, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
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

	const step = createPickStep<ContributorQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		allowEmpty: true,
		multiselect: true,
		placeholder: placeholder,
		matchOnDescription: true,
		items: (await Container.instance.git.getContributors(state.repo.path)).map(c =>
			createContributorQuickPickItem(c, message?.includes(c.getCoauthor()), {
				buttons: [RevealInSideBarQuickInputButton],
			}),
		),
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void ContributorActions.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			void ContributorActions.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}

export async function* pickRemoteStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
	{
		filter,
		picked,
		placeholder,
		titleContext,
	}: {
		filter?: (r: GitRemote) => boolean;
		picked?: string | string[];
		placeholder: string;
		titleContext?: string;
	},
): AsyncStepResultGenerator<GitRemote> {
	const remotes = await getRemotes(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: filter,
		picked: picked,
	});

	const step = createPickStep<RemoteQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: remotes.length === 0 ? `No remotes found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			remotes.length === 0
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: remotes,
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void RemoteActions.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await RemoteActions.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

export async function* pickRemotesStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
	{
		filter,
		picked,
		placeholder,
		titleContext,
	}: {
		filter?: (b: GitRemote) => boolean;
		picked?: string | string[];
		placeholder: string;
		titleContext?: string;
	},
): AsyncStepResultGenerator<GitRemote[]> {
	const remotes = await getRemotes(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: filter,
		picked: picked,
	});

	const step = createPickStep<RemoteQuickPickItem>({
		multiselect: remotes.length !== 0,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: remotes.length === 0 ? `No remotes found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			remotes.length === 0
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: remotes,
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void RemoteActions.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await RemoteActions.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
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

	const step = createPickStep<RepositoryQuickPickItem>({
		title: context.title,
		placeholder: placeholder,
		items:
			context.repos.length === 0
				? [createDirectiveQuickPickItem(Directive.Cancel)]
				: await Promise.all(
						context.repos.map(r =>
							createRepositoryQuickPickItem(r, r.id === active?.id, {
								branch: true,
								buttons: [RevealInSideBarQuickInputButton],
								fetched: true,
								status: true,
							}),
						),
				  ),
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void RepositoryActions.reveal(item.path, context.associatedView, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			void RepositoryActions.reveal(quickpick.activeItems[0].item.path, context.associatedView, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
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

	const step = createPickStep<RepositoryQuickPickItem>({
		multiselect: true,
		title: context.title,
		placeholder: options.placeholder,
		items:
			context.repos.length === 0
				? [createDirectiveQuickPickItem(Directive.Cancel)]
				: await Promise.all(
						context.repos.map(repo =>
							createRepositoryQuickPickItem(
								repo,
								actives.some(r => r.id === repo.id),
								{
									branch: true,
									buttons: [RevealInSideBarQuickInputButton],
									fetched: true,
									status: true,
								},
							),
						),
				  ),
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void RepositoryActions.reveal(item.path, context.associatedView, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			void RepositoryActions.reveal(quickpick.activeItems[0].item.path, context.associatedView, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
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
	const step = createPickStep<CommitQuickPickItem<GitStashCommit>>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: typeof placeholder === 'string' ? placeholder : placeholder(context, stash),
		ignoreFocusOut: ignoreFocusOut,
		matchOnDescription: true,
		matchOnDetail: true,
		items:
			stash == null
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: [
						...map(stash.commits.values(), commit =>
							createCommitQuickPickItem(
								commit,
								picked != null &&
									(typeof picked === 'string' ? commit.ref === picked : picked.includes(commit.ref)),
								{
									buttons: [ShowDetailsViewQuickInputButton],
									compact: true,
									icon: true,
								},
							),
						),
				  ],
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === ShowDetailsViewQuickInputButton) {
				void StashActions.showDetailsView(item, { pin: false, preserveFocus: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await StashActions.showDetailsView(quickpick.activeItems[0].item, { pin: false, preserveFocus: true });
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
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
		buttons: [RevealInSideBarQuickInputButton],
		filter: filter,
		picked: picked,
	});

	const step = createPickStep<TagQuickPickItem>({
		multiselect: tags.length !== 0,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: tags.length === 0 ? `No tags found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			tags.length === 0
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: tags,
		onDidClickItemButton: (quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void TagActions.reveal(item, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await TagActions.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
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
		buttons: [OpenInNewWindowQuickInputButton, RevealInSideBarQuickInputButton],
		filter: filter,
		includeStatus: includeStatus,
		picked: picked,
	});

	const step = createPickStep<WorktreeQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: worktrees.length === 0 ? `No worktrees found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			worktrees.length === 0
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: worktrees,
		onDidClickItemButton: (quickpick, button, { item }) => {
			switch (button) {
				case OpenInNewWindowQuickInputButton:
					openWorkspace(item.uri, { location: 'newWindow' });
					break;
				case RevealInSideBarQuickInputButton:
					void WorktreeActions.reveal(item, { select: true, focus: false, expand: true });
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await WorktreeActions.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
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
		buttons: [OpenInNewWindowQuickInputButton, RevealInSideBarQuickInputButton],
		filter: filter,
		includeStatus: includeStatus,
		picked: picked,
	});

	const step = createPickStep<WorktreeQuickPickItem>({
		multiselect: worktrees.length !== 0,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: worktrees.length === 0 ? `No worktrees found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			worktrees.length === 0
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: worktrees,
		onDidClickItemButton: (quickpick, button, { item }) => {
			switch (button) {
				case OpenInNewWindowQuickInputButton:
					openWorkspace(item.uri, { location: 'newWindow' });
					break;
				case RevealInSideBarQuickInputButton:
					void WorktreeActions.reveal(item, { select: true, focus: false, expand: true });
					break;
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await WorktreeActions.reveal(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}

export async function* showCommitOrStashStep<
	State extends PartialStepState & { repo: Repository; reference: GitCommit | GitStashCommit },
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
): AsyncStepResultGenerator<CommitFilesQuickPickItem | GitCommandQuickPickItem | CommandQuickPickItem> {
	const step: QuickPickStep<CommitFilesQuickPickItem | GitCommandQuickPickItem | CommandQuickPickItem> =
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
			items: await getShowCommitOrStashStepItems(state),
			// additionalButtons: [ShowDetailsView, RevealInSideBar],
			onDidClickItemButton: (quickpick, button, _item) => {
				switch (button) {
					case ShowDetailsViewQuickInputButton:
						if (isStashReference(state.reference)) {
							void StashActions.showDetailsView(state.reference, { pin: false, preserveFocus: true });
						} else {
							void CommitActions.showDetailsView(state.reference, {
								pin: false,
								preserveFocus: true,
							});
						}
						break;
					case RevealInSideBarQuickInputButton:
						if (isStashReference(state.reference)) {
							void StashActions.reveal(state.reference, {
								select: true,
								focus: false,
								expand: true,
							});
						} else {
							void CommitActions.reveal(state.reference, {
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

			createQuickPickSeparator(),
			new CommitCopyMessageQuickPickItem(state.reference),
		);
	} else {
		const remotes = await Container.instance.git.getRemotesWithProviders(state.repo.path, { sort: true });
		if (remotes?.length) {
			items.push(
				createQuickPickSeparator(GitRemote.getHighlanderProviderName(remotes) ?? 'Remote'),
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

			createQuickPickSeparator(),
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
			...(state.reference.files?.map(
				fs => new CommitFileQuickPickItem(state.reference, fs, options?.picked === fs.path),
			) ?? []),
		] as (CommitFilesQuickPickItem | CommitFileQuickPickItem)[],
		matchOnDescription: true,
		// additionalButtons: [ShowDetailsView, RevealInSideBar],
		onDidClickItemButton: (quickpick, button, _item) => {
			switch (button) {
				case ShowDetailsViewQuickInputButton:
					if (isStashReference(state.reference)) {
						void StashActions.showDetailsView(state.reference, { pin: false, preserveFocus: true });
					} else {
						void CommitActions.showDetailsView(state.reference, {
							pin: false,
							preserveFocus: true,
						});
					}
					break;
				case RevealInSideBarQuickInputButton:
					if (isStashReference(state.reference)) {
						void StashActions.reveal(state.reference, {
							select: true,
							focus: false,
							expand: true,
						});
					} else {
						void CommitActions.reveal(state.reference, {
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
	return canPickStepContinue(step, state, selection) ? selection[0] : StepResultBreak;
}

export async function* showCommitOrStashFileStep<
	State extends PartialStepState & {
		repo: Repository;
		reference: GitCommit | GitStashCommit;
		fileName: string;
	},
	Context extends { repos: Repository[]; title: string },
>(state: State, context: Context): AsyncStepResultGenerator<CommandQuickPickItem> {
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
		items: await getShowCommitOrStashFileStepItems(state),
		matchOnDescription: true,
		// additionalButtons: [ShowDetailsView, RevealInSideBar],
		onDidClickItemButton: (quickpick, button, _item) => {
			switch (button) {
				case ShowDetailsViewQuickInputButton:
					if (isStashReference(state.reference)) {
						void StashActions.showDetailsView(state.reference, { pin: false, preserveFocus: true });
					} else {
						void CommitActions.showDetailsView(state.reference, {
							pin: false,
							preserveFocus: true,
						});
					}
					break;
				case RevealInSideBarQuickInputButton:
					if (isStashReference(state.reference)) {
						void StashActions.reveal(state.reference, {
							select: true,
							focus: false,
							expand: true,
						});
					} else {
						void CommitActions.reveal(state.reference, {
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
	return canPickStepContinue(step, state, selection) ? selection[0] : StepResultBreak;
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
		const remotes = await Container.instance.git.getRemotesWithProviders(state.repo.path, { sort: true });
		if (remotes?.length) {
			items.push(
				createQuickPickSeparator(GitRemote.getHighlanderProviderName(remotes) ?? 'Remote'),
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

export function* showRepositoryStatusStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string; status: GitStatus },
>(state: State, context: Context): StepResultGenerator<CommandQuickPickItem> {
	const upstream = context.status.getUpstreamStatus({ expand: true, separator: ', ' });
	const working = context.status.getFormattedDiffStatus({ expand: true, separator: ', ' });
	const step: QuickPickStep<CommandQuickPickItem> = createPickStep<CommandQuickPickItem>({
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
	return canPickStepContinue(step, state, selection) ? selection[0] : StepResultBreak;
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
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is up to date with $(git-branch) ${context.status.upstream}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.ahead !== 0 && context.status.state.behind !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} has diverged from $(git-branch) ${context.status.upstream}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.ahead !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is ahead of $(git-branch) ${context.status.upstream}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.behind !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
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
							reference: createReference(
								createRevisionRange(context.status.ref, context.status.upstream),
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
							reference: createReference(
								createRevisionRange(context.status.upstream, context.status.ref),
								state.repo.path,
							),
						},
					},
				),
			);
		}
	} else {
		items.push(
			createDirectiveQuickPickItem(Directive.Noop, true, {
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

		items.push(
			new OpenOnlyChangedFilesCommandQuickPickItem(
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

		items.push(
			new OpenOnlyChangedFilesCommandQuickPickItem(computed.stagedAddsAndChanges, {
				label: '$(files) Open Only Staged Files',
			}),
		);
	}

	if (computed.unstaged > 0) {
		items.push(
			new OpenChangedFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, {
				label: '$(files) Open Unstaged Files',
			}),
		);

		items.push(
			new OpenOnlyChangedFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, {
				label: '$(files) Open Only Unstaged Files',
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
		directives.push(createDirectiveQuickPickItem(Directive.RequiresVerification, true));
		placeholder = 'You must verify your email before you can continue';
	} else {
		if (access.subscription.required == null) return undefined;

		placeholder = '✨ Requires a trial or paid plan for use on privately hosted repos';
		if (isSubscriptionPaidPlan(access.subscription.required) && access.subscription.current.account != null) {
			placeholder = '✨ Requires a paid plan for use on privately hosted repos';
			directives.push(createDirectiveQuickPickItem(Directive.RequiresPaidSubscription, true));
		} else if (
			access.subscription.current.account == null &&
			!isSubscriptionPreviewTrialExpired(access.subscription.current)
		) {
			directives.push(createDirectiveQuickPickItem(Directive.StartPreviewTrial, true));
		} else {
			directives.push(createDirectiveQuickPickItem(Directive.ExtendTrial));
		}
	}

	const step = createPickStep<DirectiveQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		placeholder: placeholder,
		items: [...directives, createDirectiveQuickPickItem(Directive.Cancel)],
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? undefined : StepResultBreak;
}

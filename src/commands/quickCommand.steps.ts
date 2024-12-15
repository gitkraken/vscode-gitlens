import type { QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import { ThemeIcon } from 'vscode';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import { GlCommand } from '../constants.commands';
import { Container } from '../container';
import type { FeatureAccess, RepoFeatureAccess } from '../features';
import { PlusFeatures } from '../features';
import * as BranchActions from '../git/actions/branch';
import * as CommitActions from '../git/actions/commit';
import * as ContributorActions from '../git/actions/contributor';
import * as RemoteActions from '../git/actions/remote';
import * as RepositoryActions from '../git/actions/repository';
import * as StashActions from '../git/actions/stash';
import * as TagActions from '../git/actions/tag';
import * as WorktreeActions from '../git/actions/worktree';
import type { PagedResult } from '../git/gitProvider';
import type { GitBranch } from '../git/models/branch';
import type { GitCommit, GitStashCommit } from '../git/models/commit';
import { isCommit, isStash } from '../git/models/commit';
import type { GitContributor } from '../git/models/contributor';
import type { ContributorQuickPickItem } from '../git/models/contributor.quickpick';
import { createContributorQuickPickItem } from '../git/models/contributor.quickpick';
import type { GitLog } from '../git/models/log';
import type { GitBranchReference, GitReference, GitRevisionReference, GitTagReference } from '../git/models/reference';
import {
	createReference,
	getReferenceLabel,
	isBranchReference,
	isRevisionReference,
	isStashReference,
	isTagReference,
} from '../git/models/reference.utils';
import type { GitRemote } from '../git/models/remote';
import { getHighlanderProviderName } from '../git/models/remote';
import { RemoteResourceType } from '../git/models/remoteResource';
import { Repository } from '../git/models/repository';
import { createRevisionRange, isRevisionRange } from '../git/models/revision.utils';
import type { GitStash } from '../git/models/stash';
import type { GitStatus } from '../git/models/status';
import type { GitTag } from '../git/models/tag';
import type { GitWorktree } from '../git/models/worktree';
import type { WorktreeQuickPickItem } from '../git/models/worktree.quickpick';
import { createWorktreeQuickPickItem } from '../git/models/worktree.quickpick';
import { getWorktreesByBranch } from '../git/models/worktree.utils';
import { remoteUrlRegex } from '../git/parsers/remoteParser';
import type { BranchSortOptions, TagSortOptions } from '../git/utils/sorting';
import { sortBranches, sortContributors, sortTags, sortWorktrees } from '../git/utils/sorting';
import { getApplicablePromo } from '../plus/gk/account/promos';
import { isSubscriptionPaidPlan, isSubscriptionPreviewTrialExpired } from '../plus/gk/account/subscription';
import type { LaunchpadCommandArgs } from '../plus/launchpad/launchpad';
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
import type { QuickPickItemOfT, QuickPickSeparator } from '../quickpicks/items/common';
import { CommandQuickPickItem, createQuickPickSeparator } from '../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive, isDirectiveQuickPickItem } from '../quickpicks/items/directive';
import type {
	BranchQuickPickItem,
	CommitQuickPickItem,
	RemoteQuickPickItem,
	RepositoryQuickPickItem,
	TagQuickPickItem,
} from '../quickpicks/items/gitWizard';
import {
	createBranchQuickPickItem,
	createCommitQuickPickItem,
	createRefQuickPickItem,
	createRemoteQuickPickItem,
	createRepositoryQuickPickItem,
	createStashQuickPickItem,
	createTagQuickPickItem,
	GitWizardQuickPickItem,
} from '../quickpicks/items/gitWizard';
import type { ReferencesQuickPickItem } from '../quickpicks/referencePicker';
import {
	CopyRemoteResourceCommandQuickPickItem,
	OpenRemoteResourceCommandQuickPickItem,
} from '../quickpicks/remoteProviderPicker';
import { filterMap, intersection, isStringArray } from '../system/array';
import { debounce } from '../system/function';
import { first, map } from '../system/iterable';
import { Logger } from '../system/logger';
import { getSettledValue } from '../system/promise';
import { pad, pluralize, truncate } from '../system/string';
import { executeCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { formatPath } from '../system/vscode/formatPath';
import { openWorkspace } from '../system/vscode/utils';
import { getIconPathUris } from '../system/vscode/vscode';
import type { ViewsWithRepositoryFolders } from '../views/viewBase';
import type {
	AsyncStepResultGenerator,
	CrossCommandReference,
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
	createCrossCommandReference,
	createInputStep,
	createPickStep,
	endSteps,
	isCrossCommandReference,
	StepResultBreak,
} from './quickCommand';
import {
	LoadMoreQuickInputButton,
	OpenChangesViewQuickInputButton,
	OpenInNewWindowQuickInputButton,
	PickCommitQuickInputButton,
	RevealInSideBarQuickInputButton,
	ShowDetailsViewQuickInputButton,
	ShowTagsToggleQuickInputButton,
} from './quickCommand.buttons';
import type { OpenWalkthroughCommandArgs } from './walkthroughs';

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

	const remotes = (await repo.git.getRemotes(options?.filter != null ? { filter: options.filter } : undefined)).map(
		r =>
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
		excludeOpened,
		filter,
		includeStatus,
		picked,
	}: {
		buttons?: QuickInputButton[];
		excludeOpened?: boolean;
		filter?: (t: GitWorktree) => boolean;
		includeStatus?: boolean;
		picked?: string | string[];
	},
): Promise<WorktreeQuickPickItem[]> {
	const worktrees =
		repoOrWorktrees instanceof Repository ? await repoOrWorktrees.git.getWorktrees() : repoOrWorktrees;

	const items = filterMap(
		await Promise.allSettled(
			map(worktrees, async w => {
				if ((excludeOpened && w.opened) || filter?.(w) === false) return undefined;

				let missing = false;
				let status;
				if (includeStatus) {
					try {
						status = await w.getStatus();
					} catch (ex) {
						Logger.error(ex, `Worktree status failed: ${w.uri.toString(true)}`);
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
						includeStatus: includeStatus,
						path: true,
						status: status,
					},
				);
			}),
		),
		r => (r.status === 'fulfilled' ? r.value : undefined),
	);

	return sortWorktrees(items);
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

	let worktreesByBranch: Map<string, GitWorktree> | undefined;

	let branches: GitBranch[] | undefined;
	let tags: GitTag[] | undefined;

	let singleRepo = false;
	if (repos instanceof Repository || repos.length === 1) {
		singleRepo = true;
		const repo = repos instanceof Repository ? repos : repos[0];

		// TODO@eamodio handle paging
		const [worktreesByBranchResult, branchesResult, tagsResult] = await Promise.allSettled([
			include.includes('branches') ? getWorktreesByBranch(repo) : undefined,
			include.includes('branches')
				? repo.git.getBranches({
						filter: filter?.branches,
						sort: typeof sort === 'boolean' ? sort : sort?.branches,
				  })
				: undefined,
			include.includes('tags') ? repo.git.getTags({ filter: filter?.tags, sort: true }) : undefined,
		]);

		worktreesByBranch = getSettledValue(worktreesByBranchResult);
		branches = getSettledValue(branchesResult)?.values ?? [];
		tags = getSettledValue(tagsResult)?.values ?? [];
	} else {
		// TODO@eamodio handle paging
		const [worktreesByBranchResult, branchesByRepoResult, tagsByRepoResult] = await Promise.allSettled([
			include.includes('branches') ? getWorktreesByBranch(repos) : undefined,
			include.includes('branches')
				? Promise.allSettled(
						repos.map(r =>
							r.git.getBranches({
								filter: filter?.branches,
								sort: typeof sort === 'boolean' ? sort : sort?.branches,
							}),
						),
				  )
				: undefined,
			include.includes('tags')
				? Promise.allSettled(
						repos.map(r =>
							r.git.getTags({
								filter: filter?.tags,
								sort: typeof sort === 'boolean' ? sort : sort?.tags,
							}),
						),
				  )
				: undefined,
		]);

		worktreesByBranch = getSettledValue(worktreesByBranchResult);
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
								worktree: worktreesByBranch?.has(b.id),
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
							worktree: worktreesByBranch?.has(b.id),
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
			await createCommitQuickPickItem(commit!, true, {
				alwaysShow: true,
				buttons: options?.buttons,
				compact: true,
				icon: 'avatar',
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
	options: { placeholder?: string; prompt?: string; titleContext?: string; value?: string },
): AsyncStepResultGenerator<string> {
	const step = createInputStep({
		title: appendReposToTitle(`${context.title}${options.titleContext ?? ''}`, state, context),
		placeholder: options.placeholder ?? 'Branch name',
		value: options.value,
		prompt: options.prompt ?? 'Please provide a new branch name',
		validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
			if (value == null) return [false, undefined];

			value = value.trim();
			if (value.length === 0) return [false, 'Please enter a valid branch name'];

			if ('repo' in state) {
				const valid = await Container.instance.git.validateBranchOrTagName(state.repo.path, value);
				if (!valid) {
					return [false, `'${value}' isn't a valid branch name`];
				}

				const alreadyExists = await state.repo.git.getBranch(value);
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

				const alreadyExists = await repo.git.getBranch(value);
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
				const alreadyExists = (await state.repo.git.getRemotes({ filter: r => r.name === value })).length !== 0;
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

export function* pickBranchStep<
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
): StepResultGenerator<GitBranchReference> {
	const items = getBranches(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: filter,
		picked: picked,
	}).then(branches =>
		branches.length === 0
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: branches,
	);

	const step = createPickStep<BranchQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: count => (!count ? `No branches found in ${state.repo.formattedName}` : placeholder),
		matchOnDetail: true,
		items: items,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void BranchActions.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await BranchActions.reveal(item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

export function* pickBranchesStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; showTags?: boolean; title: string },
>(
	state: State,
	context: Context,
	{
		filter,
		picked,
		placeholder,
		emptyPlaceholder,
		sort,
		titleContext,
	}: {
		filter?: (b: GitBranch) => boolean;
		picked?: string | string[];
		placeholder: string;
		emptyPlaceholder?: string;
		sort?: BranchSortOptions;
		titleContext?: string;
	},
): StepResultGenerator<GitBranchReference[]> {
	const items = getBranches(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: filter,
		picked: picked,
		sort: sort,
	}).then(branches =>
		!branches.length
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: branches,
	);

	const step = createPickStep<BranchQuickPickItem>({
		multiselect: true,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: count =>
			!count ? emptyPlaceholder ?? `No branches found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items: items,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void BranchActions.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await BranchActions.reveal(item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}

export function* pickBranchOrTagStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; pickCommitForItem?: boolean; showTags?: boolean; title: string },
>(
	state: State,
	context: Context,
	{
		filter,
		picked,
		placeholder,
		title,
		titleContext,
		value,
		additionalButtons,
		ranges,
	}: {
		filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context) => string);
		title?: string;
		titleContext?: string;
		value: string | undefined;
		additionalButtons?: QuickInputButton[];
		ranges?: boolean;
	},
): StepResultGenerator<GitReference> {
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
	const items = getBranchesAndOrTagsFn().then(branchesAndOrTags =>
		branchesAndOrTags.length === 0
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: branchesAndOrTags,
	);

	const step = createPickStep<ReferencesQuickPickItem>({
		title: appendReposToTitle(`${title ?? context.title}${titleContext ?? ''}`, state, context),
		placeholder: count =>
			!count
				? `No branches${context.showTags ? ' or tags' : ''} found in ${state.repo.formattedName}`
				: `${
						typeof placeholder === 'string' ? placeholder : placeholder(context)
				  } (or enter a revision using #)`,
		matchOnDescription: true,
		matchOnDetail: true,
		value: value,
		selectValueWhenShown: true,
		items: items,
		additionalButtons: [...(additionalButtons ?? []), showTagsButton],
		onDidClickItemButton: (_quickpick, button, { item }) => {
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
							  } (or enter a revision using #)`;
					quickpick.items = branchesAndOrTags;
				} finally {
					quickpick.busy = false;
				}
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: (_quickpick, _key, { item }) => {
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

export function* pickBranchOrTagStepMultiRepo<
	State extends StepState & { repos: Repository[]; reference?: GitReference },
	Context extends { allowCreate?: boolean; repos: Repository[]; showTags?: boolean; title: string },
>(
	state: State,
	context: Context,
	{
		allowCreate,
		filter,
		picked,
		placeholder,
		titleContext,
		value,
	}: {
		allowCreate?: boolean;
		filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		picked?: string | string[];
		placeholder: string | ((context: Context) => string);
		titleContext?: string;
		value?: string;
	},
): StepResultGenerator<GitReference | CrossCommandReference | string> {
	context.showTags = state.repos.length === 1;

	const showTagsButton = new ShowTagsToggleQuickInputButton(context.showTags);

	const createNewBranchItem: QuickPickItem & { item: string } = {
		label: 'Create New Branch...',
		iconPath: new ThemeIcon('plus'),
		alwaysShow: true,
		item: '',
	};

	const choosePullRequestItem: QuickPickItemOfT<CrossCommandReference> = {
		label: 'Choose a Pull Request...',
		iconPath: new ThemeIcon('git-pull-request'),
		alwaysShow: true,
		item: createCrossCommandReference<Partial<LaunchpadCommandArgs>>(GlCommand.ShowLaunchpad, {
			source: 'quick-wizard',
		}),
	};

	const getBranchesAndOrTagsFn = () => {
		return getBranchesAndOrTags(state.repos, context.showTags ? ['branches', 'tags'] : ['branches'], {
			buttons: [RevealInSideBarQuickInputButton],
			// Filter out remote branches if we are going to affect multiple repos
			filter: { branches: state.repos.length === 1 ? undefined : b => !b.remote, ...filter },
			picked: picked ?? state.reference?.ref,
			sort: { branches: { orderBy: 'date:desc' }, tags: { orderBy: 'date:desc' } },
		});
	};
	const items = getBranchesAndOrTagsFn().then(branchesAndOrTags =>
		branchesAndOrTags.length === 0
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: allowCreate
			  ? [createNewBranchItem, choosePullRequestItem, ...branchesAndOrTags]
			  : [choosePullRequestItem, ...branchesAndOrTags],
	);

	const step = createPickStep<ReferencesQuickPickItem | typeof createNewBranchItem | typeof choosePullRequestItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: count =>
			!count
				? `No ${state.repos.length === 1 ? '' : 'common '}branches${
						context.showTags ? ' or tags' : ''
				  } found in ${state.repos.length === 1 ? state.repos[0].formattedName : `${state.repos.length} repos`}`
				: `${
						typeof placeholder === 'string' ? placeholder : placeholder(context)
				  } (or enter a revision using #)`,
		matchOnDescription: true,
		matchOnDetail: true,
		value: value ?? (isRevisionReference(state.reference) ? state.reference.ref : undefined),
		selectValueWhenShown: true,
		items: items,
		additionalButtons: [showTagsButton],
		onDidChangeValue: quickpick => {
			createNewBranchItem.item = quickpick.value;
			return true;
		},
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (typeof item === 'string' || isCrossCommandReference(item)) return;

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
										: `${state.repos.length} repos`
							  }`
							: `${
									typeof placeholder === 'string' ? placeholder : placeholder(context)
							  } (or enter a revision using #)`;
					quickpick.items = branchesAndOrTags;
				} finally {
					quickpick.busy = false;
				}
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: (_quickpick, _key, { item }) => {
			if (typeof item === 'string' || isCrossCommandReference(item)) return;

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
	async function getItems(log: GitLog | undefined) {
		if (log == null) {
			return [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)];
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
						picked != null &&
							(typeof picked === 'string' ? commit.ref === picked : picked.includes(commit.ref)),
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

	const items = getItems(log).then(items =>
		showInSideBarCommand != null ? [showInSideBarCommand, ...items] : items,
	);

	const step = createPickStep<CommandQuickPickItem | CommitQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: typeof placeholder === 'string' ? placeholder : placeholder(context, log),
		ignoreFocusOut: ignoreFocusOut,
		matchOnDescription: true,
		matchOnDetail: true,
		value: typeof picked === 'string' && log?.count === 0 ? picked : undefined,
		selectValueWhenShown: true,
		items: items,
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
		onDidClickItemButton: (_quickpick, button, item) => {
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
	async function getItems(log: GitLog | undefined) {
		if (log == null) {
			return [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)];
		}

		const items = filterMap(
			await Promise.allSettled(
				map(log.commits.values(), async commit =>
					createCommitQuickPickItem(
						commit,
						picked != null &&
							(typeof picked === 'string' ? commit.ref === picked : picked.includes(commit.ref)),
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
		onDidClickItemButton: (_quickpick, button, { item }) => {
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
		onDidPressKey: async (_quickpick, key, { item }) => {
			if (key === 'ctrl+right') {
				void CommitActions.showDetailsView(item, {
					pin: false,
					preserveFocus: true,
				});
			} else {
				await CommitActions.reveal(item, {
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

export function* pickContributorsStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string },
>(state: State, context: Context, placeholder: string = 'Choose contributors'): StepResultGenerator<GitContributor[]> {
	async function getItems() {
		const message = (await Container.instance.git.getOrOpenScmRepository(state.repo.path))?.inputBox.value;

		const items = [];

		for (const c of await Container.instance.git.getContributors(state.repo.path)) {
			items.push(
				await createContributorQuickPickItem(c, message?.includes(c.getCoauthor()), {
					buttons: [RevealInSideBarQuickInputButton],
				}),
			);
		}

		return sortContributors(items);
	}

	const step = createPickStep<ContributorQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		allowEmpty: true,
		multiselect: true,
		placeholder: placeholder,
		matchOnDescription: true,
		items: getItems(),
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void ContributorActions.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		onDidChangeSelection: debounce((quickpick, e) => {
			if (!quickpick.canSelectMany || quickpick.busy) return;

			let update = false;
			for (const item of quickpick.items) {
				if (isDirectiveQuickPickItem(item)) continue;

				const picked = e.includes(item);
				if (item.picked !== picked || item.alwaysShow !== picked) {
					item.alwaysShow = item.picked = picked;
					update = true;
				}
			}

			if (update) {
				quickpick.items = sortContributors([...quickpick.items]);
				quickpick.selectedItems = e;
			}
		}, 10),
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: (_quickpick, _key, { item }) => {
			void ContributorActions.reveal(item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}

export function* pickRemoteStep<
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
): StepResultGenerator<GitRemote> {
	const items = getRemotes(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: filter,
		picked: picked,
	}).then(remotes =>
		remotes.length === 0
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: remotes,
	);

	const step = createPickStep<RemoteQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: count => (!count ? `No remotes found in ${state.repo.formattedName}` : placeholder),
		matchOnDetail: true,
		items: items,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void RemoteActions.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await RemoteActions.reveal(item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

export function* pickRemotesStep<
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
): StepResultGenerator<GitRemote[]> {
	const items = getRemotes(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: filter,
		picked: picked,
	}).then(remotes =>
		remotes.length === 0
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: remotes,
	);

	const step = createPickStep<RemoteQuickPickItem>({
		multiselect: true,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: count => (!count ? `No remotes found in ${state.repo.formattedName}` : placeholder),
		matchOnDetail: true,
		items: items,

		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void RemoteActions.reveal(item, { select: true, focus: false, expand: true });
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await RemoteActions.reveal(item, {
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
		placeholder: context.repos.length === 0 ? `${placeholder} — no opened repositories found` : placeholder,
		items:
			context.repos.length === 0
				? [
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: 'Cancel',
							detail: 'No opened repositories found',
						}),
				  ]
				: Promise.all(
						context.repos.map(r =>
							createRepositoryQuickPickItem(r, r.id === active?.id, {
								branch: true,
								buttons: [RevealInSideBarQuickInputButton],
								fetched: true,
								status: true,
							}),
						),
				  ),
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void RepositoryActions.reveal(item.path, context.associatedView, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: (_quickpick, _key, { item }) => {
			void RepositoryActions.reveal(item.path, context.associatedView, {
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
		placeholder:
			context.repos.length === 0 ? `${options.placeholder} — no opened repositories found` : options.placeholder,
		items:
			context.repos.length === 0
				? [
						createDirectiveQuickPickItem(Directive.Cancel, true, {
							label: 'Cancel',
							detail: 'No opened repositories found',
						}),
				  ]
				: Promise.all(
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
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void RepositoryActions.reveal(item.path, context.associatedView, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: (_quickpick, _key, { item }) => {
			void RepositoryActions.reveal(item.path, context.associatedView, {
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
		gitStash,
		picked,
		placeholder,
		titleContext,
	}: {
		ignoreFocusOut?: boolean;
		gitStash: GitStash | undefined;
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context, stash: GitStash | undefined) => string);
		titleContext?: string;
	},
): StepResultGenerator<GitStashCommit> {
	const step = createPickStep<CommitQuickPickItem<GitStashCommit>>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: typeof placeholder === 'string' ? placeholder : placeholder(context, gitStash),
		ignoreFocusOut: ignoreFocusOut,
		matchOnDescription: true,
		matchOnDetail: true,
		items:
			gitStash == null
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: [
						...map(gitStash.stashes.values(), stash =>
							createStashQuickPickItem(
								stash,
								picked != null &&
									(typeof picked === 'string' ? stash.ref === picked : picked.includes(stash.ref)),
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
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await StashActions.showDetailsView(item, { pin: false, preserveFocus: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

export function* pickStashesStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string },
>(
	state: State,
	context: Context,
	{
		ignoreFocusOut,
		gitStash,
		picked,
		placeholder,
		titleContext,
	}: {
		ignoreFocusOut?: boolean;
		gitStash: GitStash | undefined;
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context, stash: GitStash | undefined) => string);
		titleContext?: string;
	},
): StepResultGenerator<GitStashCommit[]> {
	const step = createPickStep<CommitQuickPickItem<GitStashCommit>>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		multiselect: true,
		placeholder: typeof placeholder === 'string' ? placeholder : placeholder(context, gitStash),
		ignoreFocusOut: ignoreFocusOut,
		matchOnDescription: true,
		matchOnDetail: true,
		items:
			gitStash == null
				? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
				: [
						...map(gitStash.stashes.values(), stash =>
							createStashQuickPickItem(
								stash,
								picked != null &&
									(typeof picked === 'string' ? stash.ref === picked : picked.includes(stash.ref)),
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
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await StashActions.showDetailsView(item, { pin: false, preserveFocus: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}

export function* pickTagsStep<
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
): StepResultGenerator<GitTagReference[]> {
	const items = getTags(state.repo, {
		buttons: [RevealInSideBarQuickInputButton],
		filter: filter,
		picked: picked,
	}).then(tags =>
		tags.length === 0
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: tags,
	);

	const step = createPickStep<TagQuickPickItem>({
		multiselect: true,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: count => (!count ? `No tags found in ${state.repo.formattedName}` : placeholder),
		matchOnDetail: true,
		items: items,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void TagActions.reveal(item, {
					select: true,
					focus: false,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await TagActions.reveal(item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}

export function* pickWorktreeStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string; worktrees?: GitWorktree[] },
>(
	state: State,
	context: Context,
	{
		excludeOpened,
		filter,
		includeStatus,
		picked,
		placeholder,
		titleContext,
	}: {
		excludeOpened?: boolean;
		filter?: (b: GitWorktree) => boolean;
		includeStatus?: boolean;
		picked?: string | string[];
		placeholder: string;
		titleContext?: string;
	},
): StepResultGenerator<GitWorktree> {
	const items = getWorktrees(context.worktrees ?? state.repo, {
		buttons: [OpenInNewWindowQuickInputButton, RevealInSideBarQuickInputButton],
		excludeOpened: excludeOpened,
		filter: filter,
		includeStatus: includeStatus,
		picked: picked,
	}).then(worktrees =>
		worktrees.length === 0
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: worktrees,
	);

	const step = createPickStep<WorktreeQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: count => (!count ? `No worktrees found in ${state.repo.formattedName}` : placeholder),
		matchOnDetail: true,
		items: items,
		onDidClickItemButton: (_quickpick, button, { item }) => {
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
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await WorktreeActions.reveal(item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

export function* pickWorktreesStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string; worktrees?: GitWorktree[] },
>(
	state: State,
	context: Context,
	{
		excludeOpened,
		filter,
		includeStatus,
		picked,
		placeholder,
		titleContext,
	}: {
		excludeOpened?: boolean;
		filter?: (b: GitWorktree) => boolean;
		includeStatus?: boolean;
		picked?: string | string[];
		placeholder: string;
		titleContext?: string;
	},
): StepResultGenerator<GitWorktree[]> {
	const items = getWorktrees(context.worktrees ?? state.repo, {
		buttons: [OpenInNewWindowQuickInputButton, RevealInSideBarQuickInputButton],
		excludeOpened: excludeOpened,
		filter: filter,
		includeStatus: includeStatus,
		picked: picked,
	}).then(worktrees =>
		worktrees.length === 0
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: worktrees,
	);

	const step = createPickStep<WorktreeQuickPickItem>({
		multiselect: true,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: count => (!count ? `No worktrees found in ${state.repo.formattedName}` : placeholder),
		matchOnDetail: true,
		items: items,
		onDidClickItemButton: (_quickpick, button, { item }) => {
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
		onDidPressKey: async (_quickpick, _key, { item }) => {
			await WorktreeActions.reveal(item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}

export function* showCommitOrStashStep<
	State extends PartialStepState & { repo: Repository; reference: GitCommit | GitStashCommit },
	Context extends { repos: Repository[]; title: string },
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
			// additionalButtons: [ShowDetailsView, RevealInSideBar],
			onDidClickItemButton: (_quickpick, button, _item) => {
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
		const remotes = await Container.instance.git.getRemotesWithProviders(state.repo.path, { sort: true });
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

		const branch = await Container.instance.git.getBranch(state.repo.path);
		const [branches, published] = await Promise.all([
			branch != null
				? Container.instance.git.getCommitBranches(state.repo.path, state.reference.ref, branch.name, {
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
		onDidClickItemButton: (_quickpick, button, _item) => {
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
	Context extends { repos: Repository[]; title: string },
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
		// additionalButtons: [ShowDetailsView, RevealInSideBar],
		onDidClickItemButton: (_quickpick, button, _item) => {
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
		onDidPressKey: async (_quickpick, key, item) => {
			await item.onDidPressKey(key);
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

export function* showRepositoryStatusStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string; status: GitStatus },
>(state: State, context: Context): StepResultGenerator<CommandQuickPickItem> {
	const upstream = context.status.getUpstreamStatus({ expand: true, separator: ', ' });
	const working = context.status.getFormattedDiffStatus({ expand: true, separator: ', ' });
	const step: QuickPickStep<CommandQuickPickItem> = createPickStep<CommandQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		placeholder: upstream ? `${upstream}, ${working}` : working, //'Changes to be committed',
		ignoreFocusOut: true,
		items: getShowRepositoryStatusStepItems(state, context),
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (_quickpick, key, item) => {
			await item.onDidPressKey(key);
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
					label: `$(git-branch) ${context.status.branch} is up to date with $(git-branch) ${context.status.upstream?.name}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.ahead !== 0 && context.status.state.behind !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} has diverged from $(git-branch) ${context.status.upstream?.name}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.ahead !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is ahead of $(git-branch) ${context.status.upstream?.name}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.behind !== 0) {
			items.push(
				createDirectiveQuickPickItem(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is behind $(git-branch) ${context.status.upstream?.name}`,
					detail: workingTreeStatus,
				}),
			);
		}

		if (context.status.state.behind !== 0) {
			items.push(
				new GitWizardQuickPickItem(
					`$(cloud-download) ${pluralize('commit', context.status.state.behind)} behind`,
					{
						command: 'log',
						state: {
							repo: state.repo,
							reference: createReference(
								createRevisionRange(context.status.ref, context.status.upstream?.name, '..'),
								state.repo.path,
							),
						},
					},
				),
			);
		}

		if (context.status.state.ahead !== 0) {
			items.push(
				new GitWizardQuickPickItem(`$(cloud-upload) ${pluralize('commit', context.status.state.ahead)} ahead`, {
					command: 'log',
					state: {
						repo: state.repo,
						reference: createReference(
							createRevisionRange(context.status.upstream?.name, context.status.ref, '..'),
							state.repo.path,
						),
					},
				}),
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
		items.push(new OpenChangedFilesCommandQuickPickItem(computed.stagedAddsAndChanges, 'Open Staged Files'));

		items.push(
			new OpenOnlyChangedFilesCommandQuickPickItem(computed.stagedAddsAndChanges, 'Open Only Staged Files'),
		);
	}

	if (computed.unstaged > 0) {
		items.push(new OpenChangedFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, 'Open Unstaged Files'));

		items.push(
			new OpenOnlyChangedFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, 'Open Only Unstaged Files'),
		);
	}

	if (context.status.files.length) {
		items.push(
			new CommandQuickPickItem('Close Unchanged Files', new ThemeIcon('x'), GlCommand.CloseUnchangedFiles),
		);
	}

	return items;
}

export async function* ensureAccessStep<
	State extends PartialStepState & { repo?: Repository },
	Context extends { title: string },
>(state: State, context: Context, feature: PlusFeatures): AsyncStepResultGenerator<FeatureAccess | RepoFeatureAccess> {
	const access = await Container.instance.git.access(feature, state.repo?.path);
	if (access.allowed) return access;

	const directives: DirectiveQuickPickItem[] = [];
	let placeholder: string;
	if (access.subscription.current.account?.verified === false) {
		directives.push(
			createDirectiveQuickPickItem(Directive.RequiresVerification, true),
			createQuickPickSeparator(),
			createDirectiveQuickPickItem(Directive.Cancel),
		);
		placeholder = 'You must verify your email before you can continue';
	} else {
		if (access.subscription.required == null) return access;

		const promo = getApplicablePromo(access.subscription.current.state, 'gate');
		const detail = promo?.quickpick.detail;

		placeholder = 'Pro feature — requires a trial or GitLens Pro for use on privately-hosted repos';
		if (isSubscriptionPaidPlan(access.subscription.required) && access.subscription.current.account != null) {
			placeholder = 'Pro feature — requires GitLens Pro for use on privately-hosted repos';
			directives.push(
				createDirectiveQuickPickItem(Directive.RequiresPaidSubscription, true, { detail: detail }),
				createQuickPickSeparator(),
				createDirectiveQuickPickItem(Directive.Cancel),
			);
		} else if (
			access.subscription.current.account == null &&
			!isSubscriptionPreviewTrialExpired(access.subscription.current)
		) {
			directives.push(
				createDirectiveQuickPickItem(Directive.StartPreview, true),
				createQuickPickSeparator(),
				createDirectiveQuickPickItem(Directive.Cancel),
			);
		} else {
			directives.push(
				createDirectiveQuickPickItem(Directive.StartProTrial, true),
				createDirectiveQuickPickItem(Directive.SignIn),
				createQuickPickSeparator(),
				createDirectiveQuickPickItem(Directive.Cancel),
			);
		}
	}

	switch (feature) {
		case PlusFeatures.Launchpad:
			directives.splice(
				0,
				0,
				createDirectiveQuickPickItem(Directive.Cancel, undefined, {
					label: 'Launchpad prioritizes your pull requests to keep you focused and your team unblocked',
					detail: 'Click to learn more about Launchpad',
					iconPath: new ThemeIcon('rocket'),
					onDidSelect: () =>
						void executeCommand<OpenWalkthroughCommandArgs>(GlCommand.OpenWalkthrough, {
							step: 'accelerate-pr-reviews',
							source: 'launchpad',
							detail: 'info',
						}),
				}),
				createQuickPickSeparator(),
			);
			break;
		case PlusFeatures.Worktrees:
			directives.splice(
				0,
				0,
				createDirectiveQuickPickItem(Directive.Noop, undefined, {
					label: 'Worktrees minimize context switching by allowing simultaneous work on multiple branches',
					iconPath: getIconPathUris(Container.instance, 'icon-repo.svg'),
				}),
			);
			break;
	}

	const step = createPickStep<DirectiveQuickPickItem>({
		title: context.title,
		placeholder: placeholder,
		items: directives,
		buttons: [],
		isConfirmationStep: true,
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? access : StepResultBreak;
}

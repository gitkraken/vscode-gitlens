import type { QuickInputButton, QuickPickItem } from 'vscode';
import { ThemeIcon } from 'vscode';
import { revealBranch } from '../../../git/actions/branch.js';
import { showCommitInDetailsView } from '../../../git/actions/commit.js';
import { revealTag } from '../../../git/actions/tag.js';
import type { PagedResult } from '../../../git/gitProvider.js';
import type { GitBranch } from '../../../git/models/branch.js';
import type { GitReference } from '../../../git/models/reference.js';
import type { Repository } from '../../../git/models/repository.js';
import type { GitTag } from '../../../git/models/tag.js';
import type { GitWorktree } from '../../../git/models/worktree.js';
import type { BranchSortOptions, TagSortOptions } from '../../../git/utils/-webview/sorting.js';
import { sortBranches, sortTags } from '../../../git/utils/-webview/sorting.js';
import { getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import { isBranchReference, isRevisionReference, isTagReference } from '../../../git/utils/reference.utils.js';
import type { LaunchpadCommandArgs } from '../../../plus/launchpad/launchpad.js';
import { createQuickPickSeparator } from '../../../quickpicks/items/common.js';
import { createDirectiveQuickPickItem, Directive } from '../../../quickpicks/items/directive.js';
import type { BranchQuickPickItem, TagQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import { createBranchQuickPickItem, createTagQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import type { ReferencesQuickPickItem } from '../../../quickpicks/referencePicker.js';
import { intersection } from '../../../system/array.js';
import { getSettledValue } from '../../../system/promise.js';
import type { CrossCommandReference } from '../models/quickWizard.js';
import type {
	PartialStepState,
	StepPickResult,
	StepResultGenerator,
	StepsContext,
	StepSelection,
} from '../models/steps.js';
import { StepResultBreak } from '../models/steps.js';
import {
	PickCommitQuickInputButton,
	RevealInSideBarQuickInputButton,
	ShowTagsToggleQuickInputButton,
} from '../quickButtons.js';
import { createCrossCommandReference } from '../utils/quickWizard.utils.js';
import {
	appendReposToTitle,
	canPickStepContinue,
	createPickStep,
	getValidateGitReferenceFn,
} from '../utils/steps.utils.js';

async function createBranchQuickPickItems<TBranch = GitBranch>(
	branches: GitBranch[],
	options: {
		buttons?: QuickInputButton[];
		mapItem?: (branch: GitBranch) => TBranch;
		picked?: string | string[];
		singleRepo: boolean;
		type?: boolean | 'remote';
		worktreesByBranch?: Map<string, GitWorktree>;
	},
): Promise<BranchQuickPickItem<TBranch>[]> {
	return Promise.all(
		branches.map(b =>
			createBranchQuickPickItem(
				b,
				options.picked != null &&
					(typeof options.picked === 'string' ? b.ref === options.picked : options.picked.includes(b.ref)),
				{
					buttons: options.buttons,
					current: options.singleRepo ? 'checkmark' : false,
					mapItem: options.mapItem,
					ref: options.singleRepo,
					status: options.singleRepo,
					type: options.type ?? 'remote',
					worktree: options.worktreesByBranch?.has(b.id),
				},
			),
		),
	);
}

export async function getBranchesAndOrTags<TBranch = GitBranch, TTag = GitTag>(
	repos: Repository | Repository[] | undefined,
	include: ('tags' | 'branches')[],
	options?: {
		buttons?: QuickInputButton[];
		filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		mapItem?: { branches?: (b: GitBranch) => TBranch; tags?: (t: GitTag) => TTag };
		picked?: string | string[];
		sort?: boolean | { branches?: BranchSortOptions; tags?: TagSortOptions };
	},
): Promise<(BranchQuickPickItem<TBranch> | TagQuickPickItem<TTag>)[]> {
	if (repos == null) return [];

	let worktreesByBranch: Map<string, GitWorktree> | undefined;

	let branches: GitBranch[] | undefined;
	let tags: GitTag[] | undefined;

	let singleRepo = false;
	if (!Array.isArray(repos) || repos.length === 1) {
		singleRepo = true;
		const repo = Array.isArray(repos) ? repos[0] : repos;

		const [worktreesByBranchResult, branchesResult, tagsResult] = await Promise.allSettled([
			include.includes('branches') ? getWorktreesByBranch(repo) : undefined,
			include.includes('branches')
				? repo.git.branches.getBranches({
						filter: options?.filter?.branches,
						sort: typeof options?.sort === 'boolean' ? options.sort : options?.sort?.branches,
					})
				: undefined,
			include.includes('tags') ? repo.git.tags.getTags({ filter: options?.filter?.tags, sort: true }) : undefined,
		]);

		worktreesByBranch = getSettledValue(worktreesByBranchResult);
		branches = getSettledValue(branchesResult)?.values ?? [];
		tags = getSettledValue(tagsResult)?.values ?? [];
	} else {
		const [worktreesByBranchResult, branchesByRepoResult, tagsByRepoResult] = await Promise.allSettled([
			include.includes('branches') ? getWorktreesByBranch(repos) : undefined,
			include.includes('branches')
				? Promise.allSettled(
						repos.map(r =>
							r.git.branches.getBranches({
								filter: options?.filter?.branches,
								sort: typeof options?.sort === 'boolean' ? options.sort : options?.sort?.branches,
							}),
						),
					)
				: undefined,
			include.includes('tags')
				? Promise.allSettled(
						repos.map(r =>
							r.git.tags.getTags({
								filter: options?.filter?.tags,
								sort: typeof options?.sort === 'boolean' ? options.sort : options?.sort?.tags,
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

	if (!branches?.length && !tags?.length) return [];

	if (branches?.length && !tags?.length) {
		const localBranches = branches.filter(b => !b.remote);
		const remoteBranches = branches.filter(b => b.remote);

		const items: BranchQuickPickItem<TBranch>[] = [];

		if (localBranches.length) {
			items.push(
				createQuickPickSeparator<BranchQuickPickItem<TBranch>>('Branches'),
				...(await createBranchQuickPickItems(localBranches, {
					buttons: options?.buttons,
					mapItem: options?.mapItem?.branches,
					picked: options?.picked,
					singleRepo: singleRepo,
					worktreesByBranch: worktreesByBranch,
				})),
			);
		}

		if (remoteBranches.length) {
			items.push(
				createQuickPickSeparator<BranchQuickPickItem<TBranch>>('Remote Branches'),
				...(await createBranchQuickPickItems(remoteBranches, {
					buttons: options?.buttons,
					mapItem: options?.mapItem?.branches,
					picked: options?.picked,
					singleRepo: singleRepo,
				})),
			);
		}

		return items;
	}

	if (tags?.length && !branches?.length) {
		const items = tags.map(t =>
			createTagQuickPickItem(
				t,
				options?.picked != null &&
					(typeof options.picked === 'string' ? t.ref === options.picked : options.picked.includes(t.ref)),
				{
					buttons: options?.buttons,
					mapItem: options?.mapItem?.tags,
					message: false,
					ref: singleRepo,
				},
			),
		);
		return items;
	}

	const localBranches = branches!.filter(b => !b.remote);
	const remoteBranches = branches!.filter(b => b.remote);

	const items: (BranchQuickPickItem<TBranch> | TagQuickPickItem<TTag>)[] = [];

	if (localBranches.length) {
		items.push(
			createQuickPickSeparator('Branches'),
			...(await createBranchQuickPickItems(localBranches, {
				buttons: options?.buttons,
				mapItem: options?.mapItem?.branches,
				picked: options?.picked,
				singleRepo: singleRepo,
				type: false,
				worktreesByBranch: worktreesByBranch,
			})),
		);
	}

	items.push(
		createQuickPickSeparator('Tags'),
		...tags!.map(t =>
			createTagQuickPickItem(
				t,
				options?.picked != null &&
					(typeof options.picked === 'string' ? t.ref === options.picked : options.picked.includes(t.ref)),
				{
					buttons: options?.buttons,
					mapItem: options?.mapItem?.tags,
					message: false,
					ref: singleRepo,
					type: true,
				},
			),
		),
	);

	if (remoteBranches.length) {
		items.push(
			createQuickPickSeparator('Remote Branches'),
			...(await createBranchQuickPickItems(remoteBranches, {
				buttons: options?.buttons,
				mapItem: options?.mapItem?.branches,
				picked: options?.picked,
				singleRepo: singleRepo,
			})),
		);
	}

	return items;
}

export function* pickBranchOrTagStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[]; pickCommitForItem?: boolean; showTags?: boolean },
>(
	state: State,
	context: Context,
	options: {
		filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context) => string);
		title?: string;
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
			filter: options.filter,
			picked: options.picked,
			sort: true,
		});
	};
	const items = getBranchesAndOrTagsFn().then(branchesAndOrTags =>
		branchesAndOrTags.length === 0
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: branchesAndOrTags,
	);

	const step = createPickStep<ReferencesQuickPickItem>({
		title: appendReposToTitle(options.title ?? context.title, state, context),
		placeholder: count =>
			!count
				? `No branches${context.showTags ? ' or tags' : ''} found in ${state.repo.name}`
				: `${
						typeof options.placeholder === 'string' ? options.placeholder : options.placeholder(context)
					} (or enter a revision using #)`,
		matchOnDescription: true,
		matchOnDetail: true,
		value: options.value,
		selectValueWhenShown: true,
		items: items,
		canGoBack: context.steps?.canGoBack,
		additionalButtons: [...(options.additionalButtons ?? []), showTagsButton],
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === PickCommitQuickInputButton) {
				context.pickCommitForItem = true;
				return true;
			}

			if (button === RevealInSideBarQuickInputButton) {
				if (isBranchReference(item)) {
					void revealBranch(item, { select: true, focus: false, expand: true });
				} else if (isTagReference(item)) {
					void revealTag(item, { select: true, focus: false, expand: true });
				} else if (isRevisionReference(item)) {
					void showCommitInDetailsView(item, { pin: false, preserveFocus: true });
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
							? `${state.repo.name} has no branches${context.showTags ? ' or tags' : ''}`
							: `${
									typeof options.placeholder === 'string'
										? options.placeholder
										: options.placeholder(context)
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
				void revealBranch(item, { select: true, focus: false, expand: true });
			} else if (isTagReference(item)) {
				void revealTag(item, { select: true, focus: false, expand: true });
			} else if (isRevisionReference(item)) {
				void showCommitInDetailsView(item, { pin: false, preserveFocus: true });
			}
		},
		onValidateValue: getValidateGitReferenceFn(
			state.repo,
			options.ranges ? { ranges: { allow: true, validate: true } } : undefined,
		),
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

type PickBranchOrTagStepActionResult =
	| ({ action: 'cross-command' } & CrossCommandReference)
	| { action: 'create-branch'; name: string };

export function* pickBranchOrTagStepMultiRepo<
	State extends PartialStepState & { repos: Repository[]; reference?: GitReference },
	Context extends StepsContext<any> & { allowCreate?: boolean; repos: Repository[]; showTags?: boolean },
>(
	state: State,
	context: Context,
	options: {
		allowCreate?: boolean;
		filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		picked?: string | string[];
		placeholder: string | ((context: Context) => string);
		title?: string;
		value?: string;
	},
): StepResultGenerator<StepPickResult<GitReference, PickBranchOrTagStepActionResult>> {
	context.showTags = state.repos.length === 1;

	const showTagsButton = new ShowTagsToggleQuickInputButton(context.showTags);

	type ResultItem = StepPickResult<GitReference, PickBranchOrTagStepActionResult>;
	const mapBranchOrTag = (ref: GitReference): ResultItem => ({ type: 'result', value: ref });

	type CreateBranchItem = QuickPickItem & { item: ResultItem };
	const createNewBranchItem: CreateBranchItem = {
		label: 'Create New Branch...',
		iconPath: new ThemeIcon('plus'),
		alwaysShow: true,
		item: { type: 'action', action: 'create-branch', name: '' },
	};

	type CrossCommandItem = QuickPickItem & { item: ResultItem };
	const choosePullRequestItem: CrossCommandItem = {
		label: 'Choose a Pull Request...',
		iconPath: new ThemeIcon('git-pull-request'),
		alwaysShow: true,
		item: {
			type: 'action',
			action: 'cross-command',
			...createCrossCommandReference<Partial<LaunchpadCommandArgs>>('gitlens.showLaunchpad', {
				source: 'quick-wizard',
			}),
		},
	};

	const getBranchesAndOrTagsFn = () => {
		return getBranchesAndOrTags(state.repos, context.showTags ? ['branches', 'tags'] : ['branches'], {
			buttons: [RevealInSideBarQuickInputButton],
			// Filter out remote branches if we are going to affect multiple repos
			filter: { branches: state.repos.length === 1 ? undefined : b => !b.remote, ...options.filter },
			mapItem: { branches: mapBranchOrTag, tags: mapBranchOrTag },
			picked: options.picked ?? state.reference?.ref,
			sort: { branches: { orderBy: 'date:desc' }, tags: { orderBy: 'date:desc' } },
		});
	};
	const items = getBranchesAndOrTagsFn().then(branchesAndOrTags =>
		!branchesAndOrTags.length
			? [createDirectiveQuickPickItem(Directive.Back, true), createDirectiveQuickPickItem(Directive.Cancel)]
			: options.allowCreate
				? [createNewBranchItem, choosePullRequestItem, ...branchesAndOrTags]
				: [choosePullRequestItem, ...branchesAndOrTags],
	);

	type PickItem =
		| BranchQuickPickItem<ResultItem>
		| TagQuickPickItem<ResultItem>
		| typeof createNewBranchItem
		| typeof choosePullRequestItem;

	const step = createPickStep<PickItem>({
		title: appendReposToTitle(options.title ?? context.title, state, context),
		canGoBack: context.steps?.canGoBack,
		placeholder: count =>
			!count
				? `No ${state.repos.length === 1 ? '' : 'common '}branches${
						context.showTags ? ' or tags' : ''
					} found in ${state.repos.length === 1 ? state.repos[0].name : `${state.repos.length} repos`}`
				: `${
						typeof options.placeholder === 'string' ? options.placeholder : options.placeholder(context)
					} (or enter a revision using #)`,
		matchOnDescription: true,
		matchOnDetail: true,
		value: options.value ?? (isRevisionReference(state.reference) ? state.reference.ref : undefined),
		selectValueWhenShown: true,
		items: items,
		additionalButtons: [showTagsButton],
		onDidChangeValue: quickpick => {
			createNewBranchItem.item = { type: 'action', action: 'create-branch', name: quickpick.value };
			return true;
		},
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (item.type !== 'result') return;

			const ref = item.value;
			if (button === RevealInSideBarQuickInputButton) {
				if (isBranchReference(ref)) {
					void revealBranch(ref, { select: true, focus: false, expand: true });
				} else if (isTagReference(ref)) {
					void revealTag(ref, { select: true, focus: false, expand: true });
				} else if (isRevisionReference(ref)) {
					void showCommitInDetailsView(ref, { pin: false, preserveFocus: true });
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
									state.repos.length === 1 ? state.repos[0].name : `${state.repos.length} repos`
								}`
							: `${
									typeof options.placeholder === 'string'
										? options.placeholder
										: options.placeholder(context)
								} (or enter a revision using #)`;
					quickpick.items = branchesAndOrTags;
				} finally {
					quickpick.busy = false;
				}
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: (_quickpick, _key, { item }) => {
			if (item.type !== 'result') return;

			const ref = item.value;
			if (isBranchReference(ref)) {
				void revealBranch(ref, { select: true, focus: false, expand: true });
			} else if (isTagReference(ref)) {
				void revealTag(ref, { select: true, focus: false, expand: true });
			} else if (isRevisionReference(ref)) {
				void showCommitInDetailsView(ref, { pin: false, preserveFocus: true });
			}
		},
		onValidateValue: getValidateGitReferenceFn(state.repos),
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
}

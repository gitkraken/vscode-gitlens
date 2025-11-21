import type { Disposable } from 'vscode';
import { CancellationTokenSource, QuickInputButtons, window } from 'vscode';
import { RevealInSideBarQuickInputButton } from '../commands/quickCommand.buttons';
import { getBranchesAndOrTags, getValidateGitReferenceFn } from '../commands/quickCommand.steps';
import type { Keys } from '../constants';
import { Container } from '../container';
import { revealBranch } from '../git/actions/branch';
import { showCommitInDetailsView } from '../git/actions/commit';
import { revealTag } from '../git/actions/tag';
import type { GitBranch } from '../git/models/branch';
import type { GitReference } from '../git/models/reference';
import type { GitTag } from '../git/models/tag';
import type { BranchSortOptions, TagSortOptions } from '../git/utils/-webview/sorting';
import { isBranchReference, isRevisionReference, isTagReference } from '../git/utils/reference.utils';
import type { KeyboardScope } from '../system/-webview/keyboard';
import { getQuickPickIgnoreFocusOut } from '../system/-webview/vscode';
import type { QuickPickResult } from './items/common';
import { createQuickPickSeparator } from './items/common';
import type { DirectiveQuickPickItem } from './items/directive';
import { createDirectiveQuickPickItem, Directive, isDirectiveQuickPickItem } from './items/directive';
import type { BranchQuickPickItem, RefQuickPickItem, TagQuickPickItem } from './items/gitWizard';
import { createRefQuickPickItem } from './items/gitWizard';

export type ReferencesQuickPickItem = BranchQuickPickItem | TagQuickPickItem | RefQuickPickItem;
export type ReferencesQuickPickIncludes = 'branches' | 'tags' | 'workingTree' | 'HEAD' | 'allBranches';

export interface ReferencesQuickPickOptions {
	allowedAdditionalInput?: { range?: boolean; rev?: boolean };
	autoPick?: boolean;
	picked?: string;
	exclude?: string[];
	filter?: { branches?(b: GitBranch): boolean; tags?(t: GitTag): boolean };
	include?: ReferencesQuickPickIncludes[];
	ignoreFocusOut?: boolean;
	keyboard?: {
		keys: Keys[];
		onDidPressKey(key: Keys, item: ReferencesQuickPickItem): void | Promise<void>;
	};
	sort?: boolean | { branches?: BranchSortOptions; tags?: TagSortOptions };
}

export interface ReferencesQuickPickOptions2 extends Omit<ReferencesQuickPickOptions, 'include'> {
	allowBack?: boolean;
	include?: ReferencesQuickPickIncludes[];
}

export async function showReferencePicker(
	repoPath: string,
	title: string,
	placeholder: string,
	options?: ReferencesQuickPickOptions,
): Promise<GitReference | undefined> {
	const result = await showReferencePicker2(repoPath, title, placeholder, options);
	return result?.value;
}

export async function showReferencePicker2(
	repoPath: string,
	title: string,
	placeholder: string,
	options?: ReferencesQuickPickOptions2,
): Promise<QuickPickResult<GitReference>> {
	const quickpick = window.createQuickPick<ReferencesQuickPickItem | DirectiveQuickPickItem>();
	quickpick.ignoreFocusOut = options?.ignoreFocusOut ?? getQuickPickIgnoreFocusOut();

	const { range: allowRanges, rev: allowRevs } = options?.allowedAdditionalInput ?? {};

	quickpick.title = title;
	quickpick.placeholder =
		allowRanges && allowRevs
			? `${placeholder} (or enter a range, or a revision prefixed with #)`
			: allowRanges
				? `${placeholder} (or enter a range)`
				: allowRevs
					? `${placeholder} (or enter a revision prefixed with #)`
					: placeholder;
	quickpick.matchOnDescription = true;
	if (options?.allowBack) {
		quickpick.buttons = [QuickInputButtons.Back];
	}

	const disposables: Disposable[] = [];

	let scope: KeyboardScope | undefined;
	if (options?.keyboard != null) {
		const { keyboard } = options;
		scope = Container.instance.keyboard.createScope(
			Object.fromEntries(
				keyboard.keys.map(key => [
					key,
					{
						onDidPressKey: async key => {
							if (quickpick.activeItems.length !== 0) {
								const [item] = quickpick.activeItems;
								if (item != null && !isDirectiveQuickPickItem(item)) {
									const ignoreFocusOut = quickpick.ignoreFocusOut;
									quickpick.ignoreFocusOut = true;

									await keyboard.onDidPressKey(key, item);

									quickpick.ignoreFocusOut = ignoreFocusOut;
								}
							}
						},
					},
				]),
			),
		);
		void scope.start();
		disposables.push(scope);
	}

	const cancellation = new CancellationTokenSource();

	let autopick: QuickPickResult<GitReference> | undefined;
	let items = getItems(repoPath, options);
	if (options?.autoPick) {
		items = items.then(itms => {
			const refItems = itms.filter((i): i is ReferencesQuickPickItem => !isDirectiveQuickPickItem(i));
			if (refItems.length <= 1) {
				autopick = { value: refItems[0]?.item };
				cancellation.cancel();
			}
			return itms;
		});
	}

	quickpick.busy = true;
	quickpick.show();

	const getValidateGitReference = getValidateGitReferenceFn(Container.instance.git.getRepository(repoPath), {
		revs: { allow: allowRevs ?? false, buttons: [RevealInSideBarQuickInputButton] },
		ranges: { allow: allowRanges ?? false, validate: true },
	});

	quickpick.items = await items;
	if (options?.picked != null) {
		const picked = quickpick.items.find(i => !isDirectiveQuickPickItem(i) && i.ref === options.picked);
		if (picked != null) {
			quickpick.activeItems = [picked];
		}
	}
	quickpick.busy = false;

	try {
		const pick = await new Promise<QuickPickResult<GitReference>>(resolve => {
			disposables.push(
				cancellation.token.onCancellationRequested(() => quickpick.hide()),
				quickpick.onDidHide(() => resolve({ value: undefined })),
				quickpick.onDidAccept(() => {
					if (!quickpick.activeItems.length) return;

					const [item] = quickpick.activeItems;
					if (isDirectiveQuickPickItem(item)) {
						if (item.directive === Directive.Noop) return;

						resolve({ directive: item.directive });
					} else {
						resolve({ value: item?.item });
					}
				}),
				quickpick.onDidChangeValue(async e => {
					if (scope != null) {
						// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
						if (e.length !== 0) {
							void scope.pause(['left', 'ctrl+left', 'right', 'ctrl+right']);
						} else {
							void scope.resume();
						}
					}

					if (options?.allowedAdditionalInput) {
						if (!(await getValidateGitReference(quickpick, e))) {
							quickpick.items = await items;
						}
					}
				}),
				quickpick.onDidTriggerItemButton(({ button, item }) => {
					if (isDirectiveQuickPickItem(item)) return;

					if (button === RevealInSideBarQuickInputButton) {
						if (isBranchReference(item.item)) {
							void revealBranch(item.item, { select: true, expand: true });
						} else if (isTagReference(item.item)) {
							void revealTag(item.item, { select: true, expand: true });
						} else if (isRevisionReference(item.item)) {
							void showCommitInDetailsView(item.item, { pin: false, preserveFocus: true });
						}
					}
				}),
				quickpick.onDidTriggerButton(button => {
					if (button === QuickInputButtons.Back) {
						resolve({ directive: Directive.Back });
					}
				}),
			);
		});
		if (pick?.directive != null) return pick;

		return pick?.value == null && autopick != null ? autopick : pick;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}

async function getItems(
	repoPath: string,
	options?: ReferencesQuickPickOptions2,
): Promise<(ReferencesQuickPickItem | DirectiveQuickPickItem)[]> {
	const include = options?.include ?? ['branches', 'tags'];

	const includes: ('branches' | 'tags')[] = [];
	if (include.includes('branches')) {
		includes.push('branches');
	}
	if (include.includes('tags')) {
		includes.push('tags');
	}

	const items: (ReferencesQuickPickItem | DirectiveQuickPickItem)[] = await getBranchesAndOrTags(
		Container.instance.git.getRepository(repoPath),
		includes,
		{
			buttons: [RevealInSideBarQuickInputButton],
			filter: options?.filter,
			picked: options?.picked,
			sort: options?.sort ?? { branches: { current: false }, tags: {} },
		},
	);

	// Move the picked item to the top
	const picked = options?.picked;
	if (picked) {
		const index = items.findIndex(i => !isDirectiveQuickPickItem(i) && i.ref === picked);
		if (index !== -1) {
			items.unshift(...items.splice(index, 1));
		}
	}

	if (include.includes('HEAD')) {
		items.unshift(createRefQuickPickItem('HEAD', repoPath, undefined, { icon: true }));
	}

	if (include.includes('workingTree')) {
		items.unshift(createRefQuickPickItem('', repoPath, undefined, { icon: true }));
	}

	if (include.includes('allBranches')) {
		items.unshift(createQuickPickSeparator());
		items.unshift(createDirectiveQuickPickItem(Directive.RefsAllBranches));
	}

	return options?.exclude?.length
		? items.filter(i => (isDirectiveQuickPickItem(i) ? true : !options.exclude?.includes(i.ref)))
		: items;
}

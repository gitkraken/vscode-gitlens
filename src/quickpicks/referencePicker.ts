import type { Disposable } from 'vscode';
import { CancellationTokenSource, QuickInputButtons, window } from 'vscode';
import { RevealInSideBarQuickInputButton } from '../commands/quickCommand.buttons';
import { getBranchesAndOrTags, getValidateGitReferenceFn } from '../commands/quickCommand.steps';
import type { Keys } from '../constants';
import { Container } from '../container';
import { reveal as revealBranch } from '../git/actions/branch';
import { showDetailsView } from '../git/actions/commit';
import { reveal as revealTag } from '../git/actions/tag';
import type { GitBranch } from '../git/models/branch';
import type { GitReference } from '../git/models/reference';
import type { GitTag } from '../git/models/tag';
import type { BranchSortOptions, TagSortOptions } from '../git/utils/-webview/sorting';
import { isBranchReference, isRevisionReference, isTagReference } from '../git/utils/reference.utils';
import type { KeyboardScope } from '../system/-webview/keyboard';
import { getQuickPickIgnoreFocusOut } from '../system/-webview/vscode';
import type { QuickPickResult } from './items/common';
import { Directive } from './items/directive';
import type { BranchQuickPickItem, RefQuickPickItem, TagQuickPickItem } from './items/gitWizard';
import { createRefQuickPickItem } from './items/gitWizard';

export type ReferencesQuickPickItem = BranchQuickPickItem | TagQuickPickItem | RefQuickPickItem;

export const enum ReferencesQuickPickIncludes {
	Branches = 1 << 0,
	Tags = 1 << 1,
	WorkingTree = 1 << 2,
	HEAD = 1 << 3,

	BranchesAndTags = Branches | Tags,
	All = Branches | Tags | WorkingTree | HEAD,
}

export interface ReferencesQuickPickOptions {
	allowRevisions?: boolean | { ranges?: boolean };
	autoPick?: boolean;
	picked?: string;
	exclude?: string[];
	filter?: { branches?(b: GitBranch): boolean; tags?(t: GitTag): boolean };
	include?: ReferencesQuickPickIncludes;
	ignoreFocusOut?: boolean;
	keyboard?: {
		keys: Keys[];
		onDidPressKey(key: Keys, item: ReferencesQuickPickItem): void | Promise<void>;
	};
	sort?: boolean | { branches?: BranchSortOptions; tags?: TagSortOptions };
}

export interface ReferencesQuickPickOptions2 extends ReferencesQuickPickOptions {
	allowBack?: boolean;
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
	const quickpick = window.createQuickPick<ReferencesQuickPickItem>();
	quickpick.ignoreFocusOut = options?.ignoreFocusOut ?? getQuickPickIgnoreFocusOut();

	quickpick.title = title;
	quickpick.placeholder =
		options?.allowRevisions != null && options.allowRevisions !== false
			? `${placeholder} (or enter a revision using #)`
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
								if (item != null) {
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
			if (itms.length <= 1) {
				autopick = { value: itms[0]?.item };
				cancellation.cancel();
			}
			return itms;
		});
	}

	quickpick.busy = true;
	quickpick.show();

	const getValidateGitReference = getValidateGitReferenceFn(Container.instance.git.getRepository(repoPath), {
		buttons: [RevealInSideBarQuickInputButton],
		ranges:
			options?.allowRevisions && typeof options.allowRevisions !== 'boolean'
				? options.allowRevisions.ranges
				: undefined,
	});

	quickpick.items = await items;
	if (options?.picked != null) {
		const picked = quickpick.items.find(i => i.ref === options.picked);
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
					if (quickpick.activeItems.length === 0) return;

					resolve({ value: quickpick.activeItems[0]?.item });
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

					if (options?.allowRevisions) {
						if (!(await getValidateGitReference(quickpick, e))) {
							quickpick.items = await items;
						}
					}
				}),
				quickpick.onDidTriggerItemButton(({ button, item: { item } }) => {
					if (button === RevealInSideBarQuickInputButton) {
						if (isBranchReference(item)) {
							void revealBranch(item, { select: true, expand: true });
						} else if (isTagReference(item)) {
							void revealTag(item, { select: true, expand: true });
						} else if (isRevisionReference(item)) {
							void showDetailsView(item, {
								pin: false,
								preserveFocus: true,
							});
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

async function getItems(repoPath: string, options?: ReferencesQuickPickOptions): Promise<ReferencesQuickPickItem[]> {
	const include = options?.include ?? ReferencesQuickPickIncludes.BranchesAndTags;

	const items: ReferencesQuickPickItem[] = await getBranchesAndOrTags(
		Container.instance.git.getRepository(repoPath),
		include && ReferencesQuickPickIncludes.BranchesAndTags
			? ['branches', 'tags']
			: include && ReferencesQuickPickIncludes.Branches
			  ? ['branches']
			  : include && ReferencesQuickPickIncludes.Tags
			    ? ['tags']
			    : [],
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
		const index = items.findIndex(i => i.ref === picked);
		if (index !== -1) {
			items.unshift(...items.splice(index, 1));
		}
	}

	if (include & ReferencesQuickPickIncludes.HEAD) {
		items.unshift(createRefQuickPickItem('HEAD', repoPath, undefined, { icon: true }));
	}

	if (include & ReferencesQuickPickIncludes.WorkingTree) {
		items.unshift(createRefQuickPickItem('', repoPath, undefined, { icon: true }));
	}

	return options?.exclude?.length ? items.filter(i => !options.exclude?.includes(i.ref)) : items;
}

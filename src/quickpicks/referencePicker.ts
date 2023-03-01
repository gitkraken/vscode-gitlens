import type { Disposable, QuickPick } from 'vscode';
import { CancellationTokenSource, window } from 'vscode';
import {
	getBranchesAndOrTags,
	getValidateGitReferenceFn,
	RevealInSideBarQuickInputButton,
} from '../commands/quickCommand';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { reveal as revealBranch } from '../git/actions/branch';
import { showDetailsView } from '../git/actions/commit';
import { reveal as revealTag } from '../git/actions/tag';
import type { BranchSortOptions, GitBranch } from '../git/models/branch';
import type { GitReference } from '../git/models/reference';
import { isBranchReference, isRevisionReference, isTagReference } from '../git/models/reference';
import type { GitTag, TagSortOptions } from '../git/models/tag';
import type { KeyboardScope, Keys } from '../system/keyboard';
import { getQuickPickIgnoreFocusOut } from '../system/utils';
import type { BranchQuickPickItem, RefQuickPickItem, TagQuickPickItem } from './items/gitCommands';
import { createRefQuickPickItem } from './items/gitCommands';

export type ReferencesQuickPickItem = BranchQuickPickItem | TagQuickPickItem | RefQuickPickItem;

export const enum ReferencesQuickPickIncludes {
	Branches = 1 << 0,
	Tags = 1 << 1,
	WorkingTree = 1 << 2,
	HEAD = 1 << 3,

	// eslint-disable-next-line @typescript-eslint/prefer-literal-enum-member
	BranchesAndTags = Branches | Tags,
}

export interface ReferencesQuickPickOptions {
	allowEnteringRefs?: boolean | { ranges?: boolean };
	autoPick?: boolean;
	picked?: string;
	filter?: { branches?(b: GitBranch): boolean; tags?(t: GitTag): boolean };
	include?: ReferencesQuickPickIncludes;
	keys?: Keys[];
	onDidPressKey?(key: Keys, quickpick: QuickPick<ReferencesQuickPickItem>): void | Promise<void>;
	sort?: boolean | { branches?: BranchSortOptions; tags?: TagSortOptions };
}

export async function showReferencePicker(
	repoPath: string,
	title: string,
	placeHolder: string,
	options: ReferencesQuickPickOptions = {},
): Promise<GitReference | undefined> {
	const quickpick = window.createQuickPick<ReferencesQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	quickpick.title = title;
	quickpick.placeholder =
		options.allowEnteringRefs != null
			? `${placeHolder}${GlyphChars.Space.repeat(3)}(or enter a reference using #)`
			: placeHolder;
	quickpick.matchOnDescription = true;

	const disposables: Disposable[] = [];

	let scope: KeyboardScope | undefined;
	if (options?.keys != null && options.keys.length !== 0 && options?.onDidPressKey !== null) {
		scope = Container.instance.keyboard.createScope(
			Object.fromEntries(
				options.keys.map(key => [
					key,
					{
						onDidPressKey: key => {
							if (quickpick.activeItems.length !== 0) {
								void options.onDidPressKey!(key, quickpick);
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

	let autoPick;
	let items = getItems(repoPath, options);
	if (options.autoPick) {
		items = items.then(itms => {
			if (itms.length <= 1) {
				autoPick = itms[0];
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
			options?.allowEnteringRefs && typeof options.allowEnteringRefs !== 'boolean'
				? options.allowEnteringRefs.ranges
				: undefined,
	});

	quickpick.items = await items;

	quickpick.busy = false;

	try {
		let pick = await new Promise<ReferencesQuickPickItem | undefined>(resolve => {
			disposables.push(
				cancellation.token.onCancellationRequested(() => quickpick.hide()),
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length === 0) return;

					resolve(quickpick.activeItems[0]);
				}),
				quickpick.onDidChangeValue(async e => {
					if (options.allowEnteringRefs) {
						if (!(await getValidateGitReference(quickpick, e))) {
							quickpick.items = await items;
						}
					}

					if (scope == null) return;

					// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
					if (e.length !== 0) {
						await scope.pause(['left', 'right']);
					} else {
						await scope.resume();
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
			);
		});
		if (pick == null && autoPick != null) {
			pick = autoPick;
		}
		if (pick == null) return undefined;

		return pick.item;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}

async function getItems(
	repoPath: string,
	{ picked, filter, include, sort }: ReferencesQuickPickOptions,
): Promise<ReferencesQuickPickItem[]> {
	include = include ?? ReferencesQuickPickIncludes.BranchesAndTags;

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
			filter: filter,
			picked: picked,
			sort: sort ?? { branches: { current: false }, tags: {} },
		},
	);

	// Move the picked item to the top
	if (picked) {
		const index = items.findIndex(i => i.ref === picked);
		if (index !== -1) {
			items.splice(0, 0, ...items.splice(index, 1));
		}
	}

	if (include & ReferencesQuickPickIncludes.HEAD) {
		items.splice(0, 0, createRefQuickPickItem('HEAD', repoPath, undefined, { icon: true }));
	}

	if (include & ReferencesQuickPickIncludes.WorkingTree) {
		items.splice(0, 0, createRefQuickPickItem('', repoPath, undefined, { icon: true }));
	}

	return items;
}

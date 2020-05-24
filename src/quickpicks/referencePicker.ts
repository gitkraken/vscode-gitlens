'use strict';
import { CancellationTokenSource, Disposable, QuickPick, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBranch, GitReference, GitTag } from '../git/git';
import { KeyboardScope, KeyCommand, Keys } from '../keyboard';
import { BranchQuickPickItem, getQuickPickIgnoreFocusOut, RefQuickPickItem, TagQuickPickItem } from '../quickpicks';
import { getBranchesAndOrTags, getValidateGitReferenceFn } from '../commands/quickCommand';

export type ReferencesQuickPickItem = BranchQuickPickItem | TagQuickPickItem | RefQuickPickItem;

export enum ReferencesQuickPickIncludes {
	Branches = 1,
	Tags = 2,
	WorkingTree = 4,
	HEAD = 8,

	BranchesAndTags = 3,
}

export interface ReferencesQuickPickOptions {
	allowEnteringRefs?: boolean;
	autoPick?: boolean;
	picked?: string;
	filterBranches?(branch: GitBranch): boolean;
	filterTags?(tag: GitTag): boolean;
	include?: ReferencesQuickPickIncludes;
	keys?: Keys[];
	onDidPressKey?(key: Keys, quickpick: QuickPick<ReferencesQuickPickItem>): void | Promise<void>;
}

export namespace ReferencePicker {
	export async function show(
		repoPath: string,
		title: string,
		placeHolder: string,
		options: ReferencesQuickPickOptions = {},
	): Promise<GitReference | undefined> {
		const quickpick = window.createQuickPick<ReferencesQuickPickItem>();
		quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

		quickpick.title = title;
		quickpick.placeholder = options.allowEnteringRefs
			? `${placeHolder}${GlyphChars.Space.repeat(3)}(or enter a reference using #)`
			: placeHolder;
		quickpick.matchOnDescription = true;

		const disposables: Disposable[] = [];

		let scope: KeyboardScope | undefined;
		if (options?.keys != null && options.keys.length !== 0 && options?.onDidPressKey !== null) {
			scope = Container.keyboard.createScope(
				Object.fromEntries(
					options.keys.map(key => [
						key,
						// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
						{
							onDidPressKey: key => {
								if (quickpick.activeItems.length !== 0) {
									void options.onDidPressKey!(key, quickpick);
								}
							},
						} as KeyCommand,
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
		quickpick.enabled = false;

		quickpick.show();

		const getValidateGitReference = getValidateGitReferenceFn((await Container.git.getRepository(repoPath))!);

		quickpick.items = await items;

		quickpick.busy = false;
		quickpick.enabled = true;

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
				);
			});
			if (pick == null && autoPick != null) {
				pick = autoPick;
			}
			if (pick == null) return undefined;

			return pick.item;
		} finally {
			quickpick.dispose();
			disposables.forEach(d => d.dispose());
		}
	}

	async function getItems(
		repoPath: string,
		{ picked, filterBranches, filterTags, include }: ReferencesQuickPickOptions,
	): Promise<ReferencesQuickPickItem[]> {
		include = include ?? ReferencesQuickPickIncludes.BranchesAndTags;

		const items: ReferencesQuickPickItem[] = await getBranchesAndOrTags(
			(await Container.git.getRepository(repoPath))!,
			include && ReferencesQuickPickIncludes.BranchesAndTags
				? ['branches', 'tags']
				: include && ReferencesQuickPickIncludes.Branches
				? ['branches']
				: include && ReferencesQuickPickIncludes.Tags
				? ['tags']
				: [],
			{
				filterBranches: filterBranches,
				filterTags: filterTags,
				picked: picked,
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
			items.splice(0, 0, RefQuickPickItem.create('HEAD', repoPath, undefined, { icon: true }));
		}

		if (include & ReferencesQuickPickIncludes.WorkingTree) {
			items.splice(0, 0, RefQuickPickItem.create('', repoPath, undefined, { icon: true }));
		}

		return items;
	}
}

'use strict';
import { CancellationToken, CancellationTokenSource, QuickPickItem, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBranch, GitTag } from '../git/gitService';
import { Promises } from '../system';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './commonQuickPicks';
import { BranchQuickPickItem, RefQuickPickItem, TagQuickPickItem } from './gitQuickPicks';

export type ReferencesQuickPickItem = BranchQuickPickItem | TagQuickPickItem | RefQuickPickItem;

export enum ReferencesQuickPickIncludes {
	Branches = 1,
	Tags = 2,
	WorkingTree = 4,

	BranchesAndTags = 3
}

export interface ReferencesQuickPickOptions {
	allowEnteringRefs?: boolean;
	autoPick?: boolean;
	checked?: string;
	checkmarks: boolean;
	filterBranches?(branch: GitBranch): boolean;
	filterTags?(tag: GitTag): boolean;
	goBack?: CommandQuickPickItem;
	include?: ReferencesQuickPickIncludes;
}

export class ReferencesQuickPick {
	constructor(public readonly repoPath: string | undefined) {}

	async show(
		placeHolder: string,
		options?: Exclude<ReferencesQuickPickOptions, CommandQuickPickItem> & {
			include: ReferencesQuickPickIncludes.Branches;
		}
	): Promise<BranchQuickPickItem | undefined>;
	async show(
		placeHolder: string,
		options?: Exclude<ReferencesQuickPickOptions, CommandQuickPickItem> & {
			include: ReferencesQuickPickIncludes.Tags;
		}
	): Promise<TagQuickPickItem | undefined>;
	async show(
		placeHolder: string,
		options?: Exclude<ReferencesQuickPickOptions, CommandQuickPickItem>
	): Promise<ReferencesQuickPickItem | undefined>;
	async show(
		placeHolder: string,
		options: ReferencesQuickPickOptions = { checkmarks: true }
	): Promise<ReferencesQuickPickItem | CommandQuickPickItem | undefined> {
		const cancellation = new CancellationTokenSource();

		let scope;
		if (options.goBack) {
			scope = await Container.keyboard.beginScope({ 'alt+left': options.goBack });
		}

		let autoPick;
		try {
			let items = this.getItems(options, cancellation.token);
			if (options.autoPick) {
				items = items.then(itms => {
					if (itms.length <= 1) {
						autoPick = itms[0];
						cancellation.cancel();
					}
					return itms;
				});
			}

			let pick;
			if (options.allowEnteringRefs) {
				placeHolder += `${GlyphChars.Space.repeat(3)}(select or enter a reference)`;

				const quickpick = window.createQuickPick<ReferencesQuickPickItem | CommandQuickPickItem>();
				quickpick.busy = true;
				quickpick.enabled = false;
				quickpick.placeholder = placeHolder;
				quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();
				quickpick.show();

				quickpick.items = await items;
				quickpick.busy = false;
				quickpick.enabled = true;

				pick = await new Promise<ReferencesQuickPickItem | CommandQuickPickItem | undefined>(resolve => {
					cancellation.token.onCancellationRequested(() => quickpick.hide());

					quickpick.onDidHide(() => resolve(undefined));
					quickpick.onDidAccept(async () => {
						if (quickpick.selectedItems.length === 0) {
							quickpick.busy = true;
							quickpick.enabled = false;

							const ref = quickpick.value;
							if (
								this.repoPath === undefined ||
								(await Container.git.validateReference(this.repoPath, ref))
							) {
								resolve(RefQuickPickItem.create(ref));
							} else {
								quickpick.title = 'You must enter a valid reference';
								quickpick.busy = false;
								quickpick.enabled = true;
								return;
							}
						} else {
							resolve(quickpick.selectedItems[0]);
						}

						quickpick.hide();
					});
				});

				quickpick.dispose();
			} else {
				pick = await window.showQuickPick(
					items,
					{
						placeHolder: placeHolder,
						ignoreFocusOut: getQuickPickIgnoreFocusOut()
					},
					cancellation.token
				);
			}

			if (pick === undefined && autoPick !== undefined) {
				pick = autoPick;
			}

			if (pick === undefined) {
				cancellation.cancel();
			}

			return pick;
		} finally {
			if (scope !== undefined) {
				await scope.dispose();
			}

			cancellation.dispose();
		}
	}

	private async getItems(
		{ checked, checkmarks, filterBranches, filterTags, goBack, include, ...options }: ReferencesQuickPickOptions,
		token: CancellationToken
	): Promise<(BranchQuickPickItem | TagQuickPickItem | CommandQuickPickItem)[]> {
		include = include || ReferencesQuickPickIncludes.BranchesAndTags;

		const results = await Promises.cancellable(
			Promise.all<GitBranch[] | undefined, GitTag[] | undefined>([
				include & ReferencesQuickPickIncludes.Branches
					? Container.git.getBranches(this.repoPath, {
							...options,
							filter: filterBranches && filterBranches
					  })
					: undefined,
				include & ReferencesQuickPickIncludes.Tags
					? Container.git.getTags(this.repoPath, {
							...options,
							filter: filterTags && filterTags,
							includeRefs: true
					  })
					: undefined
			]),
			token
		);
		if (results === undefined || token.isCancellationRequested) return [];

		const [branches, tags] = results;

		let items: (BranchQuickPickItem | TagQuickPickItem)[];
		if (branches !== undefined && tags !== undefined) {
			items = await Promise.all<BranchQuickPickItem | TagQuickPickItem>([
				...branches
					.filter(b => !b.remote)
					.map(b =>
						BranchQuickPickItem.create(b, checkmarks, {
							current: true,
							checked: b.name === checked,
							ref: true,
							status: true
						})
					),
				...tags.map(t =>
					TagQuickPickItem.create(t, checkmarks, { checked: t.name === checked, ref: true, type: true })
				),
				...branches
					.filter(b => b.remote)
					.map(b =>
						BranchQuickPickItem.create(b, checkmarks, { checked: b.name === checked, type: 'remote' })
					)
			]);
		} else if (branches !== undefined) {
			items = await Promise.all(
				branches.map(b =>
					BranchQuickPickItem.create(b, checkmarks, {
						current: true,
						checked: b.name === checked,
						ref: true,
						status: true,
						type: 'remote'
					})
				)
			);
		} else {
			items = tags!.map(t => TagQuickPickItem.create(t, checkmarks, { checked: t.name === checked, ref: true }));
		}

		// Move the checked item to the top
		if (checked) {
			const index = items.findIndex(i => i.ref === checked);
			if (index !== -1) {
				items.splice(0, 0, ...items.splice(index, 1));
			}
		}

		if (include & ReferencesQuickPickIncludes.WorkingTree) {
			(items as QuickPickItem[]).splice(0, 0, RefQuickPickItem.create('', undefined));
		}

		if (goBack !== undefined) {
			(items as QuickPickItem[]).splice(0, 0, goBack);
		}

		return items;
	}
}

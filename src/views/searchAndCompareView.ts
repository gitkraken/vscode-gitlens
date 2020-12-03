'use strict';
import { commands, ConfigurationChangeEvent, TreeItem, TreeItemCollapsibleState } from 'vscode';
import {
	BranchSorting,
	configuration,
	SearchAndCompareViewConfig,
	TagSorting,
	ViewFilesLayout,
} from '../configuration';
import { ContextKeys, NamedRef, PinnedItem, PinnedItems, setContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { GitLog, GitRevision, SearchPattern } from '../git/git';
import { CompareResultsNode, ContextValues, SearchResultsNode, unknownGitUri, ViewNode } from './nodes';
import { debug, gate, Iterables, log, Promises } from '../system';
import { ViewBase } from './viewBase';
import { ComparePickerNode } from './nodes/comparePickerNode';
import { ReferencePicker, ReferencesQuickPickIncludes } from '../quickpicks';
import { getRepoPathOrPrompt } from '../commands';

interface DeprecatedPinnedComparison {
	path: string;
	ref1: NamedRef;
	ref2: NamedRef;
	notation?: '..' | '...';
}

interface DeprecatedPinnedComparisons {
	[id: string]: DeprecatedPinnedComparison;
}

export class SearchAndCompareViewNode extends ViewNode<SearchAndCompareView> {
	protected splatted = true;
	private comparePicker: ComparePickerNode | undefined;

	constructor(view: SearchAndCompareView) {
		super(unknownGitUri, view);
	}

	private _children: (ComparePickerNode | CompareResultsNode | SearchResultsNode)[] | undefined;
	private get children(): (ComparePickerNode | CompareResultsNode | SearchResultsNode)[] {
		if (this._children == null) {
			this._children = [];

			// Get pinned searches & comparisons
			const pinned = this.view.getPinned();
			if (pinned.length !== 0) {
				this._children.push(...pinned);
			}
		}

		return this._children;
	}

	getChildren(): ViewNode[] {
		if (this.children.length === 0) return [];

		this.view.message = undefined;

		return this.children.sort((a, b) => (a.pinned ? -1 : 1) - (b.pinned ? -1 : 1) || b.order - a.order);
	}

	getTreeItem(): TreeItem {
		this.splatted = false;

		const item = new TreeItem('SearchAndCompare', TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.SearchAndCompare;
		return item;
	}

	addOrReplace(results: CompareResultsNode | SearchResultsNode, replace: boolean) {
		if (this.children.includes(results)) return;

		if (replace) {
			this.clear();
		}

		this.children.push(results);

		this.view.triggerNodeChange();
	}

	@log()
	clear(silent: boolean = false) {
		if (this.children.length === 0) return;

		this.removeComparePicker(true);
		const index = this._children!.findIndex(c => !c.pinned);
		if (index !== -1) {
			this._children!.splice(index, this._children!.length);
		}

		if (!silent) {
			this.view.triggerNodeChange();
		}
	}

	@log({
		args: { 0: (n: ViewNode) => n.toString() },
	})
	dismiss(node: ComparePickerNode | CompareResultsNode | SearchResultsNode) {
		if (node === this.comparePicker) {
			this.removeComparePicker();

			return;
		}

		if (this.children.length === 0) return;

		const index = this.children.indexOf(node);
		if (index === -1) return;

		this.children.splice(index, 1);

		this.view.triggerNodeChange();
	}

	@gate()
	@debug()
	async refresh() {
		if (this.children.length === 0) return;

		const promises: Promise<any>[] = [
			...Iterables.filterMap(this.children, c => {
				const result = c.refresh === undefined ? false : c.refresh();
				return Promises.is<boolean | void>(result) ? result : undefined;
			}),
		];
		await Promise.all(promises);
	}

	async compareWithSelected(repoPath?: string, ref?: string | NamedRef) {
		const selectedRef = this.comparePicker?.selectedRef;
		if (selectedRef == null) return;

		if (repoPath == null) {
			repoPath = selectedRef.repoPath;
		} else if (repoPath !== selectedRef.repoPath) {
			// If we don't have a matching repoPath, then start over
			void this.selectForCompare(repoPath, ref);

			return;
		}

		if (ref == null) {
			const pick = await ReferencePicker.show(
				repoPath,
				`Compare ${this.getRefName(selectedRef.ref)} with`,
				'Choose a reference to compare with',
				{
					allowEnteringRefs: true,
					picked: typeof selectedRef.ref === 'string' ? selectedRef.ref : selectedRef.ref.ref,
					// checkmarks: true,
					include:
						ReferencesQuickPickIncludes.BranchesAndTags |
						ReferencesQuickPickIncludes.HEAD |
						ReferencesQuickPickIncludes.WorkingTree,
					sort: {
						branches: { current: true, orderBy: BranchSorting.DateDesc },
						tags: { orderBy: TagSorting.DateDesc },
					},
				},
			);
			if (pick == null) {
				if (this.comparePicker != null) {
					await this.view.show();
					await this.view.reveal(this.comparePicker, { focus: true, select: true });
				}

				return;
			}

			ref = pick.ref;
		}

		this.removeComparePicker();
		void (await this.view.compare(repoPath, selectedRef.ref, ref));
	}

	async selectForCompare(repoPath?: string, ref?: string | NamedRef, options?: { prompt?: boolean }) {
		if (repoPath == null) {
			repoPath = await getRepoPathOrPrompt('Compare');
		}
		if (repoPath == null) return;

		this.removeComparePicker(true);

		let prompt = options?.prompt ?? false;
		let ref2;
		if (ref == null) {
			const pick = await ReferencePicker.show(repoPath, 'Compare', 'Choose a reference to compare', {
				allowEnteringRefs: { ranges: true },
				// checkmarks: false,
				include:
					ReferencesQuickPickIncludes.BranchesAndTags |
					ReferencesQuickPickIncludes.HEAD |
					ReferencesQuickPickIncludes.WorkingTree,
				sort: {
					branches: { current: true, orderBy: BranchSorting.DateDesc },
					tags: { orderBy: TagSorting.DateDesc },
				},
			});
			if (pick == null) {
				await this.triggerChange();

				return;
			}

			ref = pick.ref;

			if (GitRevision.isRange(ref)) {
				const range = GitRevision.splitRange(ref);
				if (range != null) {
					ref = range.ref1 || 'HEAD';
					ref2 = range.ref2 || 'HEAD';
				}
			}

			prompt = true;
		}

		this.comparePicker = new ComparePickerNode(this.view, this, {
			label: this.getRefName(ref),
			repoPath: repoPath,
			ref: ref,
		});
		this.children.splice(0, 0, this.comparePicker);
		void setContext(ContextKeys.ViewsCanCompare, true);

		await this.triggerChange();

		await this.view.reveal(this.comparePicker, { focus: false, select: true });

		if (prompt) {
			await this.compareWithSelected(repoPath, ref2);
		}
	}

	private getRefName(ref: string | NamedRef) {
		return typeof ref === 'string'
			? GitRevision.shorten(ref, { strings: { working: 'Working Tree' } })!
			: ref.label ?? GitRevision.shorten(ref.ref)!;
	}

	private removeComparePicker(silent: boolean = false) {
		void setContext(ContextKeys.ViewsCanCompare, false);
		if (this.comparePicker != null) {
			const index = this.children.indexOf(this.comparePicker);
			if (index !== -1) {
				this.children.splice(index, 1);
				if (!silent) {
					void this.triggerChange();
				}
			}
			this.comparePicker = undefined;
		}
	}
}

export class SearchAndCompareView extends ViewBase<SearchAndCompareViewNode, SearchAndCompareViewConfig> {
	protected readonly configKey = 'searchAndCompare';

	constructor() {
		super('gitlens.views.searchAndCompare', 'Search & Compare');

		void setContext(ContextKeys.ViewsSearchAndCompareKeepResults, this.keepResults);
	}

	getRoot() {
		return new SearchAndCompareViewNode(this);
	}

	protected registerCommands() {
		void Container.viewCommands;

		commands.registerCommand(this.getQualifiedCommand('clear'), () => this.clear(), this);
		commands.registerCommand(
			this.getQualifiedCommand('copy'),
			() => commands.executeCommand('gitlens.views.copy', this.selection),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToAuto'),
			() => this.setFilesLayout(ViewFilesLayout.Auto),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToList'),
			() => this.setFilesLayout(ViewFilesLayout.List),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToTree'),
			() => this.setFilesLayout(ViewFilesLayout.Tree),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('setKeepResultsToOn'), () => this.setKeepResults(true), this);
		commands.registerCommand(
			this.getQualifiedCommand('setKeepResultsToOff'),
			() => this.setKeepResults(false),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this);
		commands.registerCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this);

		commands.registerCommand(this.getQualifiedCommand('pin'), this.pin, this);
		commands.registerCommand(this.getQualifiedCommand('unpin'), this.unpin, this);
		commands.registerCommand(this.getQualifiedCommand('edit'), this.edit, this);
		commands.registerCommand(this.getQualifiedCommand('swapComparison'), this.swapComparison, this);
		commands.registerCommand(this.getQualifiedCommand('selectForCompare'), this.selectForCompare, this);
		commands.registerCommand(this.getQualifiedCommand('compareWithSelected'), this.compareWithSelected, this);
	}

	protected filterConfigurationChanged(e: ConfigurationChangeEvent) {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle')
		) {
			return false;
		}

		return true;
	}

	get keepResults(): boolean {
		return Container.context.workspaceState.get<boolean>(WorkspaceState.ViewsSearchAndCompareKeepResults, true);
	}

	clear() {
		this.root?.clear();
	}

	dismissNode(node: ViewNode) {
		if (
			this.root == null ||
			(!(node instanceof ComparePickerNode) &&
				!(node instanceof CompareResultsNode) &&
				!(node instanceof SearchResultsNode)) ||
			!node.canDismiss
		) {
			return;
		}

		this.root.dismiss(node);
	}

	compare(repoPath: string, ref1: string | NamedRef, ref2: string | NamedRef) {
		return this.addResults(
			new CompareResultsNode(
				this,
				this.ensureRoot(),
				repoPath,
				typeof ref1 === 'string' ? { ref: ref1 } : ref1,
				typeof ref2 === 'string' ? { ref: ref2 } : ref2,
			),
		);
	}

	compareWithSelected(repoPath?: string, ref?: string | NamedRef) {
		void this.ensureRoot().compareWithSelected(repoPath, ref);
	}

	selectForCompare(repoPath?: string, ref?: string | NamedRef, options?: { prompt?: boolean }) {
		void this.ensureRoot().selectForCompare(repoPath, ref, options);
	}

	async search(
		repoPath: string,
		search: SearchPattern,
		{
			label,
			reveal,
		}: {
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
			reveal?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			};
		},
		results?: Promise<GitLog | undefined> | GitLog,
		updateNode?: SearchResultsNode,
	) {
		if (!this.visible) {
			await this.show();
		}

		const labels = { label: `Results ${typeof label === 'string' ? label : label.label}`, queryLabel: label };
		if (updateNode != null) {
			await updateNode.edit({ pattern: search, labels: labels, log: results });

			return;
		}

		await this.addResults(new SearchResultsNode(this, this.root!, repoPath, search, labels, results), reveal);
	}

	getPinned() {
		let savedPins = Container.context.workspaceState.get<PinnedItems>(
			WorkspaceState.ViewsSearchAndComparePinnedItems,
		);
		if (savedPins == null) {
			// Migrate any deprecated pinned items
			const deprecatedPins = Container.context.workspaceState.get<DeprecatedPinnedComparisons>(
				WorkspaceState.Deprecated_PinnedComparisons,
			);
			if (deprecatedPins == null) return [];

			savedPins = Object.create(null) as PinnedItems;
			for (const p of Object.values(deprecatedPins)) {
				savedPins[CompareResultsNode.getPinnableId(p.path, p.ref1.ref, p.ref2.ref)] = {
					type: 'comparison',
					timestamp: Date.now(),
					path: p.path,
					ref1: p.ref1,
					ref2: p.ref2,
				};
			}

			void Container.context.workspaceState.update(WorkspaceState.ViewsSearchAndComparePinnedItems, savedPins);
			void Container.context.workspaceState.update(WorkspaceState.Deprecated_PinnedComparisons, undefined);
		}

		const root = this.ensureRoot();
		return Object.values(savedPins)
			.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
			.map(p =>
				p.type === 'comparison'
					? new CompareResultsNode(this, root, p.path, p.ref1, p.ref2, p.timestamp)
					: new SearchResultsNode(this, root, p.path, p.search, p.labels, undefined, p.timestamp),
			);
	}

	async updatePinned(id: string, pin?: PinnedItem) {
		let pinned = Container.context.workspaceState.get<PinnedItems>(WorkspaceState.ViewsSearchAndComparePinnedItems);
		if (pinned == null) {
			pinned = Object.create(null) as PinnedItems;
		}

		if (pin != null) {
			pinned[id] = { ...pin };
		} else {
			const { [id]: _, ...rest } = pinned;
			pinned = rest;
		}

		await Container.context.workspaceState.update(WorkspaceState.ViewsSearchAndComparePinnedItems, pinned);

		this.triggerNodeChange(this.ensureRoot());
	}

	private async addResults(
		results: CompareResultsNode | SearchResultsNode,
		options: {
			expand?: boolean | number;
			focus?: boolean;
			select?: boolean;
		} = { expand: true, focus: true, select: true },
	) {
		if (!this.visible) {
			await this.show();
		}

		const root = this.ensureRoot();
		root.addOrReplace(results, !this.keepResults);

		setImmediate(() => this.reveal(results, options));
	}

	private edit(node: SearchResultsNode) {
		if (!(node instanceof SearchResultsNode)) return undefined;

		return node.edit();
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective('views', this.configKey, 'files', 'layout', layout);
	}

	private setKeepResults(enabled: boolean) {
		void Container.context.workspaceState.update(WorkspaceState.ViewsSearchAndCompareKeepResults, enabled);
		void setContext(ContextKeys.ViewsSearchAndCompareKeepResults, enabled);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective('views', this.configKey, 'avatars', enabled);
	}

	private pin(node: CompareResultsNode | SearchResultsNode) {
		if (!(node instanceof CompareResultsNode) && !(node instanceof SearchResultsNode)) return undefined;

		return node.pin();
	}

	private swapComparison(node: CompareResultsNode) {
		if (!(node instanceof CompareResultsNode)) return undefined;

		return node.swap();
	}

	private unpin(node: CompareResultsNode | SearchResultsNode) {
		if (!(node instanceof CompareResultsNode) && !(node instanceof SearchResultsNode)) return undefined;

		return node.unpin();
	}
}

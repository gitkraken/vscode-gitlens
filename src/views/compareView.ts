'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { CompareViewConfig, configuration, ViewFilesLayout, ViewsConfig } from '../configuration';
import {
	CommandContext,
	NamedRef,
	PinnedComparison,
	PinnedComparisons,
	setCommandContext,
	WorkspaceState,
} from '../constants';
import { Container } from '../container';
import { CompareNode, CompareResultsNode, nodeSupportsConditionalDismissal, ViewNode } from './nodes';
import { ViewBase } from './viewBase';

export class CompareView extends ViewBase<CompareNode> {
	constructor() {
		super('gitlens.views.compare', 'Compare');

		setCommandContext(CommandContext.ViewsCompareKeepResults, this.keepResults);
	}

	getRoot() {
		return new CompareNode(this);
	}

	protected get location(): string {
		return this.config.location;
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
		commands.registerCommand(this.getQualifiedCommand('pinComparison'), this.pinComparison, this);
		commands.registerCommand(this.getQualifiedCommand('unpinComparison'), this.unpinComparison, this);
		commands.registerCommand(this.getQualifiedCommand('swapComparison'), this.swapComparison, this);
		commands.registerCommand(this.getQualifiedCommand('selectForCompare'), this.selectForCompare, this);
		commands.registerCommand(this.getQualifiedCommand('compareWithSelected'), this.compareWithSelected, this);
	}

	protected onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			!configuration.changed(e, 'views', 'compare') &&
			!configuration.changed(e, 'views', 'commitFileDescriptionFormat') &&
			!configuration.changed(e, 'views', 'commitFileFormat') &&
			!configuration.changed(e, 'views', 'commitDescriptionFormat') &&
			!configuration.changed(e, 'views', 'commitFormat') &&
			!configuration.changed(e, 'views', 'defaultItemLimit') &&
			!configuration.changed(e, 'views', 'pageItemLimit') &&
			!configuration.changed(e, 'views', 'showRelativeDateMarkers') &&
			!configuration.changed(e, 'views', 'statusFileDescriptionFormat') &&
			!configuration.changed(e, 'views', 'statusFileFormat') &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle')
		) {
			return;
		}

		if (configuration.changed(e, 'views', 'compare', 'location')) {
			this.initialize(this.config.location, { showCollapseAll: true });
		}

		if (!configuration.initializing(e) && this._root !== undefined) {
			void this.refresh(true);
		}
	}

	get config(): ViewsConfig & CompareViewConfig {
		return { ...Container.config.views, ...Container.config.views.compare };
	}

	get keepResults(): boolean {
		return Container.context.workspaceState.get<boolean>(WorkspaceState.ViewsCompareKeepResults, false);
	}

	clear() {
		if (this._root === undefined) return;

		this._root.clear();
	}

	dismissNode(node: ViewNode) {
		if (this._root === undefined) return;
		if (nodeSupportsConditionalDismissal(node) && node.canDismiss() === false) return;

		this._root.dismiss(node);
	}

	compare(repoPath: string, ref1: string | NamedRef, ref2: string | NamedRef) {
		return this.addResults(
			new CompareResultsNode(
				this,
				repoPath,
				typeof ref1 === 'string' ? { ref: ref1 } : ref1,
				typeof ref2 === 'string' ? { ref: ref2 } : ref2,
			),
		);
	}

	compareWithSelected(repoPath?: string, ref?: string | NamedRef) {
		const root = this.ensureRoot();
		void root.compareWithSelected(repoPath, ref);
	}

	selectForCompare(repoPath?: string, ref?: string | NamedRef) {
		const root = this.ensureRoot();
		void root.selectForCompare(repoPath, ref);
	}

	getPinnedComparisons() {
		const pinned = Container.context.workspaceState.get<PinnedComparisons>(WorkspaceState.PinnedComparisons);
		if (pinned == null) return [];

		return Object.values(pinned).map(p => new CompareResultsNode(this, p.path, p.ref1, p.ref2, true, p.notation));
	}

	async updatePinnedComparison(id: string, pin?: PinnedComparison) {
		let pinned = Container.context.workspaceState.get<PinnedComparisons>(WorkspaceState.PinnedComparisons);
		if (pinned == null) {
			pinned = Object.create(null);
		}

		if (pin !== undefined) {
			pinned![id] = { ...pin };
		} else {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { [id]: _, ...rest } = pinned!;
			pinned = rest;
		}

		await Container.context.workspaceState.update(WorkspaceState.PinnedComparisons, pinned);
	}

	private async addResults(results: ViewNode) {
		if (!this.visible) {
			await this.show();
		}

		const root = this.ensureRoot();
		root.addOrReplace(results, !this.keepResults);

		setImmediate(() => this.reveal(results, { expand: true, focus: true, select: true }));
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective('views', 'compare', 'files', 'layout', layout);
	}

	private setKeepResults(enabled: boolean) {
		Container.context.workspaceState.update(WorkspaceState.ViewsCompareKeepResults, enabled);
		setCommandContext(CommandContext.ViewsCompareKeepResults, enabled);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective('views', 'compare', 'avatars', enabled);
	}

	private pinComparison(node: ViewNode) {
		if (!(node instanceof CompareResultsNode)) return undefined;

		return node.pin();
	}

	private swapComparison(node: ViewNode) {
		if (!(node instanceof CompareResultsNode)) return undefined;

		return node.swap();
	}

	private unpinComparison(node: ViewNode) {
		if (!(node instanceof CompareResultsNode)) return undefined;

		return node.unpin();
	}
}

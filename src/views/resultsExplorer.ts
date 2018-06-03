'use strict';
import { Functions, Strings } from '../system';
import { commands, ConfigurationChangeEvent, ConfigurationTarget, Disposable, Event, EventEmitter, TreeDataProvider, TreeItem, TreeView, window } from 'vscode';
import { configuration, ExplorerFilesLayout, IExplorersConfig, IResultsExplorerConfig } from '../configuration';
import { CommandContext, GlyphChars, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { RefreshNodeCommandArgs } from './explorerCommands';
import { CommitResultsNode, CommitsResultsNode, ComparisonResultsNode, ExplorerNode, MessageNode, NamedRef, RefreshReason, ResourceType } from './explorerNodes';
import { GitLog, GitLogCommit } from '../gitService';
import { Logger } from '../logger';
// import { Messages } from '../messages';

export * from './explorerNodes';

export class ResultsExplorer extends Disposable implements TreeDataProvider<ExplorerNode> {

    private _disposable: Disposable | undefined;
    private _roots: ExplorerNode[] = [];
    private _tree: TreeView<ExplorerNode> | undefined;

    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    constructor() {
        super(() => this.dispose());

        Container.explorerCommands;
        commands.registerCommand('gitlens.resultsExplorer.refresh', this.refreshNodes, this);
        commands.registerCommand('gitlens.resultsExplorer.refreshNode', this.refreshNode, this);
        commands.registerCommand('gitlens.resultsExplorer.setFilesLayoutToAuto', () => this.setFilesLayout(ExplorerFilesLayout.Auto), this);
        commands.registerCommand('gitlens.resultsExplorer.setFilesLayoutToList', () => this.setFilesLayout(ExplorerFilesLayout.List), this);
        commands.registerCommand('gitlens.resultsExplorer.setFilesLayoutToTree', () => this.setFilesLayout(ExplorerFilesLayout.Tree), this);

        commands.registerCommand('gitlens.resultsExplorer.clearResultsNode', this.clearResultsNode, this);
        commands.registerCommand('gitlens.resultsExplorer.close', this.close, this);
        commands.registerCommand('gitlens.resultsExplorer.setKeepResultsToOn', () => this.setKeepResults(true), this);
        commands.registerCommand('gitlens.resultsExplorer.setKeepResultsToOff', () => this.setKeepResults(false), this);
        commands.registerCommand('gitlens.resultsExplorer.swapComparision', this.swapComparision, this);

        setCommandContext(CommandContext.ResultsExplorerKeepResults, this.keepResults);

        Container.context.subscriptions.push(
            configuration.onDidChange(this.onConfigurationChanged, this)
        );
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    private async onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        if (!initializing &&
            !configuration.changed(e, configuration.name('resultsExplorer').value) &&
            !configuration.changed(e, configuration.name('explorers').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value)) return;

        if (!initializing && configuration.changed(e, configuration.name('resultsExplorer')('location').value) && this.enabled) {
            setCommandContext(CommandContext.ResultsExplorer, this.config.location);
        }

        if (!initializing && this._roots.length !== 0) {
            this.refresh(RefreshReason.ConfigurationChanged);
        }

        if (initializing) {
            this._tree = window.createTreeView('gitlens.resultsExplorer', { treeDataProvider: this });
            this._disposable = this._tree;
        }
    }

    get config(): IExplorersConfig & IResultsExplorerConfig {
        return { ...Container.config.explorers, ...Container.config.resultsExplorer };
    }

    private _enabled: boolean = false;
    get enabled(): boolean {
        return this._enabled;
    }

    get keepResults(): boolean {
        return Container.context.workspaceState.get<boolean>(WorkspaceState.ResultsExplorerKeepResults, false);
    }

    close() {
        this.clearResults();

        this._enabled = false;
        setCommandContext(CommandContext.ResultsExplorer, false);
    }

    getParent(element: ExplorerNode): ExplorerNode | undefined {
        return undefined;
    }

    async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
        if (this._roots.length === 0) return [new MessageNode('No results')];

        if (node === undefined) return this._roots;
        return node.getChildren();
    }

    async getTreeItem(node: ExplorerNode): Promise<TreeItem> {
        return node.getTreeItem();
    }

    getQualifiedCommand(command: string) {
        return `gitlens.resultsExplorer.${command}`;
    }

    async refresh(reason?: RefreshReason) {
        if (reason === undefined) {
            reason = RefreshReason.Command;
        }

        Logger.log(`ResultsExplorer.refresh`, `reason='${reason}'`);

        this._onDidChangeTreeData.fire();
    }

    refreshNode(node: ExplorerNode, args?: RefreshNodeCommandArgs) {
        Logger.log(`ResultsExplorer.refreshNode(${(node as { id?: string}).id || ''})`);

        if (args !== undefined && node.supportsPaging) {
            node.maxCount = args.maxCount;
        }
        node.refresh();

        // Since a root node won't actually refresh, force everything
        this._onDidChangeTreeData.fire(this._roots.includes(node) ? undefined : node);
    }

    refreshNodes() {
        Logger.log(`ResultsExplorer.refreshNodes`);

        this._roots.forEach(n => n.refresh());

        this._onDidChangeTreeData.fire();
    }

    async show() {
        if (this._roots === undefined || this._roots.length === 0 || this._tree === undefined) return;

        try {
            await this._tree.reveal(this._roots[0], { select: false });
        }
        catch (ex) {
            Logger.error(ex);
        }
    }

    showComparisonInResults(repoPath: string, ref1: string | NamedRef, ref2: string | NamedRef) {
        this.showResults(this.addResults(new ComparisonResultsNode(repoPath, typeof ref1 === 'string' ? { ref: ref1 } : ref1, typeof ref2 === 'string' ? { ref: ref2 } : ref2, this)));
    }

    showCommitInResults(commit: GitLogCommit) {
        this.showResults(this.addResults(new CommitResultsNode(commit, this)));
    }

    showCommitsInResults(results: GitLog, resultsLabel: string | { label: string, resultsType?: { singular: string, plural: string } }) {
        const query = results.query === undefined
            ? (maxCount: number | undefined) => Promise.resolve(results)
            : results.query;

        const labelFn = async (log: GitLog | undefined) => {
            if (typeof resultsLabel === 'string') return resultsLabel;

            const count = log !== undefined ? log.count : 0;
            const truncated = log !== undefined ? log.truncated : false;

            const resultsType = resultsLabel.resultsType === undefined
                ? { singular: 'result', plural: 'results' }
                : resultsLabel.resultsType;

            let repository = '';
            if (await Container.git.getRepositoryCount() > 1) {
                const repo = await Container.git.getRepository(results.repoPath);
                repository = ` ${Strings.pad(GlyphChars.Dash, 1, 1)} ${(repo && repo.formattedName) || results.repoPath}`;
            }

            if (count === 1) return `1 ${resultsType.singular} for ${resultsLabel.label}${repository}`;
            return `${count === 0 ? 'No' : `${count}${truncated ? '+' : ''}`} ${resultsType.plural} for ${resultsLabel.label}${repository}`;
        };

        this.showResults(this.addResults(new CommitsResultsNode(results.repoPath, labelFn, Functions.seeded(query, results), this, ResourceType.SearchResults)));
    }

    private async showResults(results: ExplorerNode) {
        this._enabled = true;
        await setCommandContext(CommandContext.ResultsExplorer, this.config.location);

        setTimeout(() => this._tree!.reveal(results, { select: true }), 250);
    }

    private addResults(results: ExplorerNode): ExplorerNode {
        if (this._roots.includes(results)) return results;

        if (this._roots.length > 0 && !this.keepResults) {
            this.clearResults();
        }

        this._roots.splice(0, 0, results);
        this.refreshNode(results);
        return results;
    }

    private clearResults() {
        if (this._roots.length === 0) return;

        this._roots.forEach(r => r.dispose());
        this._roots = [];

        this.refresh();
    }

    private clearResultsNode(node: ExplorerNode) {
        const index = this._roots.findIndex(n => n === node);
        if (index === -1) return;

        this._roots.splice(index, 1);

        node.dispose();

        this.refresh();
    }

    private async setFilesLayout(layout: ExplorerFilesLayout) {
        return configuration.update(configuration.name('resultsExplorer')('files')('layout').value, layout, ConfigurationTarget.Global);
    }

    private setKeepResults(enabled: boolean) {
        Container.context.workspaceState.update(WorkspaceState.ResultsExplorerKeepResults, enabled);
        setCommandContext(CommandContext.ResultsExplorerKeepResults, enabled);
    }

    private swapComparision(node: ExplorerNode) {
        if (!(node instanceof ComparisonResultsNode)) return;

        this.showComparisonInResults(node.repoPath, node.ref2, node.ref1);
    }
}
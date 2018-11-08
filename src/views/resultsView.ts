'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, ResultsViewConfig, ViewFilesLayout, ViewsConfig } from '../configuration';
import { CommandContext, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { NamedRef, ResultsComparisonNode, ResultsNode, ViewNode } from './nodes';
import { RefreshReason, ViewBase } from './viewBase';

export class ResultsView extends ViewBase<ResultsNode> {
    constructor() {
        super('gitlens.views.results');

        setCommandContext(CommandContext.ViewsResultsKeepResults, this.keepResults);
    }

    getRoot() {
        return new ResultsNode(this);
    }

    protected get location(): string {
        return this.config.location;
    }

    protected registerCommands() {
        void Container.viewCommands;
        // commands.registerCommand(this.getQualifiedCommand('clear'), () => this.clear(), this);
        commands.registerCommand(this.getQualifiedCommand('close'), () => this.close(), this);
        commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(), this);
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToAuto'),
            () => this.setFilesLayout(ViewFilesLayout.Auto),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToList'),
            () => this.setFilesLayout(ViewFilesLayout.List),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToTree'),
            () => this.setFilesLayout(ViewFilesLayout.Tree),
            this
        );
        commands.registerCommand(this.getQualifiedCommand('setKeepResultsToOn'), () => this.setKeepResults(true), this);
        commands.registerCommand(
            this.getQualifiedCommand('setKeepResultsToOff'),
            () => this.setKeepResults(false),
            this
        );
        commands.registerCommand(this.getQualifiedCommand('swapComparision'), this.swapComparision, this);
    }

    protected onConfigurationChanged(e: ConfigurationChangeEvent) {
        if (
            !configuration.changed(e, configuration.name('views')('results').value) &&
            !configuration.changed(e, configuration.name('views').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value)
        ) {
            return;
        }

        if (configuration.changed(e, configuration.name('views')('results')('location').value)) {
            this.initialize(this.config.location);
        }

        if (!configuration.initializing(e) && this._root !== undefined) {
            void this.refresh(RefreshReason.ConfigurationChanged);
        }
    }

    get config(): ViewsConfig & ResultsViewConfig {
        return { ...Container.config.views, ...Container.config.views.results };
    }

    private _enabled: boolean = false;
    get enabled(): boolean {
        return this._enabled;
    }

    get keepResults(): boolean {
        return Container.context.workspaceState.get<boolean>(WorkspaceState.ViewsResultsKeepResults, false);
    }

    clear() {
        if (this._root === undefined) return;

        this._root.clear();
    }

    close() {
        if (this._root === undefined) return;

        this._root.clear();

        this._enabled = false;
        setCommandContext(CommandContext.ViewsResults, false);
    }

    dismissNode(node: ViewNode) {
        if (this._root === undefined) return;

        this._root.dismiss(node);
    }

    compare(repoPath: string, ref1: string | NamedRef, ref2: string | NamedRef) {
        return this.addResults(
            new ResultsComparisonNode(
                this,
                repoPath,
                typeof ref1 === 'string' ? { ref: ref1 } : ref1,
                typeof ref2 === 'string' ? { ref: ref2 } : ref2
            )
        );
    }

    private async addResults(results: ViewNode) {
        const root = this.ensureRoot();
        root.addOrReplace(results, !this.keepResults);

        this._enabled = true;
        await setCommandContext(CommandContext.ViewsResults, true);

        setTimeout(() => this._tree!.reveal(results, { select: true }), 250);
    }

    private setFilesLayout(layout: ViewFilesLayout) {
        return configuration.updateEffective(configuration.name('views')('results')('files')('layout').value, layout);
    }

    private setKeepResults(enabled: boolean) {
        Container.context.workspaceState.update(WorkspaceState.ViewsResultsKeepResults, enabled);
        setCommandContext(CommandContext.ViewsResultsKeepResults, enabled);
    }

    private swapComparision(node: ViewNode) {
        if (!(node instanceof ResultsComparisonNode)) return;

        node.swap();
    }
}

'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { CompareViewConfig, configuration, ViewFilesLayout, ViewsConfig } from '../configuration';
import { CommandContext, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { CompareNode, CompareResultsNode, NamedRef, ViewNode } from './nodes';
import { ViewBase } from './viewBase';

export class CompareView extends ViewBase<CompareNode> {
    constructor() {
        super('gitlens.views.compare');

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
        commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this);
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

        commands.registerCommand(this.getQualifiedCommand('selectForCompare'), this.selectForCompare, this);
        commands.registerCommand(this.getQualifiedCommand('compareWithSelected'), this.compareWithSelected, this);
    }

    protected onConfigurationChanged(e: ConfigurationChangeEvent) {
        if (
            !configuration.changed(e, configuration.name('views')('compare').value) &&
            !configuration.changed(e, configuration.name('views').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value)
        ) {
            return;
        }

        if (configuration.changed(e, configuration.name('views')('compare')('location').value)) {
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

        this._root.dismiss(node);
    }

    compare(repoPath: string, ref1: string | NamedRef, ref2: string | NamedRef) {
        return this.addResults(
            new CompareResultsNode(
                this,
                repoPath,
                typeof ref1 === 'string' ? { ref: ref1 } : ref1,
                typeof ref2 === 'string' ? { ref: ref2 } : ref2
            )
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

    private async addResults(results: ViewNode) {
        if (!this.visible) {
            void (await this.show());
        }

        const root = this.ensureRoot();
        root.addOrReplace(results, !this.keepResults);

        setImmediate(() => this.reveal(results, { select: true, expand: true }));
    }

    private setFilesLayout(layout: ViewFilesLayout) {
        return configuration.updateEffective(configuration.name('views')('compare')('files')('layout').value, layout);
    }

    private setKeepResults(enabled: boolean) {
        Container.context.workspaceState.update(WorkspaceState.ViewsCompareKeepResults, enabled);
        setCommandContext(CommandContext.ViewsCompareKeepResults, enabled);
    }

    private swapComparision(node: ViewNode) {
        if (!(node instanceof CompareResultsNode)) return;

        node.swap();
    }
}

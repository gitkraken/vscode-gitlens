'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, ExplorerFilesLayout, IExplorersConfig, IResultsExplorerConfig } from '../configuration';
import { CommandContext, GlyphChars, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { GitLog, GitLogCommit } from '../git/gitService';
import { Functions, Strings } from '../system';
import { ExplorerBase, RefreshReason } from './explorer';
import { RefreshNodeCommandArgs } from './explorerCommands';
import {
    ExplorerNode,
    NamedRef,
    ResourceType,
    ResultsCommitNode,
    ResultsCommitsNode,
    ResultsComparisonNode,
    ResultsNode
} from './nodes';

export class ResultsExplorer extends ExplorerBase<ResultsNode> {
    constructor() {
        super('gitlens.resultsExplorer');

        setCommandContext(CommandContext.ResultsExplorerKeepResults, this.keepResults);
    }

    getRoot() {
        return new ResultsNode(this);
    }

    protected registerCommands() {
        Container.explorerCommands;
        commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(), this);
        commands.registerCommand(
            this.getQualifiedCommand('refreshNode'),
            (node: ExplorerNode, args?: RefreshNodeCommandArgs) => this.refreshNode(node, args),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToAuto'),
            () => this.setFilesLayout(ExplorerFilesLayout.Auto),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToList'),
            () => this.setFilesLayout(ExplorerFilesLayout.List),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToTree'),
            () => this.setFilesLayout(ExplorerFilesLayout.Tree),
            this
        );

        commands.registerCommand(
            this.getQualifiedCommand('dismissNode'),
            (node: ExplorerNode) => this.dismissNode(node),
            this
        );
        commands.registerCommand(this.getQualifiedCommand('close'), () => this.close(), this);
        commands.registerCommand(this.getQualifiedCommand('setKeepResultsToOn'), () => this.setKeepResults(true), this);
        commands.registerCommand(
            this.getQualifiedCommand('setKeepResultsToOff'),
            () => this.setKeepResults(false),
            this
        );
        commands.registerCommand(this.getQualifiedCommand('swapComparision'), this.swapComparision, this);
    }

    protected onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        if (
            !initializing &&
            !configuration.changed(e, configuration.name('resultsExplorer').value) &&
            !configuration.changed(e, configuration.name('explorers').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value)
        ) {
            return;
        }

        if (initializing || configuration.changed(e, configuration.name('resultsExplorer')('location').value)) {
            setCommandContext(CommandContext.ResultsExplorer, this.enabled ? this.config.location : false);
        }

        if (initializing || configuration.changed(e, configuration.name('resultsExplorer')('location').value)) {
            this.initialize(this.config.location);
        }

        if (!initializing && this._root !== undefined) {
            void this.refresh(RefreshReason.ConfigurationChanged);
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
        if (this._root === undefined) return;

        this._root.clear();

        this._enabled = false;
        setCommandContext(CommandContext.ResultsExplorer, false);
    }

    addCommit(commit: GitLogCommit) {
        return this.addResults(new ResultsCommitNode(commit, this));
    }

    addComparison(repoPath: string, ref1: string | NamedRef, ref2: string | NamedRef) {
        return this.addResults(
            new ResultsComparisonNode(
                repoPath,
                typeof ref1 === 'string' ? { ref: ref1 } : ref1,
                typeof ref2 === 'string' ? { ref: ref2 } : ref2,
                this
            )
        );
    }

    addSearchResults(
        results: GitLog,
        resultsLabel:
            | string
            | {
                  label: string;
                  resultsType?: { singular: string; plural: string };
              }
    ) {
        const getCommitsQuery = async (maxCount: number | undefined) => {
            const log = await Functions.seeded(
                results.query === undefined
                    ? (maxCount: number | undefined) => Promise.resolve(results)
                    : results.query,
                results
            )(maxCount);

            let label;
            if (typeof resultsLabel === 'string') {
                label = resultsLabel;
            }
            else {
                const count = log !== undefined ? log.count : 0;
                const truncated = log !== undefined ? log.truncated : false;

                const resultsType =
                    resultsLabel.resultsType === undefined
                        ? { singular: 'result', plural: 'results' }
                        : resultsLabel.resultsType;

                let repository = '';
                if ((await Container.git.getRepositoryCount()) > 1) {
                    const repo = await Container.git.getRepository(results.repoPath);
                    repository = ` ${Strings.pad(GlyphChars.Dash, 1, 1)} ${(repo && repo.formattedName) ||
                        results.repoPath}`;
                }

                label = `${Strings.pluralize(resultsType.singular, count, {
                    number: truncated ? `${count}+` : undefined,
                    plural: resultsType.plural,
                    zero: 'No'
                })} for ${resultsLabel.label}${repository}`;
            }

            return {
                label: label,
                log: log
            };
        };

        return this.addResults(
            new ResultsCommitsNode(results.repoPath, getCommitsQuery, undefined, this, ResourceType.SearchResults)
        );
    }

    private async addResults(results: ExplorerNode) {
        if (this._root === undefined) {
            this._root = this.getRoot();
        }

        this._root.addOrReplace(results, !this.keepResults);

        this._enabled = true;
        await setCommandContext(CommandContext.ResultsExplorer, this.config.location);

        setTimeout(() => this._tree!.reveal(results, { select: true }), 250);
    }

    private dismissNode(node: ExplorerNode) {
        if (this._root === undefined) return;

        this._root.dismiss(node);
    }

    private setFilesLayout(layout: ExplorerFilesLayout) {
        return configuration.updateEffective(configuration.name('resultsExplorer')('files')('layout').value, layout);
    }

    private setKeepResults(enabled: boolean) {
        Container.context.workspaceState.update(WorkspaceState.ResultsExplorerKeepResults, enabled);
        setCommandContext(CommandContext.ResultsExplorerKeepResults, enabled);
    }

    private swapComparision(node: ExplorerNode) {
        if (!(node instanceof ResultsComparisonNode)) return;

        node.swap();
    }
}

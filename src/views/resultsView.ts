'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, ResultsViewConfig, ViewFilesLayout, ViewsConfig } from '../configuration';
import { CommandContext, GlyphChars, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { GitLog, GitLogCommit } from '../git/gitService';
import { Functions, Strings } from '../system';
import {
    NamedRef,
    ResourceType,
    ResultsCommitNode,
    ResultsCommitsNode,
    ResultsComparisonNode,
    ResultsNode,
    ViewNode
} from './nodes';
import { RefreshReason, ViewBase } from './viewBase';
import { RefreshNodeCommandArgs } from './viewCommands';

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
        commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(), this);
        commands.registerCommand(
            this.getQualifiedCommand('refreshNode'),
            (node: ViewNode, args?: RefreshNodeCommandArgs) => this.refreshNode(node, args),
            this
        );
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

        commands.registerCommand(
            this.getQualifiedCommand('dismissNode'),
            (node: ViewNode) => this.dismissNode(node),
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

    close() {
        if (this._root === undefined) return;

        this._root.clear();

        this._enabled = false;
        setCommandContext(CommandContext.ViewsResults, false);
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
        repoPath: string,
        resultsOrPromise: GitLog | Promise<GitLog | undefined>,
        resultsLabel:
            | string
            | {
                  label: string;
                  resultsType?: { singular: string; plural: string };
              }
    ) {
        const getCommitsQuery = async (maxCount: number | undefined) => {
            const results = await resultsOrPromise;

            let log;
            if (results !== undefined) {
                log = await Functions.seeded(
                    results.query === undefined
                        ? (maxCount: number | undefined) => Promise.resolve(results)
                        : results.query,
                    results.maxCount === maxCount ? results : undefined
                )(maxCount);
            }

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
                    const repo = await Container.git.getRepository(repoPath);
                    repository = ` ${Strings.pad(GlyphChars.Dash, 1, 1)} ${(repo && repo.formattedName) || repoPath}`;
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
            new ResultsCommitsNode(repoPath, getCommitsQuery, undefined, this, ResourceType.SearchResults)
        );
    }

    private async addResults(results: ViewNode) {
        if (this._root === undefined) {
            this._root = this.getRoot();
        }

        this._root.addOrReplace(results, !this.keepResults);

        this._enabled = true;
        await setCommandContext(CommandContext.ViewsResults, true);

        setTimeout(() => this._tree!.reveal(results, { select: true }), 250);
    }

    private dismissNode(node: ViewNode) {
        if (this._root === undefined) return;

        this._root.dismiss(node);
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

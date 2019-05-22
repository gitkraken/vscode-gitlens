'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchComparisons, GlyphChars, WorkspaceState } from '../../constants';
import { ResourceType, ViewNode } from './viewNode';
import { RepositoriesView } from '../repositoriesView';
import { GitBranch, GitService, GitUri } from '../../git/gitService';
import { CommandQuickPickItem, ReferencesQuickPick } from '../../quickpicks';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { Container } from '../../container';
import { Strings } from '../../system';
import { ResultsFilesNode } from './resultsFilesNode';

export class CompareBranchNode extends ViewNode<RepositoriesView> {
    private _children: ViewNode[] | undefined;
    private _compareWith: string | undefined;

    constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly branch: GitBranch) {
        super(uri, view, parent);

        const comparisons = Container.context.workspaceState.get<BranchComparisons>(WorkspaceState.BranchComparisons);
        this._compareWith = comparisons && comparisons[branch.id];
    }

    get id(): string {
        return `${this._instanceId}:gitlens:repository(${this.branch.repoPath}):branch(${
            this.branch.name
        }):compareWith`;
    }

    getChildren(): ViewNode[] {
        if (this._compareWith === undefined) return [];

        if (this._children === undefined) {
            this._children = [
                new ResultsCommitsNode(
                    this.view,
                    this,
                    this.uri.repoPath!,
                    'commits',
                    this.getCommitsQuery.bind(this),
                    {
                        expand: false,
                        includeDescription: false,
                        querying: true
                    }
                ),
                new ResultsFilesNode(this.view, this, this.uri.repoPath!, this.branch.ref, this._compareWith)
            ];
        }
        return this._children;
    }

    getTreeItem(): TreeItem {
        let state: TreeItemCollapsibleState;
        let label;
        let description;
        if (this._compareWith === undefined) {
            label = `Compare ${this.branch.name} with <branch, tag, or ref>`;
            state = TreeItemCollapsibleState.None;
        }
        else {
            label = `${this.branch.name}`;
            description = `${GlyphChars.ArrowLeftRightLong}${
                GlyphChars.Space
            } ${GitService.shortenSha(this._compareWith, {
                working: 'Working Tree'
            })}`;
            state = TreeItemCollapsibleState.Collapsed;
        }

        const item = new TreeItem(label, state);
        item.command = {
            title: `Compare ${this.branch.name} with${GlyphChars.Ellipsis}`,
            command: 'gitlens.views.executeNodeCallback',
            arguments: [() => this.compareWith()]
        };
        item.contextValue = ResourceType.CompareBranch;
        item.description = description;
        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-compare-refs.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-compare-refs.svg')
        };
        item.id = this.id;
        item.tooltip = `Click to compare ${this.branch.name} with${GlyphChars.Ellipsis}`;

        return item;
    }

    async compareWith() {
        const pick = await new ReferencesQuickPick(this.branch.repoPath).show(
            `Compare ${this.branch.name} with${GlyphChars.Ellipsis}`,
            { allowEnteringRefs: true }
        );
        if (pick === undefined || pick instanceof CommandQuickPickItem) return;

        this._compareWith = pick.ref;
        this.updateCompareWith(this._compareWith);

        this._children = undefined;
        this.view.triggerNodeChange(this);
    }

    private async getCommitsQuery(maxCount: number | undefined): Promise<CommitsQueryResults> {
        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: maxCount,
            ref: `${this.branch.ref}...${this._compareWith || 'HEAD'}`
        });

        const count = log !== undefined ? log.count : 0;
        const truncated = log !== undefined ? log.truncated : false;

        const label = Strings.pluralize('commit', count, { number: truncated ? `${count}+` : undefined, zero: 'No' });

        return {
            label: label,
            log: log
        };
    }

    private async updateCompareWith(compareWith: string | undefined) {
        let comparisons = Container.context.workspaceState.get<BranchComparisons>(WorkspaceState.BranchComparisons);
        if (comparisons === undefined) {
            comparisons = Object.create(null);
        }

        if (compareWith) {
            comparisons![this.branch.id] = compareWith;
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [this.branch.id]: _, ...rest } = comparisons!;
            comparisons = rest;
        }
        await Container.context.workspaceState.update(WorkspaceState.BranchComparisons, comparisons);
    }
}

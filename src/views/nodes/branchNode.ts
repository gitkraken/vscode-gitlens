'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitBranch, GitUri } from '../../git/gitService';
import { Iterables } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { BranchTrackingStatusNode } from './branchTrackingStatusNode';
import { CommitNode } from './commitNode';
import { MessageNode, ShowMoreNode } from './common';
import { getBranchesAndTagTipsFn, insertDateMarkers } from './helpers';
import { PageableViewNode, ResourceType, ViewNode, ViewRefNode } from './viewNode';

export class BranchNode extends ViewRefNode<RepositoriesView> implements PageableViewNode {
    readonly supportsPaging: boolean = true;
    maxCount: number | undefined;

    private _children: ViewNode[] | undefined;

    constructor(
        uri: GitUri,
        view: RepositoriesView,
        parent: ViewNode,
        public readonly branch: GitBranch,
        // Specifies that the node is shown as a root under the repository node
        private readonly _root: boolean = false
    ) {
        super(uri, view, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.branch.repoPath}):${this._root ? 'root:' : ''}branch(${this.branch.name})${
            this.branch.remote ? ':remote' : ''
        }`;
    }

    get current(): boolean {
        return this.branch.current;
    }

    get label(): string {
        const branchName = this.branch.getName();
        if (this.view.config.branches.layout === ViewBranchesLayout.List) return branchName;

        return this.current || GitBranch.isDetached(branchName) ? branchName : this.branch.getBasename();
    }

    get ref(): string {
        return this.branch.ref;
    }

    async getChildren(): Promise<ViewNode[]> {
        if (this._children === undefined) {
            const children = [];
            if (!this._root && this.branch.tracking) {
                const status = {
                    ref: this.branch.ref,
                    repoPath: this.branch.repoPath,
                    state: this.branch.state,
                    upstream: this.branch.tracking
                };

                if (this.branch.state.behind) {
                    children.push(new BranchTrackingStatusNode(this.view, this, status, 'behind'));
                }

                if (this.branch.state.ahead) {
                    children.push(new BranchTrackingStatusNode(this.view, this, status, 'ahead'));
                }
            }

            const log = await Container.git.getLog(this.uri.repoPath!, {
                maxCount: this.maxCount || this.view.config.defaultItemLimit,
                ref: this.ref
            });
            if (log === undefined) return [new MessageNode(this.view, this, 'No commits could be found.')];

            const getBranchAndTagTips = await getBranchesAndTagTipsFn(this.uri.repoPath, this.branch.name);
            children.push(
                ...insertDateMarkers(
                    Iterables.map(
                        log.commits.values(),
                        c => new CommitNode(this.view, this, c, this.branch, getBranchAndTagTips)
                    ),
                    this
                )
            );

            if (log.truncated) {
                children.push(new ShowMoreNode(this.view, this, 'Commits'));
            }

            this._children = children;
        }
        return this._children;
    }

    async getTreeItem(): Promise<TreeItem> {
        let name = this.label;
        let tooltip = `${this.branch.getName()}${this.current ? ' (current)' : ''}`;
        let iconSuffix = '';

        if (!this.branch.remote && this.branch.tracking !== undefined) {
            if (this.view.config.showTrackingBranch) {
                name += `${this.branch.getTrackingStatus({ prefix: `${GlyphChars.Space} ` })}${GlyphChars.Space} ${
                    GlyphChars.ArrowLeftRightLong
                }${GlyphChars.Space} ${this.branch.tracking}`;
            }
            tooltip += ` is tracking ${this.branch.tracking}\n${this.branch.getTrackingStatus({
                empty: 'up-to-date',
                expand: true,
                separator: '\n'
            })}`;

            if (this.branch.state.ahead || this.branch.state.behind) {
                if (this.branch.state.behind) {
                    iconSuffix = '-red';
                }
                if (this.branch.state.ahead) {
                    iconSuffix = this.branch.state.behind ? '-yellow' : '-green';
                }
            }
        }

        const item = new TreeItem(
            // Hide the current branch checkmark when the node is displayed as a root under the repository node
            `${!this._root && this.current ? `${GlyphChars.Check} ${GlyphChars.Space}` : ''}${name}`,
            TreeItemCollapsibleState.Collapsed
        );
        item.id = this.id;
        item.tooltip = tooltip;

        if (this.branch.remote) {
            item.contextValue = ResourceType.RemoteBranch;
        }
        else if (this.current) {
            item.contextValue = this.branch.tracking
                ? ResourceType.CurrentBranchWithTracking
                : ResourceType.CurrentBranch;
        }
        else {
            item.contextValue = this.branch.tracking ? ResourceType.BranchWithTracking : ResourceType.Branch;
        }

        item.iconPath = {
            dark: Container.context.asAbsolutePath(`images/dark/icon-branch${iconSuffix}.svg`),
            light: Container.context.asAbsolutePath(`images/light/icon-branch${iconSuffix}.svg`)
        };

        return item;
    }

    refresh() {
        this._children = undefined;
    }
}

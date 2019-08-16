'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitBranch, GitRemoteType, GitUri } from '../../git/gitService';
import { debug, gate, Iterables, log } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { BranchTrackingStatusNode } from './branchTrackingStatusNode';
import { CommitNode } from './commitNode';
import { MessageNode, ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { PageableViewNode, ResourceType, ViewNode, ViewRefNode } from './viewNode';

export class BranchNode extends ViewRefNode<RepositoriesView> implements PageableViewNode {
    readonly supportsPaging = true;
    readonly rememberLastMaxCount = true;
    maxCount: number | undefined = this.view.getNodeLastMaxCount(this);

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

    toClipboard(): string {
        return this.branch.name;
    }

    get id(): string {
        return `gitlens:repository(${this.branch.repoPath})${this._root ? ':root' : ''}:branch(${this.branch.name})${
            this.branch.current ? '+current' : ''
        }${this.branch.remote ? '+remote' : ''}${this.branch.starred ? '+starred' : ''}`;
    }

    get current(): boolean {
        return this.branch.current;
    }

    get label(): string {
        const branchName = this.branch.getName();
        if (this.view.config.branches.layout === ViewBranchesLayout.List) return branchName;

        return (this._root && this.current) || this.branch.detached || this.branch.starred
            ? branchName
            : this.branch.getBasename();
    }

    get ref(): string {
        return this.branch.ref;
    }

    get treeHierarchy(): string[] {
        return this.branch.detached || this.branch.starred ? [this.branch.name] : this.branch.getName().split('/');
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
                    children.push(new BranchTrackingStatusNode(this.view, this, this.branch, status, 'behind'));
                }

                if (this.branch.state.ahead) {
                    children.push(new BranchTrackingStatusNode(this.view, this, this.branch, status, 'ahead'));
                }
            }

            const log = await Container.git.getLog(this.uri.repoPath!, {
                maxCount: this.maxCount !== undefined ? this.maxCount : this.view.config.defaultItemLimit,
                ref: this.ref
            });
            if (log === undefined) return [new MessageNode(this.view, this, 'No commits could be found.')];

            const getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(
                this.uri.repoPath,
                this.branch.name
            );
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
                children.push(
                    new ShowMoreNode(this.view, this, 'Commits', log.maxCount, children[children.length - 1])
                );
            }

            this._children = children;
        }
        return this._children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const name = this.label;
        let tooltip = `${this.branch.getName()}${this.current ? ' (current)' : ''}`;
        let iconSuffix = '';

        let description;
        if (!this.branch.remote && this.branch.tracking !== undefined) {
            if (this.view.config.showTrackingBranch) {
                let arrows = GlyphChars.Dash;

                const remote = await this.branch.getRemote();
                if (remote !== undefined) {
                    let left;
                    let right;
                    for (const { type } of remote.types) {
                        if (type === GitRemoteType.Fetch) {
                            left = true;

                            if (right) break;
                        }
                        else if (type === GitRemoteType.Push) {
                            right = true;

                            if (left) break;
                        }
                    }

                    if (left && right) {
                        arrows = GlyphChars.ArrowsRightLeft;
                    }
                    else if (right) {
                        arrows = GlyphChars.ArrowRight;
                    }
                    else if (left) {
                        arrows = GlyphChars.ArrowLeft;
                    }
                }

                description = `${this.branch.getTrackingStatus({ suffix: `${GlyphChars.Space} ` })}${arrows}${
                    GlyphChars.Space
                } ${this.branch.tracking}`;
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
        item.contextValue = ResourceType.Branch;
        if (this.current) {
            item.contextValue += '+current';
        }
        if (this.branch.remote) {
            item.contextValue += '+remote';
        }
        if (this.branch.starred) {
            item.contextValue += '+starred';
        }
        if (this.branch.tracking) {
            item.contextValue += '+tracking';
        }

        item.description = description;
        item.iconPath = {
            dark: Container.context.asAbsolutePath(`images/dark/icon-branch${iconSuffix}.svg`),
            light: Container.context.asAbsolutePath(`images/light/icon-branch${iconSuffix}.svg`)
        };
        item.id = this.id;
        item.tooltip = tooltip;

        return item;
    }

    @log()
    async star() {
        await this.branch.star();
        void this.parent!.triggerChange();
    }

    @log()
    async unstar() {
        await this.branch.unstar();
        void this.parent!.triggerChange();
    }

    @gate()
    @debug()
    refresh() {
        this._children = undefined;
    }
}

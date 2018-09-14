'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerBranchesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitBranch, GitUri } from '../../git/gitService';
import { Arrays, Iterables } from '../../system';
import { RepositoriesExplorer } from '../repositoriesExplorer';
import { CommitNode } from './commitNode';
import { MessageNode, ShowMoreNode } from './common';
import { ExplorerNode, ExplorerRefNode, PageableExplorerNode, ResourceType } from './explorerNode';

export class BranchNode extends ExplorerRefNode implements PageableExplorerNode {
    readonly supportsPaging: boolean = true;
    maxCount: number | undefined;

    private _children: ExplorerNode[] | undefined;

    constructor(
        public readonly branch: GitBranch,
        uri: GitUri,
        parent: ExplorerNode,
        public readonly explorer: RepositoriesExplorer,
        private readonly _markCurrent: boolean = true
    ) {
        super(uri, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.branch.repoPath}):branch(${this.branch.name})${
            this.branch.remote ? ':remote' : ''
        }${this._markCurrent ? ':current' : ''}`;
    }

    get current(): boolean {
        return this.branch.current;
    }

    get label(): string {
        const branchName = this.branch.getName();
        if (this.explorer.config.branches.layout === ExplorerBranchesLayout.List) return branchName;

        return this.current || GitBranch.isDetached(branchName) ? branchName : this.branch.getBasename();
    }

    get ref(): string {
        return this.branch.ref;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        if (this._children === undefined) {
            const log = await Container.git.getLog(this.uri.repoPath!, {
                maxCount: this.maxCount || this.explorer.config.defaultItemLimit,
                ref: this.ref
            });
            if (log === undefined) return [new MessageNode(this, 'No commits yet')];

            const branches = await Container.git.getBranches(this.uri.repoPath);
            // Get the sha length, since `git branch` can return variable length shas
            const shaLength = branches[0].sha!.length;
            const branchesBySha = Arrays.groupByFilterMap(
                branches,
                b => b.sha!,
                b => (b.name === this.branch.name ? undefined : b.name)
            );

            const getBranchTips = (sha: string) => {
                const branches = branchesBySha.get(sha.substr(0, shaLength));
                if (branches === undefined || branches.length === 0) return undefined;
                return branches.join(', ');
            };

            const children: (CommitNode | ShowMoreNode)[] = [
                ...Iterables.map(
                    log.commits.values(),
                    c => new CommitNode(c, this, this.explorer, this.branch, getBranchTips)
                )
            ];

            if (log.truncated) {
                children.push(new ShowMoreNode('Commits', this, this.explorer));
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
            if (this.explorer.config.showTrackingBranch) {
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
            `${this._markCurrent && this.current ? `${GlyphChars.Check} ${GlyphChars.Space}` : ''}${name}`,
            TreeItemCollapsibleState.Collapsed
        );
        item.id = this.id;
        item.tooltip = tooltip;

        if (this.branch.remote) {
            item.contextValue = ResourceType.RemoteBranch;
        }
        else if (this.current) {
            item.contextValue = !!this.branch.tracking
                ? ResourceType.CurrentBranchWithTracking
                : ResourceType.CurrentBranch;
        }
        else {
            item.contextValue = !!this.branch.tracking ? ResourceType.BranchWithTracking : ResourceType.Branch;
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

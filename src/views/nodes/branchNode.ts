'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerBranchesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitBranch, GitUri } from '../../gitService';
import { Arrays, Iterables } from '../../system';
import { GitExplorer } from '../gitExplorer';
import { CommitNode } from './commitNode';
import { ExplorerNode, ExplorerRefNode, MessageNode, ResourceType, ShowAllNode } from './explorerNode';

export class BranchNode extends ExplorerRefNode {
    readonly supportsPaging: boolean = true;

    constructor(
        public readonly branch: GitBranch,
        uri: GitUri,
        protected readonly explorer: GitExplorer
    ) {
        super(uri);
    }

    get current(): boolean {
        return this.branch.current;
    }

    get label(): string {
        const branchName = this.branch.getName();
        if (this.explorer.config.branches.layout === ExplorerBranchesLayout.List) return branchName;

        return this.current || GitBranch.isDetached(branchName) ? branchName : this.branch.getBasename();
    }

    get markCurrent(): boolean {
        return true;
    }

    get ref(): string {
        return this.branch.ref;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const log = await Container.git.getLog(this.uri.repoPath!, { maxCount: this.maxCount, ref: this.ref });
        if (log === undefined) return [new MessageNode('No commits yet')];

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

        const children: (CommitNode | ShowAllNode)[] = [
            ...Iterables.map(log.commits.values(), c => new CommitNode(c, this.explorer, this.branch, getBranchTips))
        ];

        if (log.truncated) {
            children.push(new ShowAllNode('Show All Commits', this, this.explorer));
        }
        return children;
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
            tooltip += `\n\nTracking ${GlyphChars.Dash} ${this.branch.tracking}
${this.branch.getTrackingStatus({ empty: 'up-to-date', expand: true, separator: '\n' })}`;

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
            `${this.markCurrent && this.current ? `${GlyphChars.Check} ${GlyphChars.Space}` : ''}${name}`,
            TreeItemCollapsibleState.Collapsed
        );
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
}

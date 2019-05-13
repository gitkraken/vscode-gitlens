'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitReflog, GitUri } from '../../git/gitService';
import { Iterables } from '../../system';
import { ViewWithFiles } from '../viewBase';
import { CommitNode } from './commitNode';
import { MessageNode, ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { PageableViewNode, ResourceType, ViewNode } from './viewNode';

export class RecentIncomingChangesNode extends ViewNode<ViewWithFiles> implements PageableViewNode {
    readonly supportsPaging: boolean = true;
    maxCount: number | undefined;

    constructor(view: ViewWithFiles, parent: ViewNode, public readonly reflog: GitReflog) {
        super(GitUri.fromRepoPath(reflog.repoPath), view, parent);
    }

    get id(): string {
        return `${this._instanceId}:gitlens:repository(${this.uri.repoPath}):recent-incoming-changes`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const range = `${this.reflog.previousRef}..${this.reflog.ref}`;

        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: this.maxCount !== undefined ? this.maxCount : this.view.config.defaultItemLimit,
            ref: range
        });
        if (log === undefined) return [new MessageNode(this.view, this, 'No changes')];

        const children = [
            ...insertDateMarkers(Iterables.map(log.commits.values(), c => new CommitNode(this.view, this, c)), this, 1)
        ];

        if (log.truncated) {
            children.push(new ShowMoreNode(this.view, this, 'Commits', children[children.length - 1]));
        }
        return children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem('Recent incoming changes', TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.description = `via ${this.reflog.command} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} ${
            this.reflog.formattedDate
        }`;
        item.contextValue = ResourceType.RecentIncomingChanges;
        item.tooltip = `Recent incoming changes via ${this.reflog.command}\n${this.reflog.formatDate()}`;

        // const iconSuffix = ahead ? 'upload' : 'download';
        // item.iconPath = {
        //     dark: Container.context.asAbsolutePath(`images/dark/icon-${iconSuffix}.svg`),
        //     light: Container.context.asAbsolutePath(`images/light/icon-${iconSuffix}.svg`)
        // };

        return item;
    }
}

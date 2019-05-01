'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitContributor, GitUri } from '../../git/gitService';
import { Iterables, Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { PageableViewNode, ResourceType, ViewNode } from './viewNode';
import { Container } from '../../container';
import { MessageNode, ShowMoreNode } from './common';
import { getBranchesAndTagTipsFn, insertDateMarkers } from './helpers';
import { CommitNode } from './commitNode';
import { GlyphChars } from '../../constants';

export class ContributorNode extends ViewNode<RepositoriesView> implements PageableViewNode {
    readonly supportsPaging: boolean = true;
    maxCount: number | undefined;

    constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly contributor: GitContributor) {
        super(uri, view, parent);
    }

    get id(): string {
        return `${this._instanceId}:gitlens:repository(${this.contributor.repoPath}):contributor(${
            this.contributor.name
        }|${this.contributor.email}}`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: this.maxCount || this.view.config.defaultItemLimit,
            authors: [this.contributor.name]
        });
        if (log === undefined) return [new MessageNode(this.view, this, 'No commits could be found.')];

        const getBranchAndTagTips = await getBranchesAndTagTipsFn(this.uri.repoPath);
        const children = [
            ...insertDateMarkers(
                Iterables.map(
                    log.commits.values(),
                    c => new CommitNode(this.view, this, c, undefined, getBranchAndTagTips)
                ),
                this
            )
        ];

        if (log.truncated) {
            children.push(new ShowMoreNode(this.view, this, 'Commits', children[children.length - 1]));
        }
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const presence = await Container.vsls.getContactPresence(this.contributor.email);

        const item = new TreeItem(this.contributor.name, TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.contextValue = ResourceType.Contributor;
        item.description = `${
            presence != null && presence.status !== 'offline'
                ? `${presence.statusText} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} `
                : ''
        }${this.contributor.email}`;
        item.tooltip = `${this.contributor.name}${presence != null ? ` (${presence.statusText})` : ''}\n${
            this.contributor.email
        }\n${Strings.pluralize('commit', this.contributor.count)}`;

        if (this.view.config.avatars) {
            item.iconPath = this.contributor.getGravatarUri(Container.config.defaultGravatarsStyle);
        }

        return item;
    }
}

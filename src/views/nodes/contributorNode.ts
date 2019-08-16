'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitContributor, GitUri } from '../../git/gitService';
import { Iterables, Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { PageableViewNode, ResourceType, ViewNode } from './viewNode';
import { Container } from '../../container';
import { MessageNode, ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { CommitNode } from './commitNode';
import { GlyphChars } from '../../constants';

export class ContributorNode extends ViewNode<RepositoriesView> implements PageableViewNode {
    readonly supportsPaging = true;
    readonly rememberLastMaxCount = true;
    maxCount: number | undefined = this.view.getNodeLastMaxCount(this);

    constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly contributor: GitContributor) {
        super(uri, view, parent);
    }

    toClipboard(): string {
        return this.contributor.name;
    }

    get id(): string {
        return `gitlens:repository(${this.contributor.repoPath}):contributor(${this.contributor.name}|${this.contributor.email}}`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: this.maxCount !== undefined ? this.maxCount : this.view.config.defaultItemLimit,
            authors: [`^${this.contributor.name} <${this.contributor.email}>$`]
        });
        if (log === undefined) return [new MessageNode(this.view, this, 'No commits could be found.')];

        const getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(this.uri.repoPath);
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
            children.push(new ShowMoreNode(this.view, this, 'Commits', log.maxCount, children[children.length - 1]));
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

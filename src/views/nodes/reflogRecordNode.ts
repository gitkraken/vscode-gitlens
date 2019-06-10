'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitReflogRecord, GitUri } from '../../git/gitService';
import { Iterables } from '../../system';
import { ViewWithFiles } from '../viewBase';
import { CommitNode } from './commitNode';
import { MessageNode, ShowMoreNode } from './common';
import { PageableViewNode, ResourceType, ViewNode } from './viewNode';

export class ReflogRecordNode extends ViewNode<ViewWithFiles> implements PageableViewNode {
    readonly supportsPaging = true;
    readonly rememberLastMaxCount = true;
    maxCount: number | undefined = this.view.getNodeLastMaxCount(this);

    constructor(view: ViewWithFiles, parent: ViewNode, public readonly record: GitReflogRecord) {
        super(GitUri.fromRepoPath(record.repoPath), view, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.uri.repoPath}):reflog-record(${this.record.sha}|${this.record.selector}|${
            this.record.command
        }|${this.record.commandArgs || ''}|${this.record.date.getTime()})`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const range = `${this.record.previousSha}..${this.record.sha}`;

        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: this.maxCount !== undefined ? this.maxCount : this.view.config.defaultItemLimit,
            ref: range
        });
        if (log === undefined) return [new MessageNode(this.view, this, 'No commits')];

        const children: (CommitNode | ShowMoreNode)[] = [
            ...Iterables.map(log.commits.values(), c => new CommitNode(this.view, this, c))
        ];

        if (log.truncated) {
            children.push(new ShowMoreNode(this.view, this, 'Commits', log.maxCount, children[children.length - 1]));
        }
        return children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(
            `${this.record.command}${this.record.commandArgs ? ` ${this.record.commandArgs}` : ''}`,
            TreeItemCollapsibleState.Collapsed
        );
        item.id = this.id;
        item.description = `${
            this.record.HEAD.length === 0
                ? ''
                : `${this.record.HEAD} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} `
        }${this.record.formattedDate}`;
        item.contextValue = ResourceType.ReflogRecord;
        item.tooltip = `${this.record.HEAD.length === 0 ? '' : `${this.record.HEAD}\n`}${this.record.command}${
            this.record.commandArgs ? ` ${this.record.commandArgs}` : ''
        }${
            this.record.details ? ` (${this.record.details})` : ''
        }\n${this.record.formatDateFromNow()} (${this.record.formatDate()})\n${this.record.previousShortSha} ${
            GlyphChars.Space
        }${GlyphChars.ArrowRight}${GlyphChars.Space} ${this.record.shortSha}`;

        return item;
    }
}

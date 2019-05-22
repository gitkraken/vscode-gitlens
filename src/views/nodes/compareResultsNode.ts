'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { NamedRef } from '../../constants';
import { Container } from '../../container';
import { GitService, GitUri } from '../../git/gitService';
import { debug, gate, log, Strings } from '../../system';
import { CompareView } from '../compareView';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { ResultsFilesNode } from './resultsFilesNode';
import { ResourceType, SubscribeableViewNode, ViewNode } from './viewNode';

export class CompareResultsNode extends SubscribeableViewNode<CompareView> {
    private _children: ViewNode[] | undefined;

    constructor(
        view: CompareView,
        public readonly repoPath: string,
        private _ref1: NamedRef,
        private _ref2: NamedRef,
        private _pinned: boolean = false
    ) {
        super(GitUri.fromRepoPath(repoPath), view);
    }

    get label() {
        return `Comparing ${this._ref1.label ||
            GitService.shortenSha(this._ref1.ref, { working: 'Working Tree' })} to ${this._ref2.label ||
            GitService.shortenSha(this._ref2.ref, { working: 'Working Tree' })}`;
    }

    get pinned(): boolean {
        return this._pinned;
    }

    get ref1(): NamedRef {
        return this._ref1;
    }

    get ref2(): NamedRef {
        return this._ref2;
    }

    getChildren(): ViewNode[] {
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
                        includeDescription: true,
                        querying: true
                    }
                ),
                new ResultsFilesNode(this.view, this, this.uri.repoPath!, this._ref1.ref, this._ref2.ref)
            ];
        }
        return this._children;
    }

    async getTreeItem(): Promise<TreeItem> {
        let description;
        if ((await Container.git.getRepositoryCount()) > 1) {
            const repo = await Container.git.getRepository(this.uri.repoPath!);
            description = (repo && repo.formattedName) || this.uri.repoPath;
        }

        const item = new TreeItem(this.label, this._state || TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.CompareResults;
        if (this._pinned) {
            item.contextValue += '+pinned';
        }
        item.description = description;
        if (this._pinned) {
            item.iconPath = {
                dark: Container.context.asAbsolutePath('images/dark/icon-pin-small.svg'),
                light: Container.context.asAbsolutePath('images/light/icon-pin-small.svg')
            };
        }

        return item;
    }

    canDismiss(): boolean {
        return !this._pinned;
    }

    @log()
    async pin() {
        if (this._pinned) return;

        await this.view.updatePinnedComparison(this.getPinnableId(), {
            path: this.repoPath,
            ref1: this.ref1,
            ref2: this.ref2
        });

        this._pinned = true;
        void this.triggerChange();
    }

    @gate()
    @debug()
    refresh(reset: boolean = false) {
        if (!reset) return;

        this._children = undefined;
    }

    @log()
    async swap() {
        // Save the current id so we can update it later
        const currentId = this.getPinnableId();

        const ref1 = this._ref1;
        this._ref1 = this._ref2;
        this._ref2 = ref1;

        // If we were pinned, remove the existing pin and save a new one
        if (this._pinned) {
            await this.view.updatePinnedComparison(currentId);
            await this.view.updatePinnedComparison(this.getPinnableId(), {
                path: this.repoPath,
                ref1: this.ref1,
                ref2: this.ref2
            });
        }

        this._children = undefined;
        this.view.triggerNodeChange(this);
    }

    @log()
    async unpin() {
        if (!this._pinned) return;

        await this.view.updatePinnedComparison(this.getPinnableId());

        this._pinned = false;
        void this.triggerChange();
    }

    protected subscribe() {
        return undefined;
    }

    private async getCommitsQuery(maxCount: number | undefined): Promise<CommitsQueryResults> {
        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: maxCount,
            ref: `${this._ref1.ref}...${this._ref2.ref || 'HEAD'}`
        });

        const count = log !== undefined ? log.count : 0;
        const truncated = log !== undefined ? log.truncated : false;

        const label = Strings.pluralize('commit', count, { number: truncated ? `${count}+` : undefined, zero: 'No' });

        return {
            label: label,
            log: log
        };
    }

    private getPinnableId() {
        return Strings.sha1(`${this.repoPath}|${this.ref1.ref}|${this.ref2.ref}`);
    }
}

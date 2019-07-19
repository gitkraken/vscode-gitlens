'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { getRepoPathOrPrompt } from '../../commands';
import { CommandContext, GlyphChars, NamedRef, setCommandContext } from '../../constants';
import { GitService } from '../../git/gitService';
import { CommandQuickPickItem, ReferencesQuickPick } from '../../quickpicks';
import { debug, gate, Iterables, log, Promises } from '../../system';
import { CompareView } from '../compareView';
import { MessageNode } from './common';
import { ComparePickerNode } from './comparePickerNode';
import { ResourceType, unknownGitUri, ViewNode } from './viewNode';

interface RepoRef {
    label: string;
    repoPath: string;
    ref: string | NamedRef;
}

export class CompareNode extends ViewNode<CompareView> {
    private _children: (ViewNode | MessageNode)[] = [];
    private _comparePickerNode: ComparePickerNode | undefined;

    constructor(view: CompareView) {
        super(unknownGitUri, view);
    }

    private _selectedRef: RepoRef | undefined;
    get selectedRef(): RepoRef | undefined {
        return this._selectedRef;
    }

    getChildren(): ViewNode[] {
        if (this._children.length === 0) {
            // Not really sure why I can't reuse this node -- but if I do the Tree errors out with an id already exists error
            this._comparePickerNode = new ComparePickerNode(this.view, this);
            this._children = [this._comparePickerNode];

            const pinned = this.view.getPinnedComparisons();
            if (pinned.length !== 0) {
                this._children.push(...pinned);
            }
        }
        else if (this._comparePickerNode === undefined || !this._children.includes(this._comparePickerNode)) {
            // Not really sure why I can't reuse this node -- but if I do the Tree errors out with an id already exists error
            this._comparePickerNode = new ComparePickerNode(this.view, this);
            this._children.splice(0, 0, this._comparePickerNode);

            if (this._selectedRef !== undefined) {
                const node = this._comparePickerNode;
                setImmediate(() => this.view.reveal(node, { focus: false, select: true }));
            }
        }

        return this._children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem('Compare', TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.Compare;
        return item;
    }

    addOrReplace(results: ViewNode, replace: boolean) {
        if (this._children.includes(results)) return;

        if (this._children.length !== 0 && replace) {
            this._children.length = 0;
            this._children.push(results);

            // Re-add the pinned comparisons
            const pinned = this.view.getPinnedComparisons();
            if (pinned.length !== 0) {
                this._children.push(...pinned);
            }
        }
        else {
            if (this._comparePickerNode !== undefined) {
                const index = this._children.indexOf(this._comparePickerNode);
                if (index !== -1) {
                    this._children.splice(index, 1);
                }
            }

            this._children.splice(0, 0, results);
        }

        this.view.triggerNodeChange();
    }

    @log()
    clear() {
        this._selectedRef = undefined;
        setCommandContext(CommandContext.ViewsCanCompare, false);

        this._children.length = 0;
        this.view.triggerNodeChange();
    }

    @log({
        args: { 0: (n: ViewNode) => n.toString() }
    })
    dismiss(node: ViewNode) {
        this._selectedRef = undefined;
        setCommandContext(CommandContext.ViewsCanCompare, false);

        if (this._children.length !== 0) {
            const index = this._children.indexOf(node);
            if (index === -1) return;

            this._children.splice(index, 1);
        }
        this.view.triggerNodeChange();
    }

    @gate()
    @debug()
    async refresh() {
        if (this._children.length === 0) return;

        const promises: Promise<any>[] = [
            ...Iterables.filterMap(this._children, c => {
                const result = c.refresh === undefined ? false : c.refresh();
                return Promises.isPromise<boolean | void>(result) ? result : undefined;
            })
        ];
        await Promise.all(promises);
    }

    async compareWithSelected(repoPath?: string, ref?: string | NamedRef) {
        if (this._selectedRef === undefined) return;

        if (repoPath === undefined) {
            repoPath = this._selectedRef.repoPath;
        }
        else if (repoPath !== this._selectedRef.repoPath) {
            // If we don't have a matching repoPath, then start over
            void this.selectForCompare(repoPath, ref);
            return;
        }

        if (ref === undefined) {
            const pick = await new ReferencesQuickPick(repoPath).show(
                `Compare ${this.getRefName(this._selectedRef.ref)} with${GlyphChars.Ellipsis}`,
                {
                    allowEnteringRefs: true,
                    checked:
                        typeof this._selectedRef.ref === 'string' ? this._selectedRef.ref : this._selectedRef.ref.ref,
                    checkmarks: true
                }
            );
            if (pick === undefined || pick instanceof CommandQuickPickItem) return;

            ref = pick.ref;
        }

        const ref1 = this._selectedRef;

        this._selectedRef = undefined;
        setCommandContext(CommandContext.ViewsCanCompare, false);

        void (await this.view.compare(repoPath, ref1.ref, ref));
    }

    async selectForCompare(repoPath?: string, ref?: string | NamedRef) {
        if (repoPath === undefined) {
            repoPath = await getRepoPathOrPrompt(`Compare in which repository${GlyphChars.Ellipsis}`);
        }
        if (repoPath === undefined) return;

        let autoCompare = false;
        if (ref === undefined) {
            const pick = await new ReferencesQuickPick(repoPath).show(`Compare${GlyphChars.Ellipsis}`, {
                allowEnteringRefs: true,
                checkmarks: false
            });
            if (pick === undefined || pick instanceof CommandQuickPickItem) return;

            ref = pick.ref;

            autoCompare = true;
        }

        this._selectedRef = { label: this.getRefName(ref), repoPath: repoPath, ref: ref };
        setCommandContext(CommandContext.ViewsCanCompare, true);

        await this.view.show();

        void (await this.triggerChange());

        if (autoCompare) {
            void (await this.compareWithSelected());
        }
    }

    private getRefName(ref: string | NamedRef) {
        return typeof ref === 'string' ? GitService.shortenSha(ref)! : ref.label || GitService.shortenSha(ref.ref)!;
    }
}

'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { getRepoPathOrPrompt } from '../../commands';
import { CommandContext, GlyphChars, setCommandContext } from '../../constants';
import { GitService } from '../../git/gitService';
import { BranchesAndTagsQuickPick, CommandQuickPickItem } from '../../quickpicks';
import { debug, Functions, gate, log } from '../../system';
import { CompareView } from '../compareView';
import { MessageNode } from './common';
import { ComparePickerNode } from './comparePickerNode';
import { NamedRef, ResourceType, unknownGitUri, ViewNode } from './viewNode';

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

    async getChildren(): Promise<ViewNode[]> {
        if (this._children.length === 0) {
            // Not really sure why I can't reuse this node -- but if I do the Tree errors out with an id already exists error
            this._comparePickerNode = new ComparePickerNode(this.view, this);
            this._children = [this._comparePickerNode];
        }
        else if (
            this._selectedRef !== undefined &&
            (this._comparePickerNode === undefined || !this._children.includes(this._comparePickerNode))
        ) {
            // Not really sure why I can't reuse this node -- but if I do the Tree errors out with an id already exists error
            this._comparePickerNode = new ComparePickerNode(this.view, this);
            this._children.splice(0, 0, this._comparePickerNode);

            const node = this._comparePickerNode;
            setImmediate(() => this.view.reveal(node, { focus: false, select: true }));
        }

        return this._children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Compare`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.Compare;
        return item;
    }

    addOrReplace(results: ViewNode, replace: boolean) {
        if (this._children.includes(results)) return;

        if (this._children.length !== 0 && replace) {
            this._children.length = 0;
            this._children.push(results);
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

        await Promise.all(this._children.map(c => c.refresh()).filter(Functions.isPromise) as Promise<any>[]);
    }

    async compareWithSelected(repoPath?: string, ref?: string | NamedRef) {
        if (this._selectedRef === undefined) return;

        if (repoPath === undefined) {
            repoPath = this._selectedRef.repoPath;
        }
        else if (repoPath !== this._selectedRef.repoPath) {
            // If we don't have a matching repoPath, then start over
            this.selectForCompare(repoPath, ref);
            return;
        }

        if (ref === undefined) {
            const pick = await new BranchesAndTagsQuickPick(repoPath).show(
                `Compare ${this.getRefName(this._selectedRef.ref)} to${GlyphChars.Ellipsis}`
            );
            if (pick === undefined || pick instanceof CommandQuickPickItem) return;

            ref = pick.name;
        }

        const ref1 = this._selectedRef;

        this._selectedRef = undefined;
        setCommandContext(CommandContext.ViewsCanCompare, false);

        void (await this.view.compare(repoPath, ref1.ref, ref));
    }

    async selectForCompare(repoPath?: string, ref?: string | NamedRef) {
        if (repoPath === undefined) {
            repoPath = await getRepoPathOrPrompt(
                undefined,
                `Select branch or tag in which repository${GlyphChars.Ellipsis}`
            );
        }
        if (repoPath === undefined) return;

        if (ref === undefined) {
            const pick = await new BranchesAndTagsQuickPick(repoPath).show(
                `Select branch or tag for compare${GlyphChars.Ellipsis}`
            );
            if (pick === undefined || pick instanceof CommandQuickPickItem) return;

            ref = pick.name;
        }

        this._selectedRef = { label: this.getRefName(ref), repoPath: repoPath, ref: ref };
        setCommandContext(CommandContext.ViewsCanCompare, true);

        await this.view.show();

        void (await this.triggerChange());
    }

    private getRefName(ref: string | NamedRef) {
        return typeof ref === 'string' ? GitService.shortenSha(ref)! : ref.label || GitService.shortenSha(ref.ref)!;
    }
}

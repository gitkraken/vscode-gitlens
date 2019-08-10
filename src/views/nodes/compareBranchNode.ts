'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchComparison, BranchComparisons, GlyphChars, WorkspaceState } from '../../constants';
import { ResourceType, ViewNode } from './viewNode';
import { RepositoriesView } from '../repositoriesView';
import { GitBranch, GitService, GitUri } from '../../git/gitService';
import { CommandQuickPickItem, ReferencesQuickPick } from '../../quickpicks';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { Container } from '../../container';
import { log, Strings } from '../../system';
import { FilesQueryResults, ResultsFilesNode } from './resultsFilesNode';
import { ViewShowBranchComparison } from '../../config';

export class CompareBranchNode extends ViewNode<RepositoriesView> {
    private _children: ViewNode[] | undefined;
    private _compareWith: BranchComparison | undefined;

    constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly branch: GitBranch) {
        super(uri, view, parent);

        const comparisons = Container.context.workspaceState.get<BranchComparisons>(WorkspaceState.BranchComparisons);
        const compareWith = comparisons && comparisons[branch.id];
        if (compareWith !== undefined && typeof compareWith === 'string') {
            this._compareWith = {
                ref: compareWith,
                notation: Container.config.advanced.useSymmetricDifferenceNotation ? '...' : '..',
                type: this.view.config.showBranchComparison || ViewShowBranchComparison.Working
            };
        }
        else {
            this._compareWith = compareWith;
        }
    }

    get id(): string {
        return `gitlens:repository(${this.branch.repoPath}):compare:branch(${this.branch.name}):compareWith`;
    }

    async getChildren(): Promise<ViewNode[]> {
        if (this._compareWith === undefined) return [];

        if (this._children === undefined) {
            let ref1 = this._compareWith.ref || 'HEAD';
            if (this.comparisonNotation === '..') {
                ref1 = (await Container.git.getMergeBase(this.branch.repoPath, ref1, this.branch.ref)) || ref1;
            }

            this._children = [
                new ResultsCommitsNode(
                    this.view,
                    this,
                    this.uri.repoPath!,
                    'commits',
                    this.getCommitsQuery.bind(this),
                    {
                        expand: false,
                        includeDescription: false
                    }
                ),
                new ResultsFilesNode(
                    this.view,
                    this,
                    this.uri.repoPath!,
                    ref1,
                    this.compareWithWorkingTree ? '' : this.branch.ref,
                    this.getFilesQuery.bind(this)
                )
            ];
        }
        return this._children;
    }

    getTreeItem(): TreeItem {
        let state: TreeItemCollapsibleState;
        let label;
        let description;
        if (this._compareWith === undefined) {
            label = `Compare ${this.branch.name}${
                this.compareWithWorkingTree ? ' (working)' : ''
            } with <branch, tag, or ref>`;
            state = TreeItemCollapsibleState.None;
        }
        else {
            label = `${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''}`;
            description = `${GlyphChars.ArrowLeftRightLong}${GlyphChars.Space} ${GitService.shortenSha(
                this._compareWith.ref,
                {
                    strings: {
                        working: 'Working Tree'
                    }
                }
            )}`;
            state = TreeItemCollapsibleState.Collapsed;
        }

        const item = new TreeItem(label, state);
        item.command = {
            title: `Compare ${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''} with${
                GlyphChars.Ellipsis
            }`,
            command: 'gitlens.views.executeNodeCallback',
            arguments: [() => this.compareWith()]
        };
        item.contextValue = `${ResourceType.CompareBranch}${this._compareWith === undefined ? '' : '+comparing'}+${
            this.comparisonNotation === '..' ? 'twodot' : 'threedot'
        }+${this.comparisonType}`;
        item.description = description;
        item.iconPath = {
            dark: Container.context.asAbsolutePath(
                `images/dark/icon-compare-${this.compareWithWorkingTree ? 'ref-working' : 'refs'}.svg`
            ),
            light: Container.context.asAbsolutePath(
                `images/light/icon-compare-${this.compareWithWorkingTree ? 'ref-working' : 'refs'}.svg`
            )
        };
        item.id = this.id;
        item.tooltip = `Click to compare ${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''} with${
            GlyphChars.Ellipsis
        }`;

        return item;
    }

    @log()
    async setComparisonNotation(comparisonNotation: '...' | '..') {
        if (this._compareWith !== undefined) {
            await this.updateCompareWith({ ...this._compareWith, notation: comparisonNotation });
        }

        this._children = undefined;
        this.view.triggerNodeChange(this);
    }

    @log()
    async setComparisonType(comparisonType: Exclude<ViewShowBranchComparison, false>) {
        if (this._compareWith !== undefined) {
            await this.updateCompareWith({ ...this._compareWith, type: comparisonType });
        }

        this._children = undefined;
        this.view.triggerNodeChange(this);
    }

    private get comparisonNotation() {
        return (
            (this._compareWith && this._compareWith.notation) ||
            (Container.config.advanced.useSymmetricDifferenceNotation ? '...' : '..')
        );
    }

    private get diffComparisonNotation() {
        // In git diff the range syntax doesn't mean the same thing as with git log -- since git diff is about comparing endpoints not ranges
        // see https://git-scm.com/docs/git-diff#Documentation/git-diff.txt-emgitdiffemltoptionsgtltcommitgtltcommitgt--ltpathgt82308203
        // So inverting the range syntax should be about equivalent for the behavior we want
        return this.comparisonNotation === '...' ? '..' : '...';
    }

    private get comparisonType() {
        return (
            (this._compareWith && this._compareWith.type) ||
            this.view.config.showBranchComparison ||
            ViewShowBranchComparison.Working
        );
    }

    private get compareWithWorkingTree() {
        return this.comparisonType === ViewShowBranchComparison.Working;
    }

    private async compareWith() {
        const pick = await new ReferencesQuickPick(this.branch.repoPath).show(
            `Compare ${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''} with${GlyphChars.Ellipsis}`,
            { allowEnteringRefs: true, checked: this.branch.ref, checkmarks: true }
        );
        if (pick === undefined || pick instanceof CommandQuickPickItem) return;

        this.updateCompareWith({
            ref: pick.ref,
            notation: this.comparisonNotation,
            type: this.comparisonType
        });

        this._children = undefined;
        this.view.triggerNodeChange(this);
    }

    private async getCommitsQuery(maxCount: number | undefined): Promise<CommitsQueryResults> {
        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: maxCount,
            ref: `${(this._compareWith && this._compareWith.ref) || 'HEAD'}${this.comparisonNotation}${
                this.compareWithWorkingTree ? '' : this.branch.ref
            }`
        });

        const count = log !== undefined ? log.count : 0;
        const truncated = log !== undefined ? log.truncated : false;

        return {
            label: Strings.pluralize('commit', count, { number: truncated ? `${count}+` : undefined, zero: 'No' }),
            log: log
        };
    }

    private async getFilesQuery(): Promise<FilesQueryResults> {
        const diff = await Container.git.getDiffStatus(
            this.uri.repoPath!,
            `${(this._compareWith && this._compareWith.ref) || 'HEAD'}${this.diffComparisonNotation}${
                this.compareWithWorkingTree ? '' : this.branch.ref
            }`
        );

        return {
            label: `${Strings.pluralize('file', diff !== undefined ? diff.length : 0, { zero: 'No' })} changed`,
            diff: diff
        };
    }

    private async updateCompareWith(compareWith: BranchComparison | undefined) {
        this._compareWith = compareWith;

        let comparisons = Container.context.workspaceState.get<BranchComparisons>(WorkspaceState.BranchComparisons);
        if (comparisons === undefined) {
            comparisons = Object.create(null);
        }

        if (compareWith) {
            comparisons![this.branch.id] = { ...compareWith };
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [this.branch.id]: _, ...rest } = comparisons!;
            comparisons = rest;
        }
        await Container.context.workspaceState.update(WorkspaceState.BranchComparisons, comparisons);
    }
}

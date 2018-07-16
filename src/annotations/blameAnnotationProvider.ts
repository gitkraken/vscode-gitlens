'use strict';
import {
    CancellationToken,
    Disposable,
    Hover,
    HoverProvider,
    languages,
    Position,
    Range,
    TextDocument,
    TextEditor,
    TextEditorDecorationType
} from 'vscode';
import { Container } from '../container';
import { GitBlame, GitCommit, GitUri } from '../gitService';
import { Arrays, Iterables } from '../system';
import { GitDocumentState, TrackedDocument } from '../trackers/gitDocumentTracker';
import { AnnotationProviderBase } from './annotationProvider';
import { Annotations, ComputedHeatmap } from './annotations';

export abstract class BlameAnnotationProviderBase extends AnnotationProviderBase {
    protected _blame: Promise<GitBlame | undefined>;
    protected _hoverProviderDisposable: Disposable | undefined;
    protected readonly _uri: GitUri;

    constructor(
        editor: TextEditor,
        trackedDocument: TrackedDocument<GitDocumentState>,
        decoration: TextEditorDecorationType,
        highlightDecoration: TextEditorDecorationType | undefined
    ) {
        super(editor, trackedDocument, decoration, highlightDecoration);

        this._uri = trackedDocument.uri;
        this._blame = editor.document.isDirty
            ? Container.git.getBlameForFileContents(this._uri, editor.document.getText())
            : Container.git.getBlameForFile(this._uri);

        if (editor.document.isDirty) {
            trackedDocument.setForceDirtyStateChangeOnNextDocumentChange();
        }
    }

    async clear() {
        this._hoverProviderDisposable && this._hoverProviderDisposable.dispose();
        super.clear();
    }

    async onReset(changes?: {
        decoration: TextEditorDecorationType;
        highlightDecoration: TextEditorDecorationType | undefined;
    }) {
        if (this.editor !== undefined) {
            this._blame = this.editor.document.isDirty
                ? Container.git.getBlameForFileContents(this._uri, this.editor.document.getText())
                : Container.git.getBlameForFile(this._uri);
        }

        super.onReset(changes);
    }

    async selection(shaOrLine?: string | number, blame?: GitBlame) {
        if (!this.highlightDecoration) return;

        if (blame === undefined) {
            blame = await this._blame;
            if (!blame || !blame.lines.length) return;
        }

        let sha: string | undefined = undefined;
        if (typeof shaOrLine === 'string') {
            sha = shaOrLine;
        }
        else if (typeof shaOrLine === 'number') {
            if (shaOrLine >= 0) {
                const commitLine = blame.lines[shaOrLine];
                sha = commitLine && commitLine.sha;
            }
        }
        else {
            sha = Iterables.first(blame.commits.values()).sha;
        }

        if (!sha) {
            this.editor.setDecorations(this.highlightDecoration, []);
            return;
        }

        const highlightDecorationRanges = Arrays.filterMap(
            blame.lines,
            l =>
                l.sha === sha
                    ? this.editor.document.validateRange(new Range(l.line, 0, l.line, Number.MAX_SAFE_INTEGER))
                    : undefined
        );

        this.editor.setDecorations(this.highlightDecoration, highlightDecorationRanges);
    }

    async validate(): Promise<boolean> {
        const blame = await this._blame;
        return blame !== undefined && blame.lines.length !== 0;
    }

    protected async getBlame(): Promise<GitBlame | undefined> {
        const blame = await this._blame;
        if (blame === undefined || blame.lines.length === 0) return undefined;

        return blame;
    }

    protected getComputedHeatmap(blame: GitBlame): ComputedHeatmap {
        const dates = [];

        let commit;
        let previousSha;
        for (const l of blame.lines) {
            if (previousSha === l.sha) continue;
            previousSha = l.sha;

            commit = blame.commits.get(l.sha);
            if (commit === undefined) continue;

            dates.push(commit.date);
        }

        dates.sort((a, b) => a.getTime() - b.getTime());

        const half = Math.floor(dates.length / 2);
        const median =
            dates.length % 2 ? dates[half].getTime() : (dates[half - 1].getTime() + dates[half].getTime()) / 2.0;

        const lookup: number[] = [];

        const newest = dates[dates.length - 1].getTime();
        let step = (newest - median) / 5;
        for (let i = 5; i > 0; i--) {
            lookup.push(median + step * i);
        }

        lookup.push(median);

        const oldest = dates[0].getTime();
        step = (median - oldest) / 4;
        for (let i = 1; i <= 4; i++) {
            lookup.push(median - step * i);
        }

        const d = new Date();
        d.setDate(d.getDate() - (Container.config.heatmap.ageThreshold || 90));

        return {
            cold: newest < d.getTime(),
            colors: {
                cold: Container.config.heatmap.coldColor,
                hot: Container.config.heatmap.hotColor
            },
            median: median,
            newest: newest,
            oldest: oldest,
            computeAge: (date: Date) => {
                const time = date.getTime();
                let index = 0;
                for (let i = 0; i < lookup.length; i++) {
                    index = i;
                    if (time >= lookup[i]) break;
                }

                return index;
            }
        };
    }

    registerHoverProviders(providers: { details: boolean; changes: boolean }) {
        if (
            !Container.config.hovers.enabled ||
            !Container.config.hovers.annotations.enabled ||
            (!providers.details && !providers.changes)
        ) {
            return;
        }

        const subscriptions: Disposable[] = [];
        if (providers.changes) {
            subscriptions.push(
                languages.registerHoverProvider({ pattern: this.document.uri.fsPath }, {
                    provideHover: this.provideChangesHover.bind(this)
                } as HoverProvider)
            );
        }
        if (providers.details) {
            subscriptions.push(
                languages.registerHoverProvider({ pattern: this.document.uri.fsPath }, {
                    provideHover: this.provideDetailsHover.bind(this)
                } as HoverProvider)
            );
        }

        this._hoverProviderDisposable = Disposable.from(...subscriptions);
    }

    async provideDetailsHover(
        document: TextDocument,
        position: Position,
        token: CancellationToken
    ): Promise<Hover | undefined> {
        const commit = await this.getCommitForHover(position);
        if (commit === undefined) return undefined;

        // Get the full commit message -- since blame only returns the summary
        let logCommit: GitCommit | undefined = undefined;
        if (!commit.isUncommitted) {
            logCommit = await Container.git.getLogCommitForFile(commit.repoPath, commit.uri.fsPath, {
                ref: commit.sha
            });
            if (logCommit !== undefined) {
                // Preserve the previous commit from the blame commit
                logCommit.previousFileName = commit.previousFileName;
                logCommit.previousSha = commit.previousSha;
            }
        }

        const message = Annotations.getHoverMessage(
            logCommit || commit,
            Container.config.defaultDateFormat,
            await Container.git.getRemotes(commit.repoPath),
            this.annotationType,
            this.editor.selection.active.line
        );
        return new Hover(
            message,
            document.validateRange(new Range(position.line, 0, position.line, Number.MAX_SAFE_INTEGER))
        );
    }

    async provideChangesHover(
        document: TextDocument,
        position: Position,
        token: CancellationToken
    ): Promise<Hover | undefined> {
        const commit = await this.getCommitForHover(position);
        if (commit === undefined) return undefined;

        const hover = await Annotations.changesHover(commit, position.line, await GitUri.fromUri(document.uri));
        if (hover.hoverMessage === undefined) return undefined;

        return new Hover(
            hover.hoverMessage,
            document.validateRange(new Range(position.line, 0, position.line, Number.MAX_SAFE_INTEGER))
        );
    }

    private async getCommitForHover(position: Position): Promise<GitCommit | undefined> {
        if (Container.config.hovers.annotations.over !== 'line' && position.character !== 0) return undefined;

        const blame = await this.getBlame();
        if (blame === undefined) return undefined;

        const line = blame.lines[position.line];

        return blame.commits.get(line.sha);
    }
}

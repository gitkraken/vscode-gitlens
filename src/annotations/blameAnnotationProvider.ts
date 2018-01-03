'use strict';
import { Arrays, Iterables } from '../system';
import { CancellationToken, Disposable, ExtensionContext, Hover, HoverProvider, languages, Position, Range, TextDocument, TextEditor, TextEditorDecorationType } from 'vscode';
import { FileAnnotationType } from './annotationController';
import { AnnotationProviderBase } from './annotationProvider';
import { Annotations } from './annotations';
import { RangeEndOfLineIndex } from '../constants';
import { GitBlame, GitCommit, GitContextTracker, GitService, GitUri } from '../gitService';

export abstract class BlameAnnotationProviderBase extends AnnotationProviderBase {

    protected _blame: Promise<GitBlame | undefined>;
    protected _hoverProviderDisposable: Disposable;

    constructor(
        context: ExtensionContext,
        editor: TextEditor,
        gitContextTracker: GitContextTracker,
        decoration: TextEditorDecorationType | undefined,
        highlightDecoration: TextEditorDecorationType | undefined,
        protected readonly git: GitService,
        protected readonly uri: GitUri
    ) {
        super(context, editor, gitContextTracker, decoration, highlightDecoration);

        this._blame = editor.document.isDirty
            ? this.git.getBlameForFileContents(this.uri, editor.document.getText())
            : this.git.getBlameForFile(this.uri);
    }

    async clear() {
        this._hoverProviderDisposable && this._hoverProviderDisposable.dispose();
        super.clear();
    }

    async reset(changes?: { decoration: TextEditorDecorationType | undefined, highlightDecoration: TextEditorDecorationType | undefined }) {
        if (this.editor !== undefined) {
            this._blame = this.editor.document.isDirty
                ? this.git.getBlameForFileContents(this.uri, this.editor.document.getText())
                : this.git.getBlameForFile(this.uri);
        }

        super.reset(changes);
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

        const highlightDecorationRanges = Arrays.filterMap(blame.lines,
            l => l.sha === sha ? this.editor.document.validateRange(new Range(l.line, 0, l.line, RangeEndOfLineIndex)) : undefined);

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

    registerHoverProviders(providers: { details: boolean, changes: boolean }) {
        if (!providers.details && !providers.changes) return;

        const subscriptions: Disposable[] = [];
        if (providers.changes) {
            subscriptions.push(languages.registerHoverProvider({ pattern: this.document.uri.fsPath }, { provideHover: this.provideChangesHover.bind(this) } as HoverProvider));
        }
        if (providers.details) {
            subscriptions.push(languages.registerHoverProvider({ pattern: this.document.uri.fsPath }, { provideHover: this.provideDetailsHover.bind(this) } as HoverProvider));
        }

        this._hoverProviderDisposable = Disposable.from(...subscriptions);
    }

    async provideDetailsHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
        const commit = await this.getCommitForHover(position);
        if (commit === undefined) return undefined;

        // Get the full commit message -- since blame only returns the summary
        let logCommit: GitCommit | undefined = undefined;
        if (!commit.isUncommitted) {
            logCommit = await this.git.getLogCommit(commit.repoPath, commit.uri.fsPath, commit.sha);
            if (logCommit !== undefined) {
                // Preserve the previous commit from the blame commit
                logCommit.previousFileName = commit.previousFileName;
                logCommit.previousSha = commit.previousSha;
            }
        }

        const message = Annotations.getHoverMessage(logCommit || commit, this._config.defaultDateFormat, await this.git.hasRemote(commit.repoPath), this._config.blame.file.annotationType);
        return new Hover(message, document.validateRange(new Range(position.line, 0, position.line, RangeEndOfLineIndex)));
    }

    async provideChangesHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
        const commit = await this.getCommitForHover(position);
        if (commit === undefined) return undefined;

        const hover = await Annotations.changesHover(commit, position.line, await GitUri.fromUri(document.uri, this.git), this.git);
        return new Hover(hover.hoverMessage!, document.validateRange(new Range(position.line, 0, position.line, RangeEndOfLineIndex)));
    }

    private async getCommitForHover(position: Position): Promise<GitCommit | undefined> {
        const annotationType = this._config.blame.file.annotationType;
        const wholeLine = annotationType === FileAnnotationType.Hover || (annotationType === FileAnnotationType.Gutter && this._config.annotations.file.gutter.hover.wholeLine);
        if (!wholeLine && position.character !== 0) return undefined;

        const blame = await this.getBlame();
        if (blame === undefined) return undefined;

        const line = blame.lines[position.line];

        return blame.commits.get(line.sha);
    }
}
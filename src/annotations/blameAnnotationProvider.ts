'use strict';
import { Iterables } from '../system';
import { CancellationToken, Disposable, ExtensionContext, Hover, HoverProvider, languages, Position, Range, TextDocument, TextEditor, TextEditorDecorationType } from 'vscode';
import { AnnotationProviderBase } from './annotationProvider';
import { Annotations, endOfLineIndex } from './annotations';
import { GitBlame, GitCommit, GitService, GitUri } from '../gitService';

export abstract class BlameAnnotationProviderBase extends AnnotationProviderBase implements HoverProvider {

    protected _blame: Promise<GitBlame | undefined>;
    protected _hoverProviderDisposable: Disposable;

    constructor(
        context: ExtensionContext,
        editor: TextEditor,
        decoration: TextEditorDecorationType | undefined,
        highlightDecoration: TextEditorDecorationType | undefined,
        protected git: GitService,
        protected uri: GitUri
    ) {
        super(context, editor, decoration, highlightDecoration);

        this._blame = this.git.getBlameForFile(this.uri);
    }

    async clear() {
        this._hoverProviderDisposable && this._hoverProviderDisposable.dispose();
        super.clear();
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

        const highlightDecorationRanges = blame.lines
            .filter(l => l.sha === sha)
            .map(l => this.editor.document.validateRange(new Range(l.line, 0, l.line, 1000000)));

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

    registerHoverProvider() {
        this._hoverProviderDisposable = languages.registerHoverProvider({ pattern: this.document.uri.fsPath }, this);
    }

    async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
        // Avoid double annotations if we are showing the whole-file hover blame annotations
        if (this._config.blame.line.enabled && this.editor.selection.start.line === position.line) return undefined;

        const cfg = this._config.annotations.file.gutter;
        if (!cfg.hover.wholeLine && position.character !== 0) return undefined;

        const blame = await this.getBlame();
        if (blame === undefined) return undefined;

        const line = blame.lines[position.line];

        const commit = blame.commits.get(line.sha);
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

        const message = Annotations.getHoverMessage(logCommit || commit, this._config.defaultDateFormat, this.git.hasRemotes(commit.repoPath), this._config.blame.file.annotationType);
        return new Hover(message, document.validateRange(new Range(position.line, 0, position.line, endOfLineIndex)));
    }
}
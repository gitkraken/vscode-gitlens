'use strict';
import { Iterables } from '../system';
import { CancellationToken, Disposable, ExtensionContext, Hover, HoverProvider, languages, Position, Range, TextDocument, TextEditor, TextEditorDecorationType } from 'vscode';
import { AnnotationProviderBase } from './annotationProvider';
import { Annotations, endOfLineIndex } from './annotations';
import { GitBlame, GitCommit, GitService, GitUri } from '../gitService';
import { WhitespaceController } from './whitespaceController';

export abstract class BlameAnnotationProviderBase extends AnnotationProviderBase implements HoverProvider {

    protected _blame: Promise<GitBlame | undefined>;
    protected _hoverProviderDisposable: Disposable;

    constructor(context: ExtensionContext, editor: TextEditor, decoration: TextEditorDecorationType | undefined, highlightDecoration: TextEditorDecorationType | undefined, whitespaceController: WhitespaceController | undefined, protected git: GitService, protected uri: GitUri) {
        super(context, editor, decoration, highlightDecoration, whitespaceController);

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

        const offset = this.uri.offset;

        let sha: string | undefined = undefined;
        if (typeof shaOrLine === 'string') {
            sha = shaOrLine;
        }
        else if (typeof shaOrLine === 'number') {
            const line = shaOrLine - offset;
            if (line >= 0) {
                const commitLine = blame.lines[line];
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
            .map(l => this.editor.document.validateRange(new Range(l.line + offset, 0, l.line + offset, 1000000)));

        this.editor.setDecorations(this.highlightDecoration, highlightDecorationRanges);
    }

    async validate(): Promise<boolean> {
        const blame = await this._blame;
        return blame !== undefined && blame.lines.length !== 0;
    }

    protected async getBlame(requiresWhitespaceHack: boolean): Promise<GitBlame | undefined> {
        let whitespacePromise: Promise<void> | undefined;
        // HACK: Until https://github.com/Microsoft/vscode/issues/11485 is fixed -- override whitespace (turn off)
        if (requiresWhitespaceHack) {
            whitespacePromise = this.whitespaceController && this.whitespaceController.override();
        }

        let blame: GitBlame | undefined;
        if (whitespacePromise !== undefined) {
            [blame] = await Promise.all([this._blame, whitespacePromise]);
        }
        else {
            blame = await this._blame;
        }

        if (blame === undefined || blame.lines.length === 0) {
            this.whitespaceController && await this.whitespaceController.restore();
            return undefined;
        }

        return blame;
    }

    registerHoverProvider() {
        this._hoverProviderDisposable = languages.registerHoverProvider({ pattern: this.uri.fsPath }, this);
    }

    async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
        // Avoid double annotations if we are showing the whole-file hover blame annotations
        if (this._config.blame.line.enabled && this.editor.selection.start.line === position.line) return undefined;

        const cfg = this._config.annotations.file.gutter;
        if (!cfg.hover.wholeLine && position.character !== 0) return undefined;

        const blame = await this.getBlame(true);
        if (blame === undefined) return undefined;

        const line = blame.lines[position.line - this.uri.offset];

        const commit = blame.commits.get(line.sha);
        if (commit === undefined) return undefined;

        // Get the full commit message -- since blame only returns the summary
        let logCommit: GitCommit | undefined = undefined;
        if (!commit.isUncommitted) {
            logCommit = await this.git.getLogCommit(commit.repoPath, commit.uri.fsPath, commit.sha);
        }

        const message = Annotations.getHoverMessage(logCommit || commit, this._config.defaultDateFormat, this.git.hasRemotes(commit.repoPath));
        return new Hover(message, document.validateRange(new Range(position.line, 0, position.line, endOfLineIndex)));
    }
}
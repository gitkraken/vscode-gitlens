'use strict';
import { Iterables } from './system';
import { commands, DecorationOptions, Disposable, ExtensionContext, OverviewRulerLane, Range, TextDocument, TextEditor, TextEditorDecorationType, TextEditorSelectionChangeEvent, window, workspace } from 'vscode';
import { TextDocumentComparer } from './comparers';
import { BlameAnnotationStyle, IBlameConfig } from './configuration';
import { BuiltInCommands } from './constants';
import GitProvider, { GitCommit, GitUri, IGitBlame } from './gitProvider';
import { Logger } from './logger';
import * as moment from 'moment';

const blameDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    before: {
        margin: '0 1.75em 0 0'
    }
});

let highlightDecoration: TextEditorDecorationType;

export class BlameAnnotationProvider extends Disposable {
    public document: TextDocument;
    public requiresRenderWhitespaceToggle: boolean = false;

    private _blame: Promise<IGitBlame>;
    private _config: IBlameConfig;
    private _disposable: Disposable;
    private _uri: GitUri;

    constructor(context: ExtensionContext, private git: GitProvider, public editor: TextEditor) {
        super(() => this.dispose());

        if (!highlightDecoration) {
            highlightDecoration = window.createTextEditorDecorationType({
                dark: {
                    backgroundColor: 'rgba(255, 255, 255, 0.15)',
                    gutterIconPath: context.asAbsolutePath('images/blame-dark.png'),
                    overviewRulerColor: 'rgba(255, 255, 255, 0.75)'
                },
                light: {
                    backgroundColor: 'rgba(0, 0, 0, 0.15)',
                    gutterIconPath: context.asAbsolutePath('images/blame-light.png'),
                    overviewRulerColor: 'rgba(0, 0, 0, 0.75)'
                },
                gutterIconSize: 'contain',
                overviewRulerLane: OverviewRulerLane.Right,
                isWholeLine: true
            });
        }

        this.document = this.editor.document;
        this._uri = GitUri.fromUri(this.document.uri);
        this._blame = this.git.getBlameForFile(this._uri.fsPath, this._uri.sha, this._uri.repoPath);

        this._config = workspace.getConfiguration('gitlens').get<IBlameConfig>('blame');

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));
        subscriptions.push(window.onDidChangeTextEditorSelection(this._onActiveSelectionChanged, this));

        this._disposable = Disposable.from(...subscriptions);

        this._onConfigurationChanged();
    }

    async dispose(toggleRenderWhitespace: boolean = true) {
        if (this.editor) {
            this.editor.setDecorations(blameDecoration, []);
            this.editor.setDecorations(highlightDecoration, []);
        }

        // HACK: Until https://github.com/Microsoft/vscode/issues/11485 is fixed -- toggle whitespace back on
        if (toggleRenderWhitespace && this.requiresRenderWhitespaceToggle) {
            Logger.log('BlameAnnotationProvider.dispose:', `Toggle whitespace rendering on`);
            await commands.executeCommand(BuiltInCommands.ToggleRenderWhitespace);
        }

        this._disposable && this._disposable.dispose();
    }

    private _onConfigurationChanged() {
        const renderWhitespace = workspace.getConfiguration('editor').get<string>('renderWhitespace');
        this.requiresRenderWhitespaceToggle = !(renderWhitespace == null || renderWhitespace === 'none');
    }

    private async _onActiveSelectionChanged(e: TextEditorSelectionChangeEvent) {
        if (!TextDocumentComparer.equals(this.document, e.textEditor && e.textEditor.document)) return;

        return this.setSelection(e.selections[0].active.line);
    }

    async supportsBlame(): Promise<boolean> {
        const blame = await this._blame;
        return !!(blame && blame.lines.length);
    }

    async provideBlameAnnotation(shaOrLine?: string | number): Promise<boolean> {
        const blame = await this._blame;
        if (!blame || !blame.lines.length) return false;

        // HACK: Until https://github.com/Microsoft/vscode/issues/11485 is fixed -- toggle whitespace off
        if (this.requiresRenderWhitespaceToggle) {
            Logger.log('BlameAnnotationProvider.provideBlameAnnotation:', `Toggle whitespace rendering off`);
            await commands.executeCommand(BuiltInCommands.ToggleRenderWhitespace);
        }

        let blameDecorationOptions: DecorationOptions[] | undefined;
        switch (this._config.annotation.style) {
            case BlameAnnotationStyle.Compact:
                blameDecorationOptions = this._getCompactGutterDecorations(blame);
                break;
            case BlameAnnotationStyle.Expanded:
                blameDecorationOptions = this._getExpandedGutterDecorations(blame);
                break;
        }

        if (blameDecorationOptions) {
            this.editor.setDecorations(blameDecoration, blameDecorationOptions);
        }

        this._setSelection(blame, shaOrLine);
        return true;
    }

    async setSelection(shaOrLine?: string | number) {
        const blame = await this._blame;
        if (!blame || !blame.lines.length) return;

        return this._setSelection(blame, shaOrLine);
    }

    private _setSelection(blame: IGitBlame, shaOrLine?: string | number) {
        const offset = this._uri.offset;

        let sha: string;
        if (typeof shaOrLine === 'string') {
            sha = shaOrLine;
        }
        else if (typeof shaOrLine === 'number') {
            const line = shaOrLine - offset;
            if (line >= 0) {
                sha = blame.lines[line].sha;
            }
        }
        else {
            sha = Iterables.first(blame.commits.values()).sha;
        }

        if (!sha) {
            this.editor.setDecorations(highlightDecoration, []);
            return;
        }

        const highlightDecorationRanges = blame.lines
            .filter(l => l.sha === sha)
            .map(l => this.editor.document.validateRange(new Range(l.line + offset, 0, l.line + offset, 1000000)));

        this.editor.setDecorations(highlightDecoration, highlightDecorationRanges);
    }

    private _getCompactGutterDecorations(blame: IGitBlame): DecorationOptions[] {
        const offset = this._uri.offset;

        let count = 0;
        let lastSha: string;
        return blame.lines.map(l => {
            let color = l.previousSha ? '#999999' : '#6b6b6b';
            let commit = blame.commits.get(l.sha);
            let hoverMessage: string | Array<string> = [`_${l.sha}_ - ${commit.message}`, `${commit.author}, ${moment(commit.date).format('MMMM Do, YYYY h:MMa')}`];

            if (commit.isUncommitted) {
                color = 'rgba(0, 188, 242, 0.6)';

                let previous = blame.commits.get(commit.previousSha);
                if (previous) {
                    hoverMessage = ['Uncommitted changes', `_${previous.sha}_ - ${previous.message}`, `${previous.author}, ${moment(previous.date).format('MMMM Do, YYYY h:MMa')}`];
                }
                else {
                    hoverMessage = ['Uncommitted changes', `_${l.previousSha}_`];
                }
            }

            let gutter = '';
            if (lastSha !== l.sha) {
                count = -1;
            }

            const isEmptyOrWhitespace = this.document.lineAt(l.line).isEmptyOrWhitespace;
            if (!isEmptyOrWhitespace) {
                switch (++count) {
                    case 0:
                        gutter = commit.sha.substring(0, 8);
                        break;
                    case 1:
                        gutter = `\\00a6\\00a0 ${this._getAuthor(commit, 17, true)}`;
                        break;
                    case 2:
                        gutter = `\\00a6\\00a0 ${this._getDate(commit, true)}`;
                        break;
                    default:
                        gutter = '\\00a6\\00a0';
                        break;
                }
            }

            lastSha = l.sha;

            return <DecorationOptions>{
                range: this.editor.document.validateRange(new Range(l.line + offset, 0, l.line + offset, 0)),
                hoverMessage: hoverMessage,
                renderOptions: { before: { color: color, contentText: gutter, width: '11em' } }
            };
        });
    }

    private _getExpandedGutterDecorations(blame: IGitBlame): DecorationOptions[] {
        const offset = this._uri.offset;

        let width = 0;
        if (this._config.annotation.sha) {
            width += 5;
        }
        if (this._config.annotation.date) {
            if (width > 0) {
                width += 7;
            }
            else {
                width += 6;
            }
        }
        if (this._config.annotation.author) {
            if (width > 5 + 6) {
                width += 12;
            }
            else if (width > 0) {
                width += 11;
            }
            else {
                width += 10;
            }
        }

        return blame.lines.map(l => {
            let color = l.previousSha ? '#999999' : '#6b6b6b';
            let commit = blame.commits.get(l.sha);
            let hoverMessage: string | Array<string> = [`_${l.sha}_ - ${commit.message}`, `${commit.author}, ${moment(commit.date).format('MMMM Do, YYYY h:MMa')}`];

            if (commit.isUncommitted) {
                color = 'rgba(0, 188, 242, 0.6)';

                let previous = blame.commits.get(commit.previousSha);
                if (previous) {
                    hoverMessage = ['Uncommitted changes', `_${previous.sha}_ - ${previous.message}`, `${previous.author}, ${moment(previous.date).format('MMMM Do, YYYY h:MMa')}`];
                }
                else {
                    hoverMessage = ['Uncommitted changes', `_${l.previousSha}_`];
                }
            }

            const gutter = this._getGutter(commit);
            return <DecorationOptions>{
                range: this.editor.document.validateRange(new Range(l.line + offset, 0, l.line + offset, 0)),
                hoverMessage: hoverMessage,
                renderOptions: { before: { color: color, contentText: gutter, width: `${width}em` } }
            };
        });
    }

    private _getAuthor(commit: GitCommit, max: number = 17, force: boolean = false) {
        if (!force && !this._config.annotation.author) return '';
        let author = commit.isUncommitted ? 'Uncommitted' : commit.author;
        if (author.length > max) {
            return `${author.substring(0, max - 1)}\\2026`;
        }
        return author;
    }

    private _getDate(commit: GitCommit, force?: boolean) {
        if (!force && !this._config.annotation.date) return '';
        return moment(commit.date).format('MM/DD/YYYY');
    }

    private _getGutter(commit: GitCommit) {
        const author = this._getAuthor(commit);
        const date = this._getDate(commit);
        if (this._config.annotation.sha) {
            return `${commit.sha.substring(0, 8)}${(date ? `\\00a0\\2022\\00a0 ${date}` : '')}${(author ? `\\00a0\\2022\\00a0 ${author}` : '')}`;
        }
        else if (this._config.annotation.date) {
            return `${date}${(author ? `\\00a0\\2022\\00a0 ${author}` : '')}`;
        }
        else {
            return author;
        }
    }
}
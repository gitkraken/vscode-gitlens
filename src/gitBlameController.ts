'use strict'
import {commands, DecorationInstanceRenderOptions, DecorationOptions, Diagnostic, DiagnosticCollection, DiagnosticSeverity, Disposable, ExtensionContext, languages, OverviewRulerLane, Position, Range, TextDocument, TextEditor, TextEditorDecorationType, Uri, window, workspace} from 'vscode';
import {BuiltInCommands, Commands, DocumentSchemes} from './constants';
import {BlameAnnotationStyle, IBlameConfig} from './configuration';
import GitProvider, {IGitBlame, IGitCommit} from './gitProvider';
import GitCodeActionsProvider from './gitCodeActionProvider';
import {DiagnosticCollectionName, DiagnosticSource} from './constants';
import * as moment from 'moment';

const blameDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    before: {
        margin: '0 1.75em 0 0'
    }
});
let highlightDecoration: TextEditorDecorationType;

export default class GitBlameController extends Disposable {
    private _controller: GitBlameEditorController;
    private _disposable: Disposable;

    private _blameDecoration: TextEditorDecorationType;
    private _highlightDecoration: TextEditorDecorationType;

    constructor(private context: ExtensionContext, private git: GitProvider) {
        super(() => this.dispose());

        if (!highlightDecoration) {
            highlightDecoration = window.createTextEditorDecorationType({
                dark: {
                    backgroundColor: 'rgba(255, 255, 255, 0.15)',
                    gutterIconPath: context.asAbsolutePath('images/blame-dark.png'),
                    overviewRulerColor: 'rgba(255, 255, 255, 0.75)',
                },
                light: {
                    backgroundColor: 'rgba(0, 0, 0, 0.15)',
                    gutterIconPath: context.asAbsolutePath('images/blame-light.png'),
                    overviewRulerColor: 'rgba(0, 0, 0, 0.75)',
                },
                gutterIconSize: 'contain',
                overviewRulerLane: OverviewRulerLane.Right,
                isWholeLine: true
            });
        }

        const subscriptions: Disposable[] = [];

        // subscriptions.push(window.onDidChangeActiveTextEditor(e => {
        //     if (!e || !this._controller || this._controller.editor === e) return;
        //     this.clear();
        // }));

        workspace.onDidCloseTextDocument(d => {
            if (!this._controller || this._controller.uri.toString() !== d.uri.toString()) return;
            this.clear();
        })

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this.clear();
        this._disposable && this._disposable.dispose();
    }

    clear() {
        this._controller && this._controller.dispose();
        this._controller = null;
    }

    showBlame(editor: TextEditor, sha?: string) {
        if (!editor) {
            this.clear();
            return;
        }

        if (!this._controller) {
            this._controller = new GitBlameEditorController(this.context, this.git, editor);
            return this._controller.applyBlame(sha);
        }
    }

    toggleBlame(editor: TextEditor, sha?: string) {
        if (!editor || this._controller) {
            this.clear();
            return;
        }

        return this.showBlame(editor, sha);
    }
}

class GitBlameEditorController extends Disposable {
    public uri: Uri;

    private _blame: Promise<IGitBlame>;
    private _config: IBlameConfig;
    private _diagnostics: DiagnosticCollection;
    private _disposable: Disposable;
    private _document: TextDocument;
    private _toggleWhitespace: boolean;

    constructor(private context: ExtensionContext, private git: GitProvider, public editor: TextEditor) {
        super(() => this.dispose());

        this._document = this.editor.document;
        this.uri = this._document.uri;
        const fileName = this.uri.fsPath;

        this._blame = this.git.getBlameForFile(fileName);

        this._config = workspace.getConfiguration('gitlens').get<IBlameConfig>('blame');

        const subscriptions: Disposable[] = [];

        if (this._config.annotation.useCodeActions) {
            this._diagnostics = languages.createDiagnosticCollection(DiagnosticCollectionName);
            subscriptions.push(this._diagnostics);

            subscriptions.push(languages.registerCodeActionsProvider(GitCodeActionsProvider.selector, new GitCodeActionsProvider(this.context, this.git)));
        }

        subscriptions.push(window.onDidChangeTextEditorSelection(e => {
            const activeLine = e.selections[0].active.line;

            this._diagnostics && this._diagnostics.clear();

            this.git.getBlameForLine(e.textEditor.document.fileName, activeLine)
                .then(blame => {
                    if (!blame) return;

                    // Add the bogus diagnostics to provide code actions for this sha
                    this._diagnostics && this._diagnostics.set(editor.document.uri, [this._getDiagnostic(editor, activeLine, blame.commit.sha)]);

                    this.applyHighlight(blame.commit.sha);
                });
        }));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        if (this.editor) {
            // HACK: This only works when switching to another editor - diffs handle whitespace toggle differently
            if (this._toggleWhitespace) {
                commands.executeCommand(BuiltInCommands.ToggleRenderWhitespace);
            }

            this.editor.setDecorations(blameDecoration, []);
            this.editor.setDecorations(highlightDecoration, []);
            this.editor = null;
        }

        this._disposable && this._disposable.dispose();
    }

    _getDiagnostic(editor, line, sha) {
        const diag = new Diagnostic(editor.document.validateRange(new Range(line, 0, line, 1000000)), `Diff commit ${sha}`, DiagnosticSeverity.Hint);
        diag.source = DiagnosticSource;
        return diag;
    }

    applyBlame(sha?: string) {
        return this._blame.then(blame => {
            if (!blame || !blame.lines.length) return;

            // HACK: Until https://github.com/Microsoft/vscode/issues/11485 is fixed -- toggle whitespace off
            const whitespace = workspace.getConfiguration('editor').get<string>('renderWhitespace');
            this._toggleWhitespace = whitespace !== 'false' && whitespace !== 'none';
            if (this._toggleWhitespace) {
                commands.executeCommand(BuiltInCommands.ToggleRenderWhitespace);
            }

            let blameDecorationOptions: DecorationOptions[]
            switch (this._config.annotation.style) {
                case BlameAnnotationStyle.Compact:
                    blameDecorationOptions = this._getCompactGutterDecorations(blame);
                    break;
                case BlameAnnotationStyle.Expanded:
                    blameDecorationOptions = this._getExpandedGutterDecorations(blame);
                    break;
            }
            this.editor.setDecorations(blameDecoration, blameDecorationOptions);

            sha = sha || blame.commits.values().next().value.sha;

            if (this._diagnostics) {
                // Add the bogus diagnostics to provide code actions for this sha
                const activeLine = this.editor.selection.active.line;
                this._diagnostics.clear();
                this._diagnostics.set(this.editor.document.uri, [this._getDiagnostic(this.editor, activeLine, sha)]);
            }

            return this.applyHighlight(sha);
        });
    }

    _getCompactGutterDecorations(blame: IGitBlame): DecorationOptions[] {
        let count = 0;
        let lastSha;
        return blame.lines.map(l => {
            let color = l.previousSha ? '#999999' : '#6b6b6b';
            let commit = blame.commits.get(l.sha);
            let hoverMessage: string | Array<string> = [commit.message, `${commit.author}, ${moment(commit.date).format('MMMM Do, YYYY hh:MM a')}`];

            if (l.sha.startsWith('00000000')) {
                color = 'rgba(0, 188, 242, 0.6)';
                hoverMessage = '';
            }

            let gutter = '';
            if (lastSha !== l.sha) {
                count = -1;
            }

            const isEmptyOrWhitespace = this._document.lineAt(l.line).isEmptyOrWhitespace;
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
                range: this.editor.document.validateRange(new Range(l.line, 0, l.line, 0)),
                hoverMessage: [`_${l.sha}_: ${commit.message}`, `${commit.author}, ${moment(commit.date).format('MMMM Do, YYYY hh:MM a')}`],
                renderOptions: { before: { color: color, contentText: gutter, width: '11em' } }
            };
        });
    }

    _getExpandedGutterDecorations(blame: IGitBlame): DecorationOptions[] {
        let width = 0;
        if (this._config.annotation.sha) {
            width += 5;
        }
        if (this._config.annotation.date) {
            if (width > 0) {
                width += 7;
            } else {
                width += 6;
            }
        }
        if (this._config.annotation.author) {
            if (width > 5 + 6) {
                width += 12;
            } else if (width > 0) {
                width += 11;
            } else {
                width += 10;
            }
        }

        return blame.lines.map(l => {
            let color = l.previousSha ? '#999999' : '#6b6b6b';
            let commit = blame.commits.get(l.sha);
            let hoverMessage: string | Array<string> = [commit.message, `${commit.author}, ${moment(commit.date).format('MMMM Do, YYYY hh:MM a')}`];

            if (l.sha.startsWith('00000000')) {
                color = 'rgba(0, 188, 242, 0.6)';
                hoverMessage = '';
            }

            const gutter = this._getGutter(commit);
            return <DecorationOptions>{
                range: this.editor.document.validateRange(new Range(l.line, 0, l.line, 0)),
                hoverMessage: hoverMessage,
                renderOptions: { before: { color: color, contentText: gutter, width: `${width}em` } }
            };
        });
    }

    _getAuthor(commit: IGitCommit, max: number = 17, force: boolean = false) {
        if (!force && !this._config.annotation.author) return '';
        if (commit.author.length > max) {
            return `${commit.author.substring(0, max - 1)}\\2026`;
        }
        return commit.author;
    }

    _getDate(commit: IGitCommit, force?: boolean) {
        if (!force && !this._config.annotation.date) return '';
        return moment(commit.date).format('MM/DD/YYYY');
    }

    _getGutter(commit: IGitCommit) {
        const author = this._getAuthor(commit);
        const date = this._getDate(commit);
        if (this._config.annotation.sha) {
            return `${commit.sha.substring(0, 8)}${(date ? `\\00a0\\2022\\00a0 ${date}` : '')}${(author ? `\\00a0\\2022\\00a0 ${author}` : '')}`;
        } else if (this._config.annotation.date) {
            return `${date}${(author ? `\\00a0\\2022\\00a0 ${author}` : '')}`;
        } else {
            return author;
        }
    }

    applyHighlight(sha: string) {
        return this._blame.then(blame => {
            if (!blame || !blame.lines.length) return;

            const highlightDecorationRanges = blame.lines
                .filter(l => l.sha === sha)
                .map(l => this.editor.document.validateRange(new Range(l.line, 0, l.line, 1000000)));

            this.editor.setDecorations(highlightDecoration, highlightDecorationRanges);
        });
    }
}
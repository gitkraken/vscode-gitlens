'use strict'
import {commands, DecorationOptions, Disposable, ExtensionContext, OverviewRulerLane, Range, TextDocument, TextEditor, TextEditorDecorationType, TextEditorSelectionChangeEvent, Uri, window, workspace} from 'vscode';
import {BuiltInCommands, Commands, DocumentSchemes} from './constants';
import {BlameAnnotationStyle, IBlameConfig} from './configuration';
import GitProvider, {IGitBlame, IGitCommit} from './gitProvider';
import * as moment from 'moment';

const blameDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    before: {
        margin: '0 1.75em 0 0'
    }
});
let highlightDecoration: TextEditorDecorationType;

export default class BlameAnnotationController extends Disposable {
    private _disposable: Disposable;
    private _editorController: EditorBlameAnnotationController|null;

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
            if (!this._editorController || this._editorController.uri.toString() !== d.uri.toString()) return;
            this.clear();
        })

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this.clear();
        this._disposable && this._disposable.dispose();
    }

    clear() {
        this._editorController && this._editorController.dispose();
        this._editorController = null;
    }

    showBlameAnnotation(editor: TextEditor, sha?: string) {
        if (!editor || !editor.document || editor.document.isUntitled) {
            this.clear();
            return;
        }

        if (!this._editorController) {
            this._editorController = new EditorBlameAnnotationController(this.context, this.git, editor);
            return this._editorController.applyBlameAnnotation(sha);
        }
    }

    toggleBlameAnnotation(editor: TextEditor, sha?: string) {
        if (!editor ||!editor.document || editor.document.isUntitled || this._editorController) {
            this.clear();
            return;
        }

        return this.showBlameAnnotation(editor, sha);
    }
}

class EditorBlameAnnotationController extends Disposable {
    public uri: Uri;

    private _blame: Promise<IGitBlame>;
    private _config: IBlameConfig;
    private _disposable: Disposable;
    private _document: TextDocument;
    private _toggleWhitespace: boolean;

    constructor(private context: ExtensionContext, private git: GitProvider, public editor: TextEditor) {
        super(() => this.dispose());

        this._document = this.editor.document;
        this.uri = this._document.uri;

        this._blame = this.git.getBlameForFile(this.uri.fsPath);

        this._config = workspace.getConfiguration('gitlens').get<IBlameConfig>('blame');

        const subscriptions: Disposable[] = [];

        subscriptions.push(window.onDidChangeTextEditorSelection(this._onActiveSelectionChanged, this));

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
        }

        this._disposable && this._disposable.dispose();
    }

    private _onActiveSelectionChanged(e: TextEditorSelectionChangeEvent) {
        this.git.getBlameForLine(e.textEditor.document.fileName, e.selections[0].active.line)
            .then(blame => blame && this.applyHighlight(blame.commit.sha));
    }

    applyBlameAnnotation(sha?: string) {
        return this._blame.then(blame => {
            if (!blame || !blame.lines.length) return;

            // HACK: Until https://github.com/Microsoft/vscode/issues/11485 is fixed -- toggle whitespace off
            const whitespace = workspace.getConfiguration('editor').get<string>('renderWhitespace');
            this._toggleWhitespace = whitespace !== 'false' && whitespace !== 'none';
            if (this._toggleWhitespace) {
                commands.executeCommand(BuiltInCommands.ToggleRenderWhitespace);
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

            sha = sha || blame.commits.values().next().value.sha;

            return this.applyHighlight(sha);
        });
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

    private _getCompactGutterDecorations(blame: IGitBlame): DecorationOptions[] {
        let count = 0;
        let lastSha;
        return blame.lines.map(l => {
            let color = l.previousSha ? '#999999' : '#6b6b6b';
            let commit = blame.commits.get(l.sha);
            let hoverMessage: string | Array<string> = [`_${l.sha}_: ${commit.message}`, `${commit.author}, ${moment(commit.date).format('MMMM Do, YYYY hh:MM a')}`];

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

    private _getExpandedGutterDecorations(blame: IGitBlame): DecorationOptions[] {
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

    private _getAuthor(commit: IGitCommit, max: number = 17, force: boolean = false) {
        if (!force && !this._config.annotation.author) return '';
        if (commit.author.length > max) {
            return `${commit.author.substring(0, max - 1)}\\2026`;
        }
        return commit.author;
    }

    private _getDate(commit: IGitCommit, force?: boolean) {
        if (!force && !this._config.annotation.date) return '';
        return moment(commit.date).format('MM/DD/YYYY');
    }

    private _getGutter(commit: IGitCommit) {
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
}
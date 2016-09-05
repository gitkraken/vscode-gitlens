'use strict'
import {commands, DecorationOptions, Diagnostic, DiagnosticCollection, DiagnosticSeverity, Disposable, ExtensionContext, languages, OverviewRulerLane, Position, Range, TextEditor, TextEditorDecorationType, Uri, window, workspace} from 'vscode';
import {Commands, DocumentSchemes, VsCodeCommands} from './constants';
import GitProvider, {IGitBlame} from './gitProvider';
import GitCodeActionsProvider from './gitCodeActionProvider';
import {DiagnosticCollectionName, DiagnosticSource} from './constants';
import * as moment from 'moment';

const blameDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    before: {
        color: '#5a5a5a',
        margin: '0 1em 0 0',
        width: '5em'
    },
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

        subscriptions.push(window.onDidChangeActiveTextEditor(e => {
            if (!this._controller || this._controller.editor === e) return;
            this.clear();
        }));

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

    showBlame(editor: TextEditor, sha: string) {
        if (!editor) {
            this.clear();
            return;
        }

        if (!this._controller) {
            this._controller = new GitBlameEditorController(this.context, this.git, editor);
            return this._controller.applyBlame(sha);
        }
    }

    toggleBlame(editor: TextEditor, sha: string) {
        if (!editor || this._controller) {
            this.clear();
            return;
        }

        return this.showBlame(editor, sha);
    }
}

class GitBlameEditorController extends Disposable {
    private _disposable: Disposable;
    private _blame: Promise<IGitBlame>;
    private _diagnostics: DiagnosticCollection;

    constructor(private context: ExtensionContext, private git: GitProvider, public editor: TextEditor) {
        super(() => this.dispose());

        const fileName = this.editor.document.uri.path;
        this._blame = this.git.getBlameForFile(fileName);

        const subscriptions: Disposable[] = [];

        this._diagnostics = languages.createDiagnosticCollection(DiagnosticCollectionName);
        subscriptions.push(this._diagnostics);

        subscriptions.push(languages.registerCodeActionsProvider(GitCodeActionsProvider.selector, new GitCodeActionsProvider(this.context, this.git)));

        subscriptions.push(window.onDidChangeTextEditorSelection(e => {
            const activeLine = e.selections[0].active.line;

            this._diagnostics.clear();

            this.git.getBlameForLine(e.textEditor.document.fileName, activeLine)
                .then(blame => {
                    // Add the bogus diagnostics to provide code actions for this sha
                    this._diagnostics.set(editor.document.uri, [this._getDiagnostic(editor, activeLine, blame.commit.sha)]);

                    this.applyHighlight(blame.commit.sha);
                });
        }));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        if (this.editor) {
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

    applyBlame(sha: string) {
        return this._blame.then(blame => {
            if (!blame.lines.length) return;

            const blameDecorationOptions: DecorationOptions[] = blame.lines.map(l => {
                const c = blame.commits.get(l.sha);
                return {
                    range: this.editor.document.validateRange(new Range(l.line, 0, l.line, 0)),
                    hoverMessage: `${c.message}\n${c.author}, ${moment(c.date).format('MMMM Do, YYYY hh:MM a')}`,
                    renderOptions: { before: { contentText: `${l.sha.substring(0, 8)}`, } }
                };
            });

            this.editor.setDecorations(blameDecoration, blameDecorationOptions);

            sha = sha || blame.commits.values().next().value.sha;

            // Add the bogus diagnostics to provide code actions for this sha
            const activeLine = this.editor.selection.active.line;
            this._diagnostics.clear();
            this._diagnostics.set(this.editor.document.uri, [this._getDiagnostic(this.editor, activeLine, sha)]);

            return this.applyHighlight(sha);
        });
    }

    applyHighlight(sha: string) {
        return this._blame.then(blame => {
            if (!blame.lines.length) return;

            const highlightDecorationRanges = blame.lines
                .filter(l => l.sha === sha)
                .map(l => this.editor.document.validateRange(new Range(l.line, 0, l.line, 1000000)));

            this.editor.setDecorations(highlightDecoration, highlightDecorationRanges);
        });
    }
}
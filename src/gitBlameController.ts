'use strict'
import {commands, DecorationOptions, Disposable, ExtensionContext, languages, OverviewRulerLane, Position, Range, TextEditor, TextEditorDecorationType, Uri, window, workspace} from 'vscode';
import {Commands, DocumentSchemes, VsCodeCommands} from './constants';
import GitProvider, {IGitBlame} from './gitProvider';
import {basename} from 'path';
import * as moment from 'moment';

export default class GitBlameController extends Disposable {
    private _controller: GitBlameEditorController;
    private _subscription: Disposable;

    private _blameDecoration: TextEditorDecorationType;
    private _highlightDecoration: TextEditorDecorationType;

    constructor(context: ExtensionContext, private git: GitProvider) {
        super(() => this.dispose());

        this._blameDecoration = window.createTextEditorDecorationType({
                before: {
                    color: '#5a5a5a',
                    margin: '0 1em 0 0',
                    width: '5em'
                },
        });

        this._highlightDecoration= window.createTextEditorDecorationType({
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

        this._subscription = Disposable.from(window.onDidChangeActiveTextEditor(e => {
            if (!this._controller || this._controller.editor === e) return;
            this.clear();
        }));
    }

    dispose() {
        this.clear();
        this._subscription && this._subscription.dispose();
    }

    clear() {
        this._controller && this._controller.dispose();
        this._controller = null;
    }

    toggleBlame(editor: TextEditor, sha: string) {
        if (editor && (this._controller && this._controller.sha !== sha)) {
            this._controller.applyHighlight(sha);
            return;
        }

        const controller = this._controller;
        this.clear();

        if (!editor || (controller && controller.sha === sha)) {
            return;
        }

        this._controller = new GitBlameEditorController(this.git, this._blameDecoration, this._highlightDecoration, editor, sha);
        return this._controller.applyBlame(sha);
    }
}

class GitBlameEditorController extends Disposable {
    private _subscription: Disposable;
    private _blame: Promise<IGitBlame>;
    private _commits: Promise<Map<string, string>>;

    constructor(private git: GitProvider, private blameDecoration: TextEditorDecorationType, private highlightDecoration: TextEditorDecorationType, public editor: TextEditor, public sha: string) {
        super(() => this.dispose());

        const fileName = this.editor.document.uri.path;
        this._blame = this.git.getBlameForFile(fileName);
        this._commits = this.git.getCommitMessages(fileName);

        this._subscription = Disposable.from(window.onDidChangeTextEditorSelection(e => {
            const activeLine = e.selections[0].active.line;
            this.git.getBlameForLine(e.textEditor.document.fileName, activeLine)
                .then(blame => this.applyHighlight(blame.commit.sha));
        }));
    }

    dispose() {
        if (this.editor) {
            this.editor.setDecorations(this.blameDecoration, []);
            this.editor.setDecorations(this.highlightDecoration, []);
            this.editor = null;
        }

        this._subscription && this._subscription.dispose();
    }

    applyBlame(sha: string) {
        return this._blame.then(blame => {
            if (!blame.lines.length) return;

            return this._commits.then(msgs => {
                const commits = Array.from(blame.commits.values());
                commits.forEach(c => c.message = msgs.get(c.sha.substring(0, c.sha.length - 1)));

                const blameDecorationOptions: DecorationOptions[] = blame.lines.map(l => {
                    const c = blame.commits.get(l.sha);
                    return {
                        range: this.editor.document.validateRange(new Range(l.line, 0, l.line, 0)),
                        hoverMessage: `${c.message}\n${c.author}, ${moment(c.date).format('MMMM Do, YYYY hh:MM a')}`,
                        renderOptions: { before: { contentText: `${l.sha}`, } }
                    };
                });

                this.editor.setDecorations(this.blameDecoration, blameDecorationOptions);
                return this.applyHighlight(sha || commits[0].sha);
            });
        });
    }

    applyHighlight(sha: string) {
        this.sha = sha;
        return this._blame.then(blame => {
            if (!blame.lines.length) return;

            const highlightDecorationRanges = blame.lines
                .filter(l => l.sha === sha)
                .map(l => this.editor.document.validateRange(new Range(l.line, 0, l.line, 1000000)));

            this.editor.setDecorations(this.highlightDecoration, highlightDecorationRanges);
        });
    }
}
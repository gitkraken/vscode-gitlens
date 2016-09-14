'use strict';
import {Disposable, EventEmitter, ExtensionContext, OverviewRulerLane, Range, TextEditor, TextEditorDecorationType, TextDocumentContentProvider, Uri, window, workspace} from 'vscode';
import {DocumentSchemes, WorkspaceState} from './constants';
import GitProvider, {IGitBlameUriData} from './gitProvider';
import * as moment from 'moment';

export default class GitBlameContentProvider implements TextDocumentContentProvider {
    static scheme = DocumentSchemes.GitBlame;

    private _blameDecoration: TextEditorDecorationType;
    private _onDidChange = new EventEmitter<Uri>();
    //private _subscriptions: Disposable;

    constructor(context: ExtensionContext, private git: GitProvider) {
        this._blameDecoration = window.createTextEditorDecorationType({
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

        //this._subscriptions = Disposable.from(
        //     window.onDidChangeActiveTextEditor(e => e ? console.log(e.document.uri) : console.log('active missing')),
        //);
    }

    dispose() {
        this._onDidChange.dispose();
        //this._subscriptions && this._subscriptions.dispose();
    }

    get onDidChange() {
        return this._onDidChange.event;
    }

    public update(uri: Uri) {
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: Uri): string | Thenable<string> {
        const data = this.git.fromBlameUri(uri);

        //const editor = this._findEditor(Uri.file(join(data.repoPath, data.file)));

        return this.git.getVersionedFileText(data.originalFileName || data.fileName, data.sha).then(text => {
            this.update(uri);

            // TODO: This only works on the first load -- not after since it is cached
            this._tryAddBlameDecorations(uri, data);

            // TODO: This needs to move to selection somehow to show on the main file editor
            //this._addBlameDecorations(editor, data);

            return text;
        });

        // return this.git.getVersionedFile(data.fileName, data.sha).then(dst => {
        //     let uri = Uri.parse(`file:${dst}`)
        //     return workspace.openTextDocument(uri).then(doc => {
        //         this.update(uri);
        //         return doc.getText();
        //     });
        // });
    }

    private _findEditor(uri: Uri): TextEditor {
        let uriString = uri.toString();
        // TODO: This is a big hack :)
        const matcher = (e: any) => (e && e._documentData && e._documentData._uri && e._documentData._uri.toString()) === uriString;
        if (matcher(window.activeTextEditor)) {
            return window.activeTextEditor;
        }
        return window.visibleTextEditors.find(matcher);
    }

    private _tryAddBlameDecorations(uri: Uri, data: IGitBlameUriData) {
        // Needs to be on a timer for some reason because we won't find the editor otherwise -- is there an event?
        let handle = setInterval(() => {
            let editor = this._findEditor(uri);
            if (!editor) return;

            clearInterval(handle);
            this.git.getBlameForShaRange(data.fileName, data.sha, data.range).then(blame => {
                if (!blame || !blame.lines.length) return;

                editor.setDecorations(this._blameDecoration, blame.lines.map(l => {
                    return {
                        range: editor.document.validateRange(new Range(l.originalLine, 0, l.originalLine, 1000000)),
                        hoverMessage: `${blame.commit.message}\n${blame.commit.author}\n${moment(blame.commit.date).format('MMMM Do, YYYY hh:MM a')}\n${l.sha}`
                    };
                }));
            });
        }, 200);
    }

    // private _addBlameDecorations(editor: TextEditor, data: IGitBlameUriData) {
    //     editor.setDecorations(this._blameDecoration, data.lines.map(l => editor.document.validateRange(new Range(l.line, 0, l.line, 1000000))));
    // }
}
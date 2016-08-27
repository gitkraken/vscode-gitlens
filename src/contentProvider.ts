'use strict';
import {Disposable, EventEmitter, ExtensionContext, OverviewRulerLane, Range, TextEditor, TextEditorDecorationType, TextDocumentContentProvider, Uri, window, workspace} from 'vscode';
import {DocumentSchemes} from './constants';
import {gitGetVersionText} from './git';
import {fromGitBlameUri, IGitBlameUriData} from './gitBlameUri';
import * as moment from 'moment';

export default class GitBlameContentProvider implements TextDocumentContentProvider {
    static scheme = DocumentSchemes.GitBlame;

    private _blameDecoration: TextEditorDecorationType;
    private _onDidChange = new EventEmitter<Uri>();
    // private _subscriptions: Disposable;
    // private _dataMap: Map<string, IGitBlameUriData>;

    constructor(context: ExtensionContext) {
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

        // this._dataMap = new Map();
        // this._subscriptions = Disposable.from(
        //     window.onDidChangeActiveTextEditor(e => e ? console.log(e.document.uri) : console.log('active missing')),
        //     workspace.onDidOpenTextDocument(d => {
        //         let data = this._dataMap.get(d.uri.toString());
        //         if (!data) return;

        //         // TODO: This only works on the first load -- not after since it is cached
        //         this._tryAddBlameDecorations(d.uri, data);
        //     }),
        //     workspace.onDidCloseTextDocument(d => {
        //         this._dataMap.delete(d.uri.toString());
        //     })
        // );
    }

    dispose() {
        this._onDidChange.dispose();
        // this._subscriptions && this._subscriptions.dispose();
    }

    get onDidChange() {
        return this._onDidChange.event;
    }

    public update(uri: Uri) {
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: Uri): string | Thenable<string> {
        const data = fromGitBlameUri(uri);
        // this._dataMap.set(uri.toString(), data);

        //const editor = this._findEditor(Uri.file(join(data.repoPath, data.file)));

        return gitGetVersionText(data.repoPath, data.sha, data.file).then(text => {
            this.update(uri);

            // TODO: This only works on the first load -- not after since it is cached
            this._tryAddBlameDecorations(uri, data);

            // TODO: This needs to move to selection somehow to show on the main file editor
            //this._addBlameDecorations(editor, data);

            return text;
        });

        // return gitGetVersionFile(data.repoPath, data.sha, data.file).then(dst => {
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
            if (editor) {
                clearInterval(handle);
                editor.setDecorations(this._blameDecoration, data.lines.map(l => {
                    return {
                        range: editor.document.validateRange(new Range(l.originalLine, 0, l.originalLine, 1000000)),
                        hoverMessage: `${moment(l.date).format('MMMM Do, YYYY hh:MMa')}\n${l.author}\n${l.sha}`
                    };
                }));
            }
        }, 200);
    }

    // private _addBlameDecorations(editor: TextEditor, data: IGitBlameUriData) {
    //     editor.setDecorations(this._blameDecoration, data.lines.map(l => editor.document.validateRange(new Range(l.line, 0, l.line, 1000000))));
    // }
}
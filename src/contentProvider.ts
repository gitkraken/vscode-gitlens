'use strict';
import {Disposable, EventEmitter, ExtensionContext, OverviewRulerLane, Range, TextEditor, TextEditorDecorationType, TextDocumentContentProvider, Uri, window, workspace} from 'vscode';
import {DocumentSchemes} from './constants';
import {gitGetVersionFile, gitGetVersionText, IGitBlameLine} from './git';
import {basename, dirname, extname, join} from 'path';
import * as moment from 'moment';

export default class GitBlameContentProvider implements TextDocumentContentProvider {
    static scheme = DocumentSchemes.GitBlame;

    private _blameDecoration: TextEditorDecorationType;
    private _onDidChange = new EventEmitter<Uri>();
    private _subscriptions: Disposable;
    // private _dataMap: Map<string, IGitBlameUriData>;

    constructor(context: ExtensionContext) {
        // TODO: Light & Dark
        this._blameDecoration = window.createTextEditorDecorationType({
            backgroundColor: 'rgba(254, 220, 95, 0.15)',
            gutterIconPath: context.asAbsolutePath('blame.png'),
            overviewRulerColor: 'rgba(254, 220, 95, 0.60)',
            overviewRulerLane: OverviewRulerLane.Right,
            isWholeLine: true
        });

        // this._dataMap = new Map();
        // this._subscriptions = Disposable.from(
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
        this._subscriptions && this._subscriptions.dispose();
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

        //console.log('provideTextDocumentContent', uri, data);
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
        const matcher = (e: any) => (e._documentData && e._documentData._uri && e._documentData._uri.toString()) === uriString;
        if (matcher(window.activeTextEditor)) {
            return window.activeTextEditor;
        }
        return window.visibleTextEditors.find(matcher);
    }

    private _tryAddBlameDecorations(uri: Uri, data: IGitBlameUriData) {
        let handle = setInterval(() => {
            let editor = this._findEditor(uri);
            if (editor) {
                clearInterval(handle);
                editor.setDecorations(this._blameDecoration, data.lines.map(l => {
                    return {
                        range: editor.document.validateRange(new Range(l.originalLine, 0, l.originalLine, 1000000)),
                        hoverMessage: `${moment(l.date).fromNow()}\n${l.author}\n${l.sha}`
                    };
                }));
            }
        }, 200);
    }

    // private _addBlameDecorations(editor: TextEditor, data: IGitBlameUriData) {
    //     editor.setDecorations(this._blameDecoration, data.lines.map(l => editor.document.validateRange(new Range(l.line, 0, l.line, 1000000))));
    // }
}

export interface IGitBlameUriData extends IGitBlameLine {
    repoPath: string,
    range: Range,
    index: number,
    lines: IGitBlameLine[]
}

export function toGitBlameUri(data: IGitBlameUriData) {
    let ext = extname(data.file);
    let path = `${dirname(data.file)}/${data.sha}: ${basename(data.file, ext)}${ext}`;
    return Uri.parse(`${DocumentSchemes.GitBlame}:${data.index}. ${moment(data.date).format('YYYY-MM-DD hh:MMa')} ${path}?${JSON.stringify(data)}`);
}

export function fromGitBlameUri(uri: Uri): IGitBlameUriData {
    let data = JSON.parse(uri.query);
    data.range = new Range(data.range[0].line, data.range[0].character, data.range[1].line, data.range[1].character);
    return data;
}
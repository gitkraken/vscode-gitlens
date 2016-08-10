'use strict';
import {Disposable, EventEmitter, ExtensionContext, Location, OverviewRulerLane, Range, TextEditorDecorationType, TextDocumentContentProvider, Uri, window, workspace} from 'vscode';
import {DocumentSchemes} from './constants';
import {gitGetVersionFile, gitGetVersionText, IGitBlameLine} from './git';
import {basename, dirname, extname} from 'path';
import * as moment from 'moment';

export default class GitBlameContentProvider implements TextDocumentContentProvider {
    static scheme = DocumentSchemes.GitBlame;

    private _blameDecoration: TextEditorDecorationType;
    private _onDidChange = new EventEmitter<Uri>();

    constructor(context: ExtensionContext) {
        let image = context.asAbsolutePath('blame.png');
        this._blameDecoration = window.createTextEditorDecorationType({
            backgroundColor: 'rgba(21, 251, 126, 0.7)',
            gutterIconPath: image,
            gutterIconSize: 'auto'
        });
    }

    dispose() {
        this._onDidChange.dispose();
    }

    get onDidChange() {
        return this._onDidChange.event;
    }

    public update(uri: Uri) {
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: Uri): string | Thenable<string> {
        const data = fromGitBlameUri(uri);

        console.log('provideTextDocumentContent', uri, data);
        return gitGetVersionText(data.repoPath, data.sha, data.file).then(text => {
            this.update(uri);

            setTimeout(() => {
                let uriString = uri.toString();
                let editor = window.visibleTextEditors.find((e: any) => (e._documentData && e._documentData._uri && e._documentData._uri.toString()) === uriString);
                if (editor) {
                    editor.setDecorations(this._blameDecoration, data.lines.map(l => new Range(l.line, 0, l.line, 1)));
                }
            }, 1500);

            // let foo = text.split('\n');
            // return foo.slice(data.range.start.line, data.range.end.line).join('\n')
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
}

export interface IGitBlameUriData extends IGitBlameLine {
    repoPath: string,
    range: Range,
    lines: IGitBlameLine[]
}

export function toGitBlameUri(data: IGitBlameUriData) {
    let ext = extname(data.file);
    let path = `${dirname(data.file)}/${data.sha}: ${basename(data.file, ext)}${ext}`;
    return Uri.parse(`${DocumentSchemes.GitBlame}:${path}?${JSON.stringify(data)}`);
}

export function fromGitBlameUri(uri: Uri): IGitBlameUriData {
    let data = JSON.parse(uri.query);
    data.range = new Range(data.range[0].line, data.range[0].character, data.range[1].line, data.range[1].character);
    return data;
}
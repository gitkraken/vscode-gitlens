'use strict';
import {CancellationToken, CodeLens, CodeLensProvider, commands, Range, SymbolInformation, SymbolKind, TextDocument, Uri} from 'vscode';
import {IBlameLine, gitBlame} from './git';
import * as moment from 'moment';

export class GitCodeLens extends CodeLens {
    constructor(public blame: Promise<IBlameLine[]>, public fileName: string, public blameRange: Range, range: Range) {
        super(range);

        this.blame = blame;
        this.fileName = fileName;
        this.blameRange = blameRange;
    }
}

export default class GitCodeLensProvider implements CodeLensProvider {
    constructor(public repoPath: string) { }

    provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
        // TODO: Should I wait here?
        let blame = gitBlame(document.fileName);

        return (commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri) as Promise<SymbolInformation[]>).then(symbols => {
            let lenses: CodeLens[] = [];
            symbols.forEach(sym => this._provideCodeLens(document, sym, blame, lenses));
            return lenses;
        });
    }

    private _provideCodeLens(document: TextDocument, symbol: SymbolInformation, blame: Promise<IBlameLine[]>, lenses: CodeLens[]): void {
        switch (symbol.kind) {
            case SymbolKind.Module:
            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Method:
            case SymbolKind.Function:
            case SymbolKind.Constructor:
            case SymbolKind.Field:
            case SymbolKind.Property:
                break;
            default:
                return;
        }

        var line = document.lineAt(symbol.location.range.start);
        // if (line.text.includes(symbol.name)) {
        // }

        let lens = new GitCodeLens(blame, document.fileName, symbol.location.range, line.range);
        lenses.push(lens);
    }

    resolveCodeLens(codeLens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
        if (codeLens instanceof GitCodeLens) {
            return codeLens.blame.then(allLines => {
                let lines = allLines.slice(codeLens.blameRange.start.line, codeLens.blameRange.end.line + 1);
                let line = lines[0];
                if (lines.length > 1) {
                    let sorted = lines.sort((a, b) => b.date.getTime() - a.date.getTime());
                    line = sorted[0];
                }

                codeLens.command = {
                    title: `${line.author}, ${moment(line.date).fromNow()}`,
                    command: 'git.viewFileHistory',
                    arguments: [Uri.file(codeLens.fileName)]
                };
                return codeLens;
            });//.catch(ex => Promise.reject(ex)); // TODO: Figure out a better way to stop the codelens from appearing
        }
    }
}

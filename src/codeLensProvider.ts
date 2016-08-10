'use strict';
import {CancellationToken, CodeLens, CodeLensProvider, commands, Location, Range, SymbolInformation, SymbolKind, TextDocument, Uri} from 'vscode';
import {Commands, VsCodeCommands} from './constants';
import {IGitBlameLine, gitBlame} from './git';
import {toGitBlameUri} from './contentProvider';
import * as moment from 'moment';

export class GitCodeLens extends CodeLens {
    constructor(private blame: Promise<IGitBlameLine[]>, public repoPath: string, public fileName: string, private blameRange: Range, range: Range) {
        super(range);
    }

    getBlameLines(): Promise<IGitBlameLine[]> {
        return this.blame.then(allLines => allLines.slice(this.blameRange.start.line, this.blameRange.end.line + 1));
    }

    static toUri(lens: GitCodeLens, line: IGitBlameLine, lines: IGitBlameLine[]): Uri {
        return toGitBlameUri(Object.assign({ repoPath: lens.repoPath, range: lens.blameRange, lines: lines }, line));
    }
}

export default class GitCodeLensProvider implements CodeLensProvider {
    constructor(public repoPath: string) { }

    provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
        // TODO: Should I wait here?
        let blame = gitBlame(document.fileName);

        return (commands.executeCommand(VsCodeCommands.ExecuteDocumentSymbolProvider, document.uri) as Promise<SymbolInformation[]>).then(symbols => {
            let lenses: CodeLens[] = [];
            symbols.forEach(sym => this._provideCodeLens(document, sym, blame, lenses));
            return lenses;
        });
    }

    private _provideCodeLens(document: TextDocument, symbol: SymbolInformation, blame: Promise<IGitBlameLine[]>, lenses: CodeLens[]): void {
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
        let lens = new GitCodeLens(blame, this.repoPath, document.fileName, symbol.location.range, line.range);
        lenses.push(lens);
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
        if (lens instanceof GitCodeLens) {
            return lens.getBlameLines().then(lines => {
                let recentLine = lines[0];

                let locations: Location[] = [];
                if (lines.length > 1) {
                    let sorted = lines.sort((a, b) => a.date.getTime() - b.date.getTime());
                    recentLine = sorted[sorted.length - 1];

                    console.log(lens.fileName, 'Blame lines:', sorted);

                    let map: Map<string, IGitBlameLine[]> = new Map();
                    sorted.forEach(l => {
                        let item = map.get(l.sha);
                        if (item) {
                            item.push(l);
                        } else {
                            map.set(l.sha, [l]);
                        }
                    });

                    locations = Array.from(map.values()).map(l => new Location(GitCodeLens.toUri(lens, l[0], l), lens.range.start))
                } else {
                    locations = [new Location(GitCodeLens.toUri(lens, recentLine, lines), lens.range.start)];
                }

                lens.command = {
                    title: `${recentLine.author}, ${moment(recentLine.date).fromNow()}`,
                    command: Commands.ShowBlameHistory,
                    arguments: [Uri.file(lens.fileName), lens.range.start, locations]
                    // command: 'git.viewFileHistory',
                    // arguments: [Uri.file(codeLens.fileName)]
                };
                return lens;
            }).catch(ex => Promise.reject(ex)); // TODO: Figure out a better way to stop the codelens from appearing
        }
    }
}

'use strict';
import {CancellationToken, CodeLens, CodeLensProvider, commands, ExtensionContext, Location, Position, Range, SymbolInformation, SymbolKind, TextDocument, Uri} from 'vscode';
import {Commands, VsCodeCommands, WorkspaceState} from './constants';
import GitBlameProvider, {IGitBlame, IGitBlameCommit} from './gitBlameProvider';
import * as moment from 'moment';

export class GitBlameCodeLens extends CodeLens {
    private _locations: Location[] = [];

    constructor(private blameProvider: GitBlameProvider, public fileName: string, private blameRange: Range, range: Range) {
        super(range);
    }

    get locations() {
        return this._locations;
    }

    getBlame(): Promise<IGitBlame> {
        return this.blameProvider.getBlameForRange(this.fileName, this.blameRange);
    }

    static toUri(lens: GitBlameCodeLens, repoPath: string, commit: IGitBlameCommit, index: number, commitCount: number): Uri {
        return GitBlameProvider.toBlameUri(repoPath, commit, lens.blameRange, index, commitCount);
    }
}

export class GitHistoryCodeLens extends CodeLens {
    constructor(public repoPath: string, public fileName: string, range: Range) {
        super(range);
    }

    // static toUri(lens: GitHistoryCodeLens, index: number): Uri {
    //     return GitBlameProvider.toBlameUri(Object.assign({ repoPath: lens.repoPath, index: index, range: lens.blameRange, lines: lines }, line));
    // }
}

export default class GitCodeLensProvider implements CodeLensProvider {
    public repoPath: string;

    constructor(context: ExtensionContext, public blameProvider: GitBlameProvider) {
        this.repoPath = context.workspaceState.get(WorkspaceState.RepoPath) as string;
     }

    provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
        this.blameProvider.blameFile(document.fileName);

        return (commands.executeCommand(VsCodeCommands.ExecuteDocumentSymbolProvider, document.uri) as Promise<SymbolInformation[]>).then(symbols => {
            let lenses: CodeLens[] = [];
            symbols.forEach(sym => this._provideCodeLens(document, sym, lenses));

            // Check if we have a lens for the whole document -- if not add one
            if (!lenses.find(l => l.range.start.line === 0 && l.range.end.line === 0)) {
                const docRange = document.validateRange(new Range(0, 1000000, 1000000, 1000000));
                lenses.push(new GitBlameCodeLens(this.blameProvider, document.fileName, docRange, new Range(0, 0, 0, docRange.start.character)));
                lenses.push(new GitHistoryCodeLens(this.repoPath, document.fileName, docRange.with(new Position(docRange.start.line, docRange.start.character + 1))));
            }
            return lenses;
        });
    }

    private _provideCodeLens(document: TextDocument, symbol: SymbolInformation, lenses: CodeLens[]): void {
        switch (symbol.kind) {
            case SymbolKind.Package:
            case SymbolKind.Module:
            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Constructor:
            case SymbolKind.Method:
            case SymbolKind.Property:
            case SymbolKind.Field:
            case SymbolKind.Function:
            case SymbolKind.Enum:
                break;
            default:
                return;
        }

        const line = document.lineAt(symbol.location.range.start);
        lenses.push(new GitBlameCodeLens(this.blameProvider, document.fileName, symbol.location.range, line.range.with(new Position(line.range.start.line, line.firstNonWhitespaceCharacterIndex))));
        lenses.push(new GitHistoryCodeLens(this.repoPath, document.fileName, line.range.with(new Position(line.range.start.line, line.firstNonWhitespaceCharacterIndex + 1))));
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
        if (lens instanceof GitBlameCodeLens) return this._resolveGitBlameCodeLens(lens, token);
        if (lens instanceof GitHistoryCodeLens) return this._resolveGitHistoryCodeLens(lens, token);
    }

    _resolveGitBlameCodeLens(lens: GitBlameCodeLens, token: CancellationToken): Thenable<CodeLens> {
        return new Promise<CodeLens>((resolve, reject) => {
            lens.getBlame().then(blame => {
                if (!blame.lines.length) {
                    console.error('No blame lines found', lens);
                    reject(null);
                    return;
                }

                // TODO: Rework this to only get the locations in the ShowBlameHistory command, rather than here -- should save a lot of processing
                const commitCount = blame.commits.size;

                let recentCommit;
                Array.from(blame.commits.values())
                    .sort((a, b) => b.date.getTime() - a.date.getTime())
                    .forEach((c, i) => {
                        if (i === 0) {
                            recentCommit = c;
                        }

                        const uri = GitBlameCodeLens.toUri(lens, this.repoPath, c, i + 1, commitCount);
                        blame.lines
                            .filter(l => l.sha === c.sha)
                            .forEach(l => lens.locations.push(new Location(uri, new Position(l.originalLine, 0))));
                    });

                lens.command = {
                    title: `${recentCommit.author}, ${moment(recentCommit.date).fromNow()}`,
                    command: Commands.ShowBlameHistory,
                    arguments: [Uri.file(lens.fileName), lens.range.start, lens.locations]
                };
                resolve(lens);
            });
        });//.catch(ex => Promise.reject(ex)); // TODO: Figure out a better way to stop the codelens from appearing
    }

    _resolveGitHistoryCodeLens(lens: GitHistoryCodeLens, token: CancellationToken): Thenable<CodeLens> {
        // TODO: Play with this more -- get this to open the correct diff to the right place
        lens.command = {
            title: `View History`,
            command: 'git.viewFileHistory', // viewLineHistory
            arguments: [Uri.file(lens.fileName)]
        };
        return Promise.resolve(lens);
    }
}

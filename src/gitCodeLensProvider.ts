'use strict';
import {CancellationToken, CodeLens, CodeLensProvider, commands, DocumentSelector, ExtensionContext, Location, Position, Range, SymbolInformation, SymbolKind, TextDocument, Uri} from 'vscode';
import {Commands, DocumentSchemes, VsCodeCommands, WorkspaceState} from './constants';
import GitProvider, {IGitBlame, IGitBlameCommit} from './gitProvider';
import * as moment from 'moment';

export class GitCodeLens extends CodeLens {
    constructor(private git: GitProvider, public fileName: string, public blameRange: Range, range: Range) {
        super(range);
    }

    getBlame(): Promise<IGitBlame> {
        return this.git.getBlameForRange(this.fileName, this.blameRange);
    }
}

export class GitHistoryCodeLens extends CodeLens {
    constructor(public repoPath: string, public fileName: string, range: Range) {
        super(range);
    }
}

export default class GitCodeLensProvider implements CodeLensProvider {
    static selector: DocumentSelector = { scheme: DocumentSchemes.File };

    private hasGitHistoryExtension: boolean;

    constructor(context: ExtensionContext, private git: GitProvider) {
        this.hasGitHistoryExtension = context.workspaceState.get(WorkspaceState.HasGitHistoryExtension, false);
    }

    provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
        const fileName = document.fileName;

        this.git.getBlameForFile(fileName);

        return (commands.executeCommand(VsCodeCommands.ExecuteDocumentSymbolProvider, document.uri) as Promise<SymbolInformation[]>).then(symbols => {
            const lenses: CodeLens[] = [];
            symbols.forEach(sym => this._provideCodeLens(fileName, document, sym, lenses));

            // Check if we have a lens for the whole document -- if not add one
            if (!lenses.find(l => l.range.start.line === 0 && l.range.end.line === 0)) {
                const blameRange = document.validateRange(new Range(0, 1000000, 1000000, 1000000));
                lenses.push(new GitCodeLens(this.git, fileName, blameRange, new Range(0, 0, 0, blameRange.start.character)));
                if (this.hasGitHistoryExtension) {
                    lenses.push(new GitHistoryCodeLens(this.git.repoPath, fileName, new Range(0, 1, 0, blameRange.start.character)));
                }
            }
            return lenses;
        });
    }

    private _provideCodeLens(fileName: string, document: TextDocument, symbol: SymbolInformation, lenses: CodeLens[]): void {
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

        let startChar = line.text.search(`\\b${symbol.name}\\b`); //line.firstNonWhitespaceCharacterIndex;
        if (startChar === -1) {
            startChar = line.firstNonWhitespaceCharacterIndex;
        } else {
            startChar += Math.floor(symbol.name.length / 2);
        }

        lenses.push(new GitCodeLens(this.git, fileName, symbol.location.range, line.range.with(new Position(line.range.start.line, startChar))));
        if (this.hasGitHistoryExtension) {
            lenses.push(new GitHistoryCodeLens(this.git.repoPath, fileName, line.range.with(new Position(line.range.start.line, startChar + 1))));
        }
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
        if (lens instanceof GitCodeLens) return this._resolveGitBlameCodeLens(lens, token);
        if (lens instanceof GitHistoryCodeLens) return this._resolveGitHistoryCodeLens(lens, token);
    }

    _resolveGitBlameCodeLens(lens: GitCodeLens, token: CancellationToken): Thenable<CodeLens> {
        return new Promise<CodeLens>((resolve, reject) => {
            lens.getBlame().then(blame => {
                if (!blame.lines.length) {
                    console.error('No blame lines found', lens);
                    reject(null);
                    return;
                }

                const recentCommit = Array.from(blame.commits.values()).sort((a, b) => b.date.getTime() - a.date.getTime())[0];
                lens.command = {
                    title: `${recentCommit.author}, ${moment(recentCommit.date).fromNow()}`, // - lines(${lens.blameRange.start.line + 1}-${lens.blameRange.end.line + 1})`,
                    command: Commands.ShowBlameHistory,
                    arguments: [Uri.file(lens.fileName), lens.blameRange, lens.range.start]
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
'use strict';
import { Iterables, Strings } from './system';
import { CancellationToken, CodeLens, CodeLensProvider, commands, DocumentSelector, ExtensionContext, Position, Range, SymbolInformation, SymbolKind, TextDocument, Uri, workspace } from 'vscode';
import { BuiltInCommands, Commands, DocumentSchemes, WorkspaceState } from './constants';
import { CodeLensCommand, CodeLensLocation, ICodeLensesConfig } from './configuration';
import GitProvider, {IGitBlame, IGitBlameLines} from './gitProvider';
import * as moment from 'moment';

export class GitRecentChangeCodeLens extends CodeLens {
    constructor(private git: GitProvider, public fileName: string, public symbolKind: SymbolKind, public blameRange: Range, range: Range) {
        super(range);
    }

    getBlame(): Promise<IGitBlameLines> {
        return this.git.getBlameForRange(this.fileName, this.blameRange);
    }
}

export class GitAuthorsCodeLens extends CodeLens {
    constructor(private git: GitProvider, public fileName: string, public symbolKind: SymbolKind, public blameRange: Range, range: Range) {
        super(range);
    }

    getBlame(): Promise<IGitBlameLines> {
        return this.git.getBlameForRange(this.fileName, this.blameRange);
    }
}

export default class GitCodeLensProvider implements CodeLensProvider {
    static selector: DocumentSelector = { scheme: DocumentSchemes.File };

    private _config: ICodeLensesConfig;
    private _hasGitHistoryExtension: boolean;

    constructor(context: ExtensionContext, private git: GitProvider) {
        this._config = workspace.getConfiguration('gitlens').get<ICodeLensesConfig>('codeLens');
        this._hasGitHistoryExtension = context.workspaceState.get(WorkspaceState.HasGitHistoryExtension, false);
     }

    provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
        const fileName = document.fileName;
        const promise = Promise.all([this.git.getBlameForFile(fileName) as Promise<any>, (commands.executeCommand(BuiltInCommands.ExecuteDocumentSymbolProvider, document.uri) as Promise<any>)]);

        return promise.then(values => {
            const blame = values[0] as IGitBlame;
            if (!blame || !blame.lines.length) return [];

            const symbols = values[1] as SymbolInformation[];
            const lenses: CodeLens[] = [];
            symbols.forEach(sym => this._provideCodeLens(fileName, document, sym, lenses));

            if (this._config.location !== CodeLensLocation.Custom || (this._config.locationCustomSymbols || []).find(_ => _.toLowerCase() === 'file')) {
                // Check if we have a lens for the whole document -- if not add one
                if (!lenses.find(l => l.range.start.line === 0 && l.range.end.line === 0)) {
                    const blameRange = document.validateRange(new Range(0, 1000000, 1000000, 1000000));
                    if (this._config.recentChange.enabled) {
                        lenses.push(new GitRecentChangeCodeLens(this.git, fileName, SymbolKind.File, blameRange, new Range(0, 0, 0, blameRange.start.character)));
                    }
                    if (this._config.authors.enabled) {
                        lenses.push(new GitAuthorsCodeLens(this.git, fileName, SymbolKind.File, blameRange, new Range(0, 1, 0, blameRange.start.character)));
                    }
                }
            }

            return lenses;
        });
    }

    private _isValidSymbol(kind: SymbolKind) {
        switch (this._config.location) {
            case CodeLensLocation.All:
            case CodeLensLocation.DocumentAndContainers:
                switch (kind) {
                    case SymbolKind.File:
                    case SymbolKind.Package:
                    case SymbolKind.Module:
                    case SymbolKind.Namespace:
                    case SymbolKind.Class:
                    case SymbolKind.Interface:
                        return true;
                    case SymbolKind.Constructor:
                    case SymbolKind.Method:
                    case SymbolKind.Function:
                    case SymbolKind.Property:
                    case SymbolKind.Enum:
                        return this._config.location === CodeLensLocation.All;
                    default:
                        return false;
                }
            case CodeLensLocation.Document:
                return false;
            case CodeLensLocation.Custom:
                return !!(this._config.locationCustomSymbols || []).find(_ => _.toLowerCase() === SymbolKind[kind].toLowerCase());
        }
        return false;
    }

    private _provideCodeLens(fileName: string, document: TextDocument, symbol: SymbolInformation, lenses: CodeLens[]): void {
        if (!this._isValidSymbol(symbol.kind)) return;

        const line = document.lineAt(symbol.location.range.start);
        // Make sure there is only 1 lense per line
        if (lenses.length && lenses[lenses.length - 1].range.start.line === line.lineNumber) {
            return;
        }

        let startChar = -1;
        try {
            startChar = line.text.search(`\\b${Strings.escapeRegExp(symbol.name)}\\b`);
        }
        catch (ex) { }
        if (startChar === -1) {
            startChar = line.firstNonWhitespaceCharacterIndex;
        } else {
            startChar += Math.floor(symbol.name.length / 2);
        }

        if (this._config.recentChange.enabled) {
            lenses.push(new GitRecentChangeCodeLens(this.git, fileName, symbol.kind, symbol.location.range, line.range.with(new Position(line.range.start.line, startChar))));
            startChar++;
        }

        if (this._config.authors.enabled) {
            // HACK for Omnisharp, since it doesn't return full ranges
            let multiline = (symbol.location.range.end.line - symbol.location.range.start.line) > 1;
            if (!multiline && fileName.endsWith('.cs')) {
                switch (symbol.kind) {
                    case SymbolKind.File:
                    case SymbolKind.Package:
                    case SymbolKind.Module:
                    case SymbolKind.Namespace:
                    case SymbolKind.Class:
                    case SymbolKind.Interface:
                    case SymbolKind.Constructor:
                    case SymbolKind.Method:
                    case SymbolKind.Function:
                    case SymbolKind.Enum:
                        multiline = true;
                        break;
                }
            }

            if (multiline) {
                lenses.push(new GitAuthorsCodeLens(this.git, fileName, symbol.kind, symbol.location.range, line.range.with(new Position(line.range.start.line, startChar))));
            }
        }
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
        if (lens instanceof GitRecentChangeCodeLens) return this._resolveGitRecentChangeCodeLens(lens, token);
        if (lens instanceof GitAuthorsCodeLens) return this._resolveGitAuthorsCodeLens(lens, token);
        return Promise.reject<CodeLens>(null);
    }

    _resolveGitRecentChangeCodeLens(lens: GitRecentChangeCodeLens, token: CancellationToken): Thenable<CodeLens> {
        return lens.getBlame().then(blame => {
            const recentCommit = Iterables.first(blame.commits.values());
            const title = `${recentCommit.author}, ${moment(recentCommit.date).fromNow()}`; // - ${SymbolKind[lens.symbolKind]}(${lens.blameRange.start.line + 1}-${lens.blameRange.end.line + 1})`;
            switch (this._config.recentChange.command) {
                case CodeLensCommand.BlameAnnotate: return this._applyBlameAnnotateCommand<GitRecentChangeCodeLens>(title, lens, blame);
                case CodeLensCommand.BlameExplorer: return this._applyBlameExplorerCommand<GitRecentChangeCodeLens>(title, lens, blame);
                case CodeLensCommand.DiffWithPrevious: return this._applyDiffWithPreviousCommand<GitRecentChangeCodeLens>(title, lens, blame);
                case CodeLensCommand.GitViewHistory: return this._applyGitHistoryCommand<GitRecentChangeCodeLens>(title, lens, blame);
                default: return lens;
            }
        });
    }

    _resolveGitAuthorsCodeLens(lens: GitAuthorsCodeLens, token: CancellationToken): Thenable<CodeLens> {
        return lens.getBlame().then(blame => {
            const count = blame.authors.size;
            const title = `${count} ${count > 1 ? 'authors' : 'author'} (${Iterables.first(blame.authors.values()).name}${count > 1 ? ' and others' : ''})`;
            switch (this._config.authors.command) {
                case CodeLensCommand.BlameAnnotate: return this._applyBlameAnnotateCommand<GitAuthorsCodeLens>(title, lens, blame);
                case CodeLensCommand.BlameExplorer: return this._applyBlameExplorerCommand<GitAuthorsCodeLens>(title, lens, blame);
                case CodeLensCommand.DiffWithPrevious: return this._applyDiffWithPreviousCommand<GitAuthorsCodeLens>(title, lens, blame);
                case CodeLensCommand.GitViewHistory: return this._applyGitHistoryCommand<GitAuthorsCodeLens>(title, lens, blame);
                default: return lens;
            }
        });
    }

    _applyBlameAnnotateCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: IGitBlameLines, sha?: string) {
        lens.command = {
            title: title,
            command: Commands.ToggleBlame,
            arguments: [Uri.file(lens.fileName), sha]
        };
        return lens;
    }

    _applyBlameExplorerCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: IGitBlameLines) {
        lens.command = {
            title: title,
            command: Commands.ShowBlameHistory,
            arguments: [Uri.file(lens.fileName), lens.blameRange, lens.range.start]
        };
        return lens;
    }

    _applyDiffWithPreviousCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: IGitBlameLines) {
        const line = blame.allLines[lens.range.start.line];
        const commit = blame.commits.get(line.sha);

        lens.command = {
            title: title,
            command: Commands.DiffWithPrevious,
            arguments: [
                Uri.file(lens.fileName),
                commit.repoPath,
                commit.sha,
                commit.uri,
                commit.previousSha,
                commit.previousUri,
                line.line
            ]
        };
        return lens;
    }

    _applyGitHistoryCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: IGitBlameLines) {
        if (!this._hasGitHistoryExtension) return this._applyBlameExplorerCommand(title, lens, blame);

        lens.command = {
            title: title,
            command: CodeLensCommand.GitViewHistory,
            arguments: [Uri.file(lens.fileName)]
        };
        return lens;
    }
}
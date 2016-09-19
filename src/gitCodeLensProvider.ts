'use strict';
import {CancellationToken, CodeLens, CodeLensProvider, commands, DocumentSelector, ExtensionContext, Location, Position, Range, SymbolInformation, SymbolKind, TextDocument, Uri, window, workspace} from 'vscode';
import {BuiltInCommands, Commands, DocumentSchemes, WorkspaceState} from './constants';
import {CodeLensCommand, ICodeLensesConfig} from './configuration';
import GitProvider, {IGitBlame, IGitBlameLines, IGitCommit} from './gitProvider';
import * as _ from 'lodash';
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

            return lenses;
        });
    }

    foo: string; bar: number;

    private _provideCodeLens(fileName: string, document: TextDocument, symbol: SymbolInformation, lenses: CodeLens[]): void {
        let multiline = false;
        switch (symbol.kind) {
            case SymbolKind.Package:
            case SymbolKind.Module:
            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Constructor:
            case SymbolKind.Method:
            case SymbolKind.Function:
            case SymbolKind.Enum:
                // HACK for Omnisharp, since it doesn't return full ranges
                multiline = fileName.endsWith('.cs') || (symbol.location.range.end.line - symbol.location.range.start.line) > 1;
                break;
            case SymbolKind.Property:
                multiline = (symbol.location.range.end.line - symbol.location.range.start.line) > 1;
                if (!multiline) return;
                break;
            default:
                return;
        }

        const line = document.lineAt(symbol.location.range.start);
        // Make sure there is only 1 lense per line
        if (lenses.length && lenses[lenses.length - 1].range.start.line === line.lineNumber) {
            return;
        }

        let startChar = -1;
        try {
            startChar = line.text.search(`\\b${_.escapeRegExp(symbol.name)}\\b`);
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
        if (multiline && this._config.authors.enabled) {
            lenses.push(new GitAuthorsCodeLens(this.git, fileName, symbol.kind, symbol.location.range, line.range.with(new Position(line.range.start.line, startChar))));
        }
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
        if (lens instanceof GitRecentChangeCodeLens) return this._resolveGitRecentChangeCodeLens(lens, token);
        if (lens instanceof GitAuthorsCodeLens) return this._resolveGitAuthorsCodeLens(lens, token);
    }

    _resolveGitRecentChangeCodeLens(lens: GitRecentChangeCodeLens, token: CancellationToken): Thenable<CodeLens> {
        return lens.getBlame().then(blame => {
            const recentCommit = blame.commits.values().next().value;
            const title = `${recentCommit.author}, ${moment(recentCommit.date).fromNow()}`; // - ${SymbolKind[lens.symbolKind]}(${lens.blameRange.start.line + 1}-${lens.blameRange.end.line + 1})`;
            switch (this._config.recentChange.command) {
                case CodeLensCommand.BlameAnnotate: return this._applyBlameAnnotateCommand<GitRecentChangeCodeLens>(title, lens, blame);
                case CodeLensCommand.BlameExplorer: return this._applyBlameExplorerCommand<GitRecentChangeCodeLens>(title, lens, blame);
                case CodeLensCommand.GitHistory: return this._applyGitHistoryCommand<GitRecentChangeCodeLens>(title, lens, blame);
                default: return lens;
            }
        });
    }

    _resolveGitAuthorsCodeLens(lens: GitAuthorsCodeLens, token: CancellationToken): Thenable<CodeLens> {
        return lens.getBlame().then(blame => {
            const count = blame.authors.size;
            const title = `${count} ${count > 1 ? 'authors' : 'author'} (${blame.authors.values().next().value.name}${count > 1 ? ' and others' : ''})`;
            switch (this._config.authors.command) {
                case CodeLensCommand.BlameAnnotate: return this._applyBlameAnnotateCommand<GitAuthorsCodeLens>(title, lens, blame);
                case CodeLensCommand.BlameExplorer: return this._applyBlameExplorerCommand<GitAuthorsCodeLens>(title, lens, blame);
                case CodeLensCommand.GitHistory: return this._applyGitHistoryCommand<GitAuthorsCodeLens>(title, lens, blame);
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

    _applyGitHistoryCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: IGitBlameLines) {
        if (!this._hasGitHistoryExtension) return this._applyBlameExplorerCommand(title, lens, blame);

        lens.command = {
            title: title,
            command: 'git.viewFileHistory',
            arguments: [Uri.file(lens.fileName)]
        };
        return lens;
    }
}
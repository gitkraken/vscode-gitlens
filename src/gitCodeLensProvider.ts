'use strict';
import { Iterables, Strings } from './system';
import { CancellationToken, CodeLens, CodeLensProvider, commands, DocumentSelector, ExtensionContext, Position, Range, SymbolInformation, SymbolKind, TextDocument, Uri, workspace } from 'vscode';
import { BuiltInCommands, Commands, DocumentSchemes, WorkspaceState } from './constants';
import { CodeLensCommand, CodeLensLocation, IConfig, ICodeLensLanguageLocation } from './configuration';
import GitProvider, { GitCommit, IGitBlame, IGitBlameLines } from './gitProvider';
import * as moment from 'moment';

export class GitRecentChangeCodeLens extends CodeLens {
    constructor(private git: GitProvider, public fileName: string, public symbolKind: SymbolKind, public blameRange: Range, public isFullRange: boolean, range: Range) {
        super(range);
    }

    getBlame(): Promise<IGitBlameLines> {
        return this.git.getBlameForRange(this.fileName, this.blameRange);
    }
}

export class GitAuthorsCodeLens extends CodeLens {
    constructor(private git: GitProvider, public fileName: string, public symbolKind: SymbolKind, public blameRange: Range, public isFullRange: boolean, range: Range) {
        super(range);
    }

    getBlame(): Promise<IGitBlameLines> {
        return this.git.getBlameForRange(this.fileName, this.blameRange);
    }
}

export default class GitCodeLensProvider implements CodeLensProvider {
    static selector: DocumentSelector = { scheme: DocumentSchemes.File };

    private _config: IConfig;
    private _hasGitHistoryExtension: boolean;

    constructor(context: ExtensionContext, private git: GitProvider) {
        this._config = workspace.getConfiguration('').get<IConfig>('gitlens');
        this._hasGitHistoryExtension = context.workspaceState.get(WorkspaceState.HasGitHistoryExtension, false);
    }

    async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
        let languageLocations = this._config.codeLens.languageLocations.find(_ => _.language.toLowerCase() === document.languageId);
        if (languageLocations == null) {
            languageLocations = <ICodeLensLanguageLocation>{
                language: undefined,
                location: this._config.codeLens.location,
                customSymbols: this._config.codeLens.locationCustomSymbols
            };
        }

        const lenses: CodeLens[] = [];

        if (languageLocations.location === CodeLensLocation.None) return lenses;

        const fileName = document.fileName;

        const blamePromise = this.git.getBlameForFile(fileName);
        let blame: IGitBlame;
        if (languageLocations.location === CodeLensLocation.Document) {
            blame = await blamePromise;
            if (!blame || !blame.lines.length) return lenses;
        }
        else {
            const values = await Promise.all([
                <Promise<any>>blamePromise,
                <Promise<any>>commands.executeCommand(BuiltInCommands.ExecuteDocumentSymbolProvider, document.uri)
            ]);

            blame = values[0] as IGitBlame;
            if (!blame || !blame.lines.length) return lenses;

            const symbols = values[1] as SymbolInformation[];
            symbols.forEach(sym => this._provideCodeLens(fileName, document, sym, languageLocations, lenses));
        }

        if (languageLocations.location !== CodeLensLocation.Custom || (languageLocations.customSymbols || []).find(_ => _.toLowerCase() === 'file')) {
            // Check if we have a lens for the whole document -- if not add one
            if (!lenses.find(l => l.range.start.line === 0 && l.range.end.line === 0)) {
                const blameRange = document.validateRange(new Range(0, 1000000, 1000000, 1000000));
                if (this._config.codeLens.recentChange.enabled) {
                    lenses.push(new GitRecentChangeCodeLens(this.git, fileName, SymbolKind.File, blameRange, true, new Range(0, 0, 0, blameRange.start.character)));
                }
                if (this._config.codeLens.authors.enabled) {
                    lenses.push(new GitAuthorsCodeLens(this.git, fileName, SymbolKind.File, blameRange, true, new Range(0, 1, 0, blameRange.start.character)));
                }
            }
        }

        return lenses;
    }

    private _isValidSymbol(kind: SymbolKind, languageLocation: ICodeLensLanguageLocation) {
        switch (languageLocation.location) {
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
                        return languageLocation.location === CodeLensLocation.All;
                    default:
                        return false;
                }
            case CodeLensLocation.Document:
                return false;
            case CodeLensLocation.Custom:
                return !!(languageLocation.customSymbols || []).find(_ => _.toLowerCase() === SymbolKind[kind].toLowerCase());
        }
        return false;
    }

    private _provideCodeLens(fileName: string, document: TextDocument, symbol: SymbolInformation, languageLocation: ICodeLensLanguageLocation, lenses: CodeLens[]): void {
        if (!this._isValidSymbol(symbol.kind, languageLocation)) return;

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

        if (this._config.codeLens.recentChange.enabled) {
            lenses.push(new GitRecentChangeCodeLens(this.git, fileName, symbol.kind, symbol.location.range, false, line.range.with(new Position(line.range.start.line, startChar))));
            startChar++;
        }

        if (this._config.codeLens.authors.enabled) {
            // HACK for Omnisharp, since it doesn't return full ranges
            let multiline = (symbol.location.range.end.line - symbol.location.range.start.line) > 1;
            if (!multiline && document.languageId === 'csharp') {
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
                lenses.push(new GitAuthorsCodeLens(this.git, fileName, symbol.kind, symbol.location.range, false, line.range.with(new Position(line.range.start.line, startChar))));
            }
        }
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
        if (lens instanceof GitRecentChangeCodeLens) return this._resolveGitRecentChangeCodeLens(lens, token);
        if (lens instanceof GitAuthorsCodeLens) return this._resolveGitAuthorsCodeLens(lens, token);
        return Promise.reject<CodeLens>(undefined);
    }

    async _resolveGitRecentChangeCodeLens(lens: GitRecentChangeCodeLens, token: CancellationToken): Promise<CodeLens> {
        const blame = await lens.getBlame();

        const recentCommit = Iterables.first(blame.commits.values());
        let title = `${recentCommit.author}, ${moment(recentCommit.date).fromNow()}`;
        if (this._config.advanced.debug) {
            title += ` [${recentCommit.sha}, Symbol(${SymbolKind[lens.symbolKind]}), Lines(${lens.blameRange.start.line + 1}-${lens.blameRange.end.line + 1})]`;
        }

        switch (this._config.codeLens.recentChange.command) {
            case CodeLensCommand.BlameAnnotate: return this._applyBlameAnnotateCommand<GitRecentChangeCodeLens>(title, lens, blame);
            case CodeLensCommand.ShowBlameHistory: return this._applyShowBlameHistoryCommand<GitRecentChangeCodeLens>(title, lens, blame, recentCommit);
            case CodeLensCommand.ShowFileHistory: return this._applyShowFileHistoryCommand<GitRecentChangeCodeLens>(title, lens, blame, recentCommit);
            case CodeLensCommand.DiffWithPrevious: return this._applyDiffWithPreviousCommand<GitRecentChangeCodeLens>(title, lens, blame, recentCommit);
            case CodeLensCommand.GitViewHistory: return this._applyGitHistoryCommand<GitRecentChangeCodeLens>(title, lens, blame);
            default: return lens;
        }
    }

    async _resolveGitAuthorsCodeLens(lens: GitAuthorsCodeLens, token: CancellationToken): Promise<CodeLens> {
        const blame = await lens.getBlame();

        const count = blame.authors.size;
        const title = `${count} ${count > 1 ? 'authors' : 'author'} (${Iterables.first(blame.authors.values()).name}${count > 1 ? ' and others' : ''})`;

        switch (this._config.codeLens.authors.command) {
            case CodeLensCommand.BlameAnnotate: return this._applyBlameAnnotateCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ShowBlameHistory: return this._applyShowBlameHistoryCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ShowFileHistory: return this._applyShowFileHistoryCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.DiffWithPrevious: return this._applyDiffWithPreviousCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.GitViewHistory: return this._applyGitHistoryCommand<GitAuthorsCodeLens>(title, lens, blame);
            default: return lens;
        }
    }

    _applyBlameAnnotateCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: IGitBlameLines) {
        lens.command = {
            title: title,
            command: Commands.ToggleBlame,
            arguments: [Uri.file(lens.fileName)]
        };
        return lens;
    }

    _applyShowBlameHistoryCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: IGitBlameLines, commit?: GitCommit) {
        let line = lens.range.start.line;
        if (commit) {
            const blameLine = commit.lines.find(_ => _.line === line);
            if (blameLine) {
                line = blameLine.originalLine;
            }
        }

        const position = lens.isFullRange ? new Position(1, 0) : lens.range.start;
        lens.command = {
            title: title,
            command: Commands.ShowBlameHistory,
            arguments: [Uri.file(lens.fileName), lens.blameRange, position, commit && commit.sha, line]
        };
        return lens;
    }

    _applyShowFileHistoryCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: IGitBlameLines, commit?: GitCommit) {
        let line = lens.range.start.line;
        if (commit) {
            const blameLine = commit.lines.find(_ => _.line === line);
            if (blameLine) {
                line = blameLine.originalLine;
            }
        }

        const position = lens.isFullRange ? new Position(1, 0) : lens.range.start;
        lens.command = {
            title: title,
            command: Commands.ShowFileHistory,
            arguments: [Uri.file(lens.fileName), position, commit && commit.sha, line]
        };
        return lens;
    }

    async _applyDiffWithPreviousCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: IGitBlameLines, commit?: GitCommit): Promise<T> {
        if (!commit) {
            const blameLine = blame.allLines[lens.range.start.line];
            commit = blame.commits.get(blameLine.sha);
        }

        lens.command = {
            title: title,
            command: Commands.DiffWithPrevious,
            arguments: [
                Uri.file(lens.fileName),
                commit,
                lens.isFullRange ? undefined : lens.blameRange
            ]
        };
        return lens;
    }

    _applyGitHistoryCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: IGitBlameLines) {
        if (!this._hasGitHistoryExtension) return this._applyShowFileHistoryCommand(title, lens, blame);

        lens.command = {
            title: title,
            command: CodeLensCommand.GitViewHistory,
            arguments: [Uri.file(lens.fileName)]
        };
        return lens;
    }
}
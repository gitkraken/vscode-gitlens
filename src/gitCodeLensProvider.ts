'use strict';
import { Functions, Iterables } from './system';
import { CancellationToken, CodeLens, CodeLensProvider, Command, commands, DocumentSelector, Event, EventEmitter, ExtensionContext, Position, Range, SymbolInformation, SymbolKind, TextDocument, Uri, workspace } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs, ShowQuickCommitDetailsCommandArgs, ShowQuickCommitFileDetailsCommandArgs, ShowQuickFileHistoryCommandArgs } from './commands';
import { BuiltInCommands, DocumentSchemes, ExtensionKey } from './constants';
import { CodeLensCommand, CodeLensLocations, ICodeLensLanguageLocation, IConfig } from './configuration';
import { GitBlame, GitBlameCommit, GitBlameLines, GitService, GitUri } from './gitService';
import { Logger } from './logger';

export class GitRecentChangeCodeLens extends CodeLens {

    constructor(
        public symbolKind: SymbolKind,
        public uri: GitUri | undefined,
        private blame: (() => GitBlameLines | undefined) | undefined,
        public blameRange: Range,
        public isFullRange: boolean,
        range: Range,
        public dirty: boolean
    ) {
        super(range);
    }

    getBlame(): GitBlameLines | undefined {
        return this.blame && this.blame();
    }
}

export class GitAuthorsCodeLens extends CodeLens {

    constructor(
        public symbolKind: SymbolKind,
        public uri: GitUri | undefined,
        private blame: () => GitBlameLines | undefined,
        public blameRange: Range,
        public isFullRange: boolean,
        range: Range
    ) {
        super(range);
    }

    getBlame(): GitBlameLines | undefined {
        return this.blame();
    }
}

export class GitCodeLensProvider implements CodeLensProvider {

    private _onDidChangeCodeLenses = new EventEmitter<void>();
    public get onDidChangeCodeLenses(): Event<void> {
        return this._onDidChangeCodeLenses.event;
    }

    static selector: DocumentSelector = { scheme: DocumentSchemes.File };

    private _config: IConfig;

    constructor(context: ExtensionContext, private git: GitService) {
        this._config = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;
    }

    reset() {
        this._config = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;

        Logger.log('Triggering a reset of the git CodeLens provider');
        this._onDidChangeCodeLenses.fire();
    }

    async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
        const dirty = document.isDirty;

        let languageLocations = this._config.codeLens.perLanguageLocations.find(_ => _.language !== undefined && _.language.toLowerCase() === document.languageId);
        if (languageLocations == null) {
            languageLocations = {
                language: undefined,
                locations: this._config.codeLens.locations,
                customSymbols: this._config.codeLens.customLocationSymbols
            } as ICodeLensLanguageLocation;
        }

        languageLocations.customSymbols = languageLocations.customSymbols != null
            ? languageLocations.customSymbols = languageLocations.customSymbols.map(_ => _.toLowerCase())
            : [];

        const lenses: CodeLens[] = [];

        let gitUri: GitUri | undefined;
        let blame: GitBlame | undefined;
        let symbols: SymbolInformation[] | undefined;

        if (!dirty) {
            gitUri = await GitUri.fromUri(document.uri, this.git);

            if (token.isCancellationRequested) return lenses;

            if (languageLocations.locations.length === 1 && languageLocations.locations.includes(CodeLensLocations.Document)) {
                blame = await this.git.getBlameForFile(gitUri);
            }
            else {
                [blame, symbols] = await Promise.all([
                    this.git.getBlameForFile(gitUri),
                    commands.executeCommand(BuiltInCommands.ExecuteDocumentSymbolProvider, document.uri) as Promise<SymbolInformation[]>
                ]);
            }

            if (blame === undefined || blame.lines.length === 0) return lenses;
        }
        else {
            if (languageLocations.locations.length !== 1 || !languageLocations.locations.includes(CodeLensLocations.Document)) {
                symbols = await commands.executeCommand(BuiltInCommands.ExecuteDocumentSymbolProvider, document.uri) as SymbolInformation[];
            }
        }

        if (token.isCancellationRequested) return lenses;

        const documentRangeFn = Functions.once(() => document.validateRange(new Range(0, 1000000, 1000000, 1000000)));

        if (symbols !== undefined) {
            Logger.log('GitCodeLensProvider.provideCodeLenses:', `${symbols.length} symbol(s) found`);
            symbols.forEach(sym => this.provideCodeLens(lenses, document, dirty, sym, languageLocations!, documentRangeFn, blame, gitUri));
        }

        if ((languageLocations.locations.includes(CodeLensLocations.Document) || languageLocations.customSymbols.includes('file')) && !languageLocations.customSymbols.includes('!file')) {
            // Check if we have a lens for the whole document -- if not add one
            if (!lenses.find(l => l.range.start.line === 0 && l.range.end.line === 0)) {
                const blameRange = documentRangeFn();

                let blameForRangeFn: (() => GitBlameLines | undefined) | undefined = undefined;
                if (dirty || this._config.codeLens.recentChange.enabled) {
                    if (!dirty) {
                        blameForRangeFn = Functions.once(() => this.git.getBlameForRangeSync(blame!, gitUri!, blameRange));
                    }
                    lenses.push(new GitRecentChangeCodeLens(SymbolKind.File, gitUri, blameForRangeFn, blameRange, true, new Range(0, 0, 0, blameRange.start.character), dirty));
                }
                if (!dirty && this._config.codeLens.authors.enabled) {
                    if (blameForRangeFn === undefined) {
                        blameForRangeFn = Functions.once(() => this.git.getBlameForRangeSync(blame!, gitUri!, blameRange));
                    }
                    lenses.push(new GitAuthorsCodeLens(SymbolKind.File, gitUri, blameForRangeFn, blameRange, true, new Range(0, 1, 0, blameRange.start.character)));
                }
            }
        }

        return lenses;
    }

    private validateSymbolAndGetBlameRange(symbol: SymbolInformation, languageLocation: ICodeLensLanguageLocation, documentRangeFn: () => Range): Range | undefined {
        let valid = false;
        let range: Range | undefined;

        const symbolName = SymbolKind[symbol.kind].toLowerCase();
        switch (symbol.kind) {
            case SymbolKind.File:
                if (languageLocation.locations.includes(CodeLensLocations.Containers) || languageLocation.customSymbols!.includes(symbolName)) {
                    valid = !languageLocation.customSymbols!.includes(`!${symbolName}`);
                }

                if (valid) {
                    // Adjust the range to be for the whole file
                    range = documentRangeFn();
                }
                break;

            case SymbolKind.Package:
                if (languageLocation.locations.includes(CodeLensLocations.Containers) || languageLocation.customSymbols!.includes(symbolName)) {
                    valid = !languageLocation.customSymbols!.includes(`!${symbolName}`);
                }

                if (valid) {
                    // Adjust the range to be for the whole file
                    if (symbol.location.range.start.line === 0 && symbol.location.range.end.line === 0) {
                        range = documentRangeFn();
                    }
                }
                break;

            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Module:
            case SymbolKind.Namespace:
            case SymbolKind.Struct:
                if (languageLocation.locations.includes(CodeLensLocations.Containers) || languageLocation.customSymbols!.includes(symbolName)) {
                    valid = !languageLocation.customSymbols!.includes(`!${symbolName}`);
                }
                break;

            case SymbolKind.Constructor:
            case SymbolKind.Enum:
            case SymbolKind.Function:
            case SymbolKind.Method:
                if (languageLocation.locations.includes(CodeLensLocations.Blocks) || languageLocation.customSymbols!.includes(symbolName)) {
                    valid = !languageLocation.customSymbols!.includes(`!${symbolName}`);
                }
                break;

            default:
                if (languageLocation.customSymbols!.includes(symbolName)) {
                    valid = !languageLocation.customSymbols!.includes(`!${symbolName}`);
                }
                break;
        }

        return valid ? range || symbol.location.range : undefined;
    }

    private provideCodeLens(lenses: CodeLens[], document: TextDocument, dirty: boolean, symbol: SymbolInformation, languageLocation: ICodeLensLanguageLocation, documentRangeFn: () => Range, blame: GitBlame | undefined, gitUri: GitUri | undefined): void {
        const blameRange = this.validateSymbolAndGetBlameRange(symbol, languageLocation, documentRangeFn);
        if (blameRange === undefined) return;

        const line = document.lineAt(symbol.location.range.start);
        // Make sure there is only 1 lens per line
        if (lenses.length && lenses[lenses.length - 1].range.start.line === line.lineNumber) return;

        // Anchor the code lens to the end of the line -- so they are somewhat consistently placed
        let startChar = line.range.end.character - 1;

        let blameForRangeFn: (() => GitBlameLines | undefined) | undefined;
        if (dirty || this._config.codeLens.recentChange.enabled) {
            if (!dirty) {
                blameForRangeFn = Functions.once(() => this.git.getBlameForRangeSync(blame!, gitUri!, blameRange));
            }
            lenses.push(new GitRecentChangeCodeLens(symbol.kind, gitUri, blameForRangeFn, blameRange, false, line.range.with(new Position(line.range.start.line, startChar)), dirty));
            startChar++;
        }

        if (this._config.codeLens.authors.enabled) {
            let multiline = !blameRange.isSingleLine;
            // HACK for Omnisharp, since it doesn't return full ranges
            if (!multiline && document.languageId === 'csharp') {
                switch (symbol.kind) {
                    case SymbolKind.File:
                        break;
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

            if (multiline && !dirty) {
                if (blameForRangeFn === undefined) {
                    blameForRangeFn = Functions.once(() => this.git.getBlameForRangeSync(blame!, gitUri!, blameRange));
                }
                lenses.push(new GitAuthorsCodeLens(symbol.kind, gitUri, blameForRangeFn, blameRange, false, line.range.with(new Position(line.range.start.line, startChar))));
            }
        }
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): CodeLens | Thenable<CodeLens> {
        if (lens instanceof GitRecentChangeCodeLens) return this.resolveGitRecentChangeCodeLens(lens, token);
        if (lens instanceof GitAuthorsCodeLens) return this.resolveGitAuthorsCodeLens(lens, token);
        return Promise.reject<CodeLens>(undefined);
    }

    private resolveGitRecentChangeCodeLens(lens: GitRecentChangeCodeLens, token: CancellationToken): CodeLens {
        // Since blame information isn't valid when there are unsaved changes -- update the lenses appropriately
        let title: string;
        if (lens.dirty) {
            if (this._config.codeLens.recentChange.enabled && this._config.codeLens.authors.enabled) {
                title = this._config.strings.codeLens.unsavedChanges.recentChangeAndAuthors;
            }
            else if (this._config.codeLens.recentChange.enabled) {
                title = this._config.strings.codeLens.unsavedChanges.recentChangeOnly;
            }
            else {
                title = this._config.strings.codeLens.unsavedChanges.authorsOnly;
            }

            lens.command = { title: title } as Command;
            return lens;
        }

        const blame = lens.getBlame();
        if (blame === undefined) return lens;

        const recentCommit = Iterables.first(blame.commits.values());
        title = `${recentCommit.author}, ${recentCommit.fromNow()}`;
        if (this._config.codeLens.debug) {
            title += ` [${SymbolKind[lens.symbolKind]}(${lens.range.start.character}-${lens.range.end.character}), Lines (${lens.blameRange.start.line + 1}-${lens.blameRange.end.line + 1}), Commit (${recentCommit.shortSha})]`;
        }

        switch (this._config.codeLens.recentChange.command) {
            case CodeLensCommand.DiffWithPrevious: return this.applyDiffWithPreviousCommand<GitRecentChangeCodeLens>(title, lens, blame, recentCommit);
            case CodeLensCommand.ShowQuickCommitDetails: return this.applyShowQuickCommitDetailsCommand<GitRecentChangeCodeLens>(title, lens, blame, recentCommit);
            case CodeLensCommand.ShowQuickCommitFileDetails: return this.applyShowQuickCommitFileDetailsCommand<GitRecentChangeCodeLens>(title, lens, blame, recentCommit);
            case CodeLensCommand.ShowQuickCurrentBranchHistory: return this.applyShowQuickCurrentBranchHistoryCommand<GitRecentChangeCodeLens>(title, lens, blame, recentCommit);
            case CodeLensCommand.ShowQuickFileHistory: return this.applyShowQuickFileHistoryCommand<GitRecentChangeCodeLens>(title, lens, blame, recentCommit);
            case CodeLensCommand.ToggleFileBlame: return this.applyToggleFileBlameCommand<GitRecentChangeCodeLens>(title, lens, blame);
            default: return lens;
        }
    }

    private resolveGitAuthorsCodeLens(lens: GitAuthorsCodeLens, token: CancellationToken): CodeLens {
        const blame = lens.getBlame();
        if (blame === undefined) return lens;

        const count = blame.authors.size;
        let title = `${count} ${count > 1 ? 'authors' : 'author'} (${Iterables.first(blame.authors.values()).name}${count > 1 ? ' and others' : ''})`;
        if (this._config.codeLens.debug) {
            title += ` [${SymbolKind[lens.symbolKind]}(${lens.range.start.character}-${lens.range.end.character}), Lines (${lens.blameRange.start.line + 1}-${lens.blameRange.end.line + 1}), Authors (${Iterables.join(Iterables.map(blame.authors.values(), _ => _.name), ', ')})]`;
        }

        switch (this._config.codeLens.authors.command) {
            case CodeLensCommand.DiffWithPrevious: return this.applyDiffWithPreviousCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ShowQuickCommitDetails: return this.applyShowQuickCommitDetailsCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ShowQuickCommitFileDetails: return this.applyShowQuickCommitFileDetailsCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ShowQuickCurrentBranchHistory: return this.applyShowQuickCurrentBranchHistoryCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ShowQuickFileHistory: return this.applyShowQuickFileHistoryCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ToggleFileBlame: return this.applyToggleFileBlameCommand<GitAuthorsCodeLens>(title, lens, blame);
            default: return lens;
        }
    }

    private applyDiffWithPreviousCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: GitBlameLines, commit?: GitBlameCommit): T {
        if (commit === undefined) {
            const blameLine = blame.allLines[lens.range.start.line];
            commit = blame.commits.get(blameLine.sha);
        }

        lens.command = {
            title: title,
            command: Commands.DiffWithPrevious,
            arguments: [
                Uri.file(lens.uri!.fsPath),
                {
                    commit: commit,
                    range: lens.isFullRange ? undefined : lens.blameRange
                } as DiffWithPreviousCommandArgs
            ]
        };
        return lens;
    }

    private applyShowQuickCommitDetailsCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: GitBlameLines, commit?: GitBlameCommit): T {
        lens.command = {
            title: title,
            command: commit !== undefined && commit.isUncommitted ? '' : CodeLensCommand.ShowQuickCommitDetails,
            arguments: [
                Uri.file(lens.uri!.fsPath),
                {
                    commit,
                    sha: commit === undefined ? undefined : commit.sha
                } as ShowQuickCommitDetailsCommandArgs]
        };
        return lens;
    }

    private applyShowQuickCommitFileDetailsCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: GitBlameLines, commit?: GitBlameCommit): T {
        lens.command = {
            title: title,
            command: commit !== undefined && commit.isUncommitted ? '' : CodeLensCommand.ShowQuickCommitFileDetails,
            arguments: [
                Uri.file(lens.uri!.fsPath),
                {
                    commit,
                    sha: commit === undefined ? undefined : commit.sha
                } as ShowQuickCommitFileDetailsCommandArgs]
        };
        return lens;
    }

    private applyShowQuickCurrentBranchHistoryCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: GitBlameLines, commit?: GitBlameCommit): T {
        lens.command = {
            title: title,
            command: CodeLensCommand.ShowQuickCurrentBranchHistory,
            arguments: [Uri.file(lens.uri!.fsPath)]
        };
        return lens;
    }

    private applyShowQuickFileHistoryCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: GitBlameLines, commit?: GitBlameCommit): T {
        lens.command = {
            title: title,
            command: CodeLensCommand.ShowQuickFileHistory,
            arguments: [
                Uri.file(lens.uri!.fsPath),
                {
                    range: lens.isFullRange ? undefined : lens.blameRange
                } as ShowQuickFileHistoryCommandArgs
            ]
        };
        return lens;
    }

    private applyToggleFileBlameCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(title: string, lens: T, blame: GitBlameLines): T {
        lens.command = {
            title: title,
            command: Commands.ToggleFileBlame,
            arguments: [Uri.file(lens.uri!.fsPath)]
        };
        return lens;
    }
}
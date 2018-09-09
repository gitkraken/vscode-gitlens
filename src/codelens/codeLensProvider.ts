'use strict';
import {
    CancellationToken,
    CodeLens,
    CodeLensProvider,
    Command,
    commands,
    DocumentSelector,
    Event,
    EventEmitter,
    ExtensionContext,
    Location,
    Position,
    Range,
    SymbolInformation,
    SymbolKind,
    TextDocument,
    Uri
} from 'vscode';
import {
    Commands,
    DiffWithPreviousCommandArgs,
    ShowQuickCommitDetailsCommandArgs,
    ShowQuickCommitFileDetailsCommandArgs,
    ShowQuickFileHistoryCommandArgs
} from '../commands';
import {
    CodeLensCommand,
    CodeLensLanguageScope,
    CodeLensScopes,
    configuration,
    ICodeLensConfig
} from '../configuration';
import { BuiltInCommands, DocumentSchemes } from '../constants';
import { Container } from '../container';
import { GitBlame, GitBlameCommit, GitBlameLines, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Functions, Iterables } from '../system';
import { DocumentTracker, GitDocumentState } from '../trackers/gitDocumentTracker';

export class GitRecentChangeCodeLens extends CodeLens {
    constructor(
        public readonly languageId: string,
        public readonly symbol: SymbolInformation,
        public readonly uri: GitUri | undefined,
        private readonly blame: (() => GitBlameLines | undefined) | undefined,
        public readonly blameRange: Range,
        public readonly isFullRange: boolean,
        range: Range,
        public readonly desiredCommand: CodeLensCommand,
        command?: Command | undefined
    ) {
        super(range, command);
    }

    getBlame(): GitBlameLines | undefined {
        return this.blame && this.blame();
    }
}

export class GitAuthorsCodeLens extends CodeLens {
    constructor(
        public readonly languageId: string,
        public readonly symbol: SymbolInformation,
        public readonly uri: GitUri | undefined,
        private readonly blame: () => GitBlameLines | undefined,
        public readonly blameRange: Range,
        public readonly isFullRange: boolean,
        range: Range,
        public readonly desiredCommand: CodeLensCommand
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

    static selector: DocumentSelector = [
        { scheme: DocumentSchemes.File },
        { scheme: DocumentSchemes.Git },
        { scheme: DocumentSchemes.GitLens }
    ];

    constructor(
        context: ExtensionContext,
        private readonly _git: GitService,
        private readonly _tracker: DocumentTracker<GitDocumentState>
    ) {}

    reset(reason?: 'idle' | 'saved') {
        this._onDidChangeCodeLenses.fire();
    }

    async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
        const trackedDocument = await this._tracker.getOrAdd(document);
        if (!trackedDocument.isBlameable) return [];

        let dirty = false;
        if (document.isDirty) {
            // Only allow dirty blames if we are idle
            if (trackedDocument.isDirtyIdle) {
                const maxLines = Container.config.advanced.blame.sizeThresholdAfterEdit;
                if (maxLines > 0 && document.lineCount > maxLines) {
                    dirty = true;
                }
            }
            else {
                dirty = true;
            }
        }

        const cfg = configuration.get<ICodeLensConfig>(configuration.name('codeLens').value, document.uri);

        let languageScope =
            cfg.scopesByLanguage &&
            cfg.scopesByLanguage.find(
                ll => ll.language !== undefined && ll.language.toLowerCase() === document.languageId
            );
        if (languageScope == null) {
            languageScope = {
                language: undefined
            } as CodeLensLanguageScope;
        }
        if (languageScope.scopes == null) {
            languageScope.scopes = cfg.scopes;
        }
        if (languageScope.symbolScopes == null) {
            languageScope.symbolScopes = cfg.symbolScopes;
        }

        languageScope.symbolScopes =
            languageScope.symbolScopes != null
                ? (languageScope.symbolScopes = languageScope.symbolScopes.map(s => s.toLowerCase()))
                : [];

        const lenses: CodeLens[] = [];

        const gitUri = trackedDocument.uri;
        let blame: GitBlame | undefined;
        let symbols;

        if (!dirty) {
            if (token.isCancellationRequested) return lenses;

            if (languageScope.scopes.length === 1 && languageScope.scopes.includes(CodeLensScopes.Document)) {
                blame = document.isDirty
                    ? await this._git.getBlameForFileContents(gitUri, document.getText())
                    : await this._git.getBlameForFile(gitUri);
            }
            else {
                [blame, symbols] = await Promise.all([
                    document.isDirty
                        ? this._git.getBlameForFileContents(gitUri, document.getText())
                        : this._git.getBlameForFile(gitUri),
                    commands.executeCommand(BuiltInCommands.ExecuteDocumentSymbolProvider, document.uri) as Promise<
                        SymbolInformation[]
                    >
                ]);
            }

            if (blame === undefined || blame.lines.length === 0) return lenses;
        }
        else {
            if (languageScope.scopes.length !== 1 || !languageScope.scopes.includes(CodeLensScopes.Document)) {
                symbols = (await commands.executeCommand(
                    BuiltInCommands.ExecuteDocumentSymbolProvider,
                    document.uri
                )) as SymbolInformation[];
            }
        }

        if (token.isCancellationRequested) return lenses;

        const documentRangeFn = Functions.once(() => document.validateRange(new Range(0, 1000000, 1000000, 1000000)));

        // Since blame information isn't valid when there are unsaved changes -- update the lenses appropriately
        const dirtyCommand = dirty ? ({ title: this.getDirtyTitle(cfg) } as Command) : undefined;

        if (symbols !== undefined) {
            Logger.log('GitCodeLensProvider.provideCodeLenses:', `${symbols.length} symbol(s) found`);
            symbols.forEach(sym =>
                this.provideCodeLens(
                    lenses,
                    document,
                    sym,
                    languageScope as Required<CodeLensLanguageScope>,
                    documentRangeFn,
                    blame,
                    gitUri,
                    cfg,
                    dirty,
                    dirtyCommand
                )
            );
        }

        if (
            (languageScope.scopes.includes(CodeLensScopes.Document) || languageScope.symbolScopes.includes('file')) &&
            !languageScope.symbolScopes.includes('!file')
        ) {
            // Check if we have a lens for the whole document -- if not add one
            if (!lenses.find(l => l.range.start.line === 0 && l.range.end.line === 0)) {
                const blameRange = documentRangeFn();

                let blameForRangeFn: (() => GitBlameLines | undefined) | undefined = undefined;
                if (dirty || cfg.recentChange.enabled) {
                    if (!dirty) {
                        blameForRangeFn = Functions.once(() =>
                            this._git.getBlameForRangeSync(blame!, gitUri!, blameRange)
                        );
                    }

                    const fileSymbol = new SymbolInformation(
                        gitUri.getFilename(),
                        SymbolKind.File,
                        '',
                        new Location(gitUri.documentUri(), new Range(0, 0, 0, blameRange.start.character))
                    );
                    lenses.push(
                        new GitRecentChangeCodeLens(
                            document.languageId,
                            fileSymbol,
                            gitUri,
                            blameForRangeFn,
                            blameRange,
                            true,
                            getRangeFromSymbol(fileSymbol),
                            cfg.recentChange.command,
                            dirtyCommand
                        )
                    );
                }
                if (!dirty && cfg.authors.enabled) {
                    if (blameForRangeFn === undefined) {
                        blameForRangeFn = Functions.once(() =>
                            this._git.getBlameForRangeSync(blame!, gitUri!, blameRange)
                        );
                    }

                    const fileSymbol = new SymbolInformation(
                        gitUri.getFilename(),
                        SymbolKind.File,
                        '',
                        new Location(gitUri.documentUri(), new Range(0, 1, 0, blameRange.start.character))
                    );
                    lenses.push(
                        new GitAuthorsCodeLens(
                            document.languageId,
                            fileSymbol,
                            gitUri,
                            blameForRangeFn,
                            blameRange,
                            true,
                            getRangeFromSymbol(fileSymbol),
                            cfg.authors.command
                        )
                    );
                }
            }
        }

        return lenses;
    }

    private validateSymbolAndGetBlameRange(
        symbol: SymbolInformation,
        languageScope: Required<CodeLensLanguageScope>,
        documentRangeFn: () => Range
    ): Range | undefined {
        let valid = false;
        let range: Range | undefined;

        const symbolName = SymbolKind[symbol.kind].toLowerCase();
        switch (symbol.kind) {
            case SymbolKind.File:
                if (
                    languageScope.scopes.includes(CodeLensScopes.Containers) ||
                    languageScope.symbolScopes!.includes(symbolName)
                ) {
                    valid = !languageScope.symbolScopes!.includes(`!${symbolName}`);
                }

                if (valid) {
                    // Adjust the range to be for the whole file
                    range = documentRangeFn();
                }
                break;

            case SymbolKind.Package:
                if (
                    languageScope.scopes.includes(CodeLensScopes.Containers) ||
                    languageScope.symbolScopes!.includes(symbolName)
                ) {
                    valid = !languageScope.symbolScopes!.includes(`!${symbolName}`);
                }

                if (valid) {
                    // Adjust the range to be for the whole file
                    if (getRangeFromSymbol(symbol).start.line === 0 && getRangeFromSymbol(symbol).end.line === 0) {
                        range = documentRangeFn();
                    }
                }
                break;

            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Module:
            case SymbolKind.Namespace:
            case SymbolKind.Struct:
                if (
                    languageScope.scopes.includes(CodeLensScopes.Containers) ||
                    languageScope.symbolScopes!.includes(symbolName)
                ) {
                    valid = !languageScope.symbolScopes!.includes(`!${symbolName}`);
                }
                break;

            case SymbolKind.Constructor:
            case SymbolKind.Enum:
            case SymbolKind.Function:
            case SymbolKind.Method:
                if (
                    languageScope.scopes.includes(CodeLensScopes.Blocks) ||
                    languageScope.symbolScopes!.includes(symbolName)
                ) {
                    valid = !languageScope.symbolScopes!.includes(`!${symbolName}`);
                }
                break;

            default:
                if (languageScope.symbolScopes!.includes(symbolName)) {
                    valid = !languageScope.symbolScopes!.includes(`!${symbolName}`);
                }
                break;
        }

        return valid ? range || getRangeFromSymbol(symbol) : undefined;
    }

    private provideCodeLens(
        lenses: CodeLens[],
        document: TextDocument,
        symbol: SymbolInformation,
        languageScope: Required<CodeLensLanguageScope>,
        documentRangeFn: () => Range,
        blame: GitBlame | undefined,
        gitUri: GitUri | undefined,
        cfg: ICodeLensConfig,
        dirty: boolean,
        dirtyCommand: Command | undefined
    ): void {
        const blameRange = this.validateSymbolAndGetBlameRange(symbol, languageScope, documentRangeFn);
        if (blameRange === undefined) return;

        const line = document.lineAt(getRangeFromSymbol(symbol).start);
        // Make sure there is only 1 lens per line
        if (lenses.length && lenses[lenses.length - 1].range.start.line === line.lineNumber) return;

        // Anchor the code lens to the start of the line -- so that the range won't change with edits (otherwise the code lens will be removed and re-added)
        let startChar = 0;

        let blameForRangeFn: (() => GitBlameLines | undefined) | undefined;
        if (dirty || cfg.recentChange.enabled) {
            if (!dirty) {
                blameForRangeFn = Functions.once(() => this._git.getBlameForRangeSync(blame!, gitUri!, blameRange));
            }
            lenses.push(
                new GitRecentChangeCodeLens(
                    document.languageId,
                    symbol,
                    gitUri,
                    blameForRangeFn,
                    blameRange,
                    false,
                    line.range.with(new Position(line.range.start.line, startChar)),
                    cfg.recentChange.command,
                    dirtyCommand
                )
            );
            startChar++;
        }

        if (cfg.authors.enabled) {
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
                    blameForRangeFn = Functions.once(() => this._git.getBlameForRangeSync(blame!, gitUri!, blameRange));
                }
                lenses.push(
                    new GitAuthorsCodeLens(
                        document.languageId,
                        symbol,
                        gitUri,
                        blameForRangeFn,
                        blameRange,
                        false,
                        line.range.with(new Position(line.range.start.line, startChar)),
                        cfg.authors.command
                    )
                );
            }
        }
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): CodeLens | Thenable<CodeLens> {
        if (lens instanceof GitRecentChangeCodeLens) return this.resolveGitRecentChangeCodeLens(lens, token);
        if (lens instanceof GitAuthorsCodeLens) return this.resolveGitAuthorsCodeLens(lens, token);
        return Promise.reject<CodeLens>(undefined);
    }

    private resolveGitRecentChangeCodeLens(lens: GitRecentChangeCodeLens, token: CancellationToken): CodeLens {
        const blame = lens.getBlame();
        if (blame === undefined) return lens;

        const recentCommit = Iterables.first(blame.commits.values());
        let title = `${recentCommit.author}, ${recentCommit.formattedDate}`;
        if (Container.config.debug) {
            title += ` [${lens.languageId}: ${SymbolKind[lens.symbol.kind]}(${lens.range.start.character}-${
                lens.range.end.character
            }${lens.symbol.containerName ? `|${lens.symbol.containerName}` : ''}), Lines (${lens.blameRange.start.line +
                1}-${lens.blameRange.end.line + 1}), Commit (${recentCommit.shortSha})]`;
        }

        switch (lens.desiredCommand) {
            case CodeLensCommand.DiffWithPrevious:
                return this.applyDiffWithPreviousCommand<GitRecentChangeCodeLens>(title, lens, blame, recentCommit);
            case CodeLensCommand.ShowQuickCommitDetails:
                return this.applyShowQuickCommitDetailsCommand<GitRecentChangeCodeLens>(
                    title,
                    lens,
                    blame,
                    recentCommit
                );
            case CodeLensCommand.ShowQuickCommitFileDetails:
                return this.applyShowQuickCommitFileDetailsCommand<GitRecentChangeCodeLens>(
                    title,
                    lens,
                    blame,
                    recentCommit
                );
            case CodeLensCommand.ShowQuickCurrentBranchHistory:
                return this.applyShowQuickCurrentBranchHistoryCommand<GitRecentChangeCodeLens>(
                    title,
                    lens,
                    blame,
                    recentCommit
                );
            case CodeLensCommand.ShowQuickFileHistory:
                return this.applyShowQuickFileHistoryCommand<GitRecentChangeCodeLens>(title, lens, blame, recentCommit);
            case CodeLensCommand.ToggleFileBlame:
                return this.applyToggleFileBlameCommand<GitRecentChangeCodeLens>(title, lens, blame);
            default:
                return lens;
        }
    }

    private resolveGitAuthorsCodeLens(lens: GitAuthorsCodeLens, token: CancellationToken): CodeLens {
        const blame = lens.getBlame();
        if (blame === undefined) return lens;

        const count = blame.authors.size;
        let title = `${count} ${count > 1 ? 'authors' : 'author'} (${Iterables.first(blame.authors.values()).name}${
            count > 1 ? ' and others' : ''
        })`;
        if (Container.config.debug) {
            title += ` [${lens.languageId}: ${SymbolKind[lens.symbol.kind]}(${lens.range.start.character}-${
                lens.range.end.character
            }${lens.symbol.containerName ? `|${lens.symbol.containerName}` : ''}), Lines (${lens.blameRange.start.line +
                1}-${lens.blameRange.end.line + 1}), Authors (${Iterables.join(
                Iterables.map(blame.authors.values(), a => a.name),
                ', '
            )})]`;
        }

        switch (lens.desiredCommand) {
            case CodeLensCommand.DiffWithPrevious:
                return this.applyDiffWithPreviousCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ShowQuickCommitDetails:
                return this.applyShowQuickCommitDetailsCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ShowQuickCommitFileDetails:
                return this.applyShowQuickCommitFileDetailsCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ShowQuickCurrentBranchHistory:
                return this.applyShowQuickCurrentBranchHistoryCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ShowQuickFileHistory:
                return this.applyShowQuickFileHistoryCommand<GitAuthorsCodeLens>(title, lens, blame);
            case CodeLensCommand.ToggleFileBlame:
                return this.applyToggleFileBlameCommand<GitAuthorsCodeLens>(title, lens, blame);
            default:
                return lens;
        }
    }

    private applyDiffWithPreviousCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
        title: string,
        lens: T,
        blame: GitBlameLines,
        commit?: GitBlameCommit
    ): T {
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
                    commit: commit
                } as DiffWithPreviousCommandArgs
            ]
        };
        return lens;
    }

    private applyShowQuickCommitDetailsCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
        title: string,
        lens: T,
        blame: GitBlameLines,
        commit?: GitBlameCommit
    ): T {
        lens.command = {
            title: title,
            command: commit !== undefined && commit.isUncommitted ? '' : CodeLensCommand.ShowQuickCommitDetails,
            arguments: [
                Uri.file(lens.uri!.fsPath),
                {
                    commit,
                    sha: commit === undefined ? undefined : commit.sha
                } as ShowQuickCommitDetailsCommandArgs
            ]
        };
        return lens;
    }

    private applyShowQuickCommitFileDetailsCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
        title: string,
        lens: T,
        blame: GitBlameLines,
        commit?: GitBlameCommit
    ): T {
        lens.command = {
            title: title,
            command: commit !== undefined && commit.isUncommitted ? '' : CodeLensCommand.ShowQuickCommitFileDetails,
            arguments: [
                Uri.file(lens.uri!.fsPath),
                {
                    commit,
                    sha: commit === undefined ? undefined : commit.sha
                } as ShowQuickCommitFileDetailsCommandArgs
            ]
        };
        return lens;
    }

    private applyShowQuickCurrentBranchHistoryCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
        title: string,
        lens: T,
        blame: GitBlameLines,
        commit?: GitBlameCommit
    ): T {
        lens.command = {
            title: title,
            command: CodeLensCommand.ShowQuickCurrentBranchHistory,
            arguments: [Uri.file(lens.uri!.fsPath)]
        };
        return lens;
    }

    private applyShowQuickFileHistoryCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
        title: string,
        lens: T,
        blame: GitBlameLines,
        commit?: GitBlameCommit
    ): T {
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

    private applyToggleFileBlameCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
        title: string,
        lens: T,
        blame: GitBlameLines
    ): T {
        lens.command = {
            title: title,
            command: Commands.ToggleFileBlame,
            arguments: [Uri.file(lens.uri!.fsPath)]
        };
        return lens;
    }

    private getDirtyTitle(cfg: ICodeLensConfig) {
        if (cfg.recentChange.enabled && cfg.authors.enabled) {
            return Container.config.strings.codeLens.unsavedChanges.recentChangeAndAuthors;
        }
        if (cfg.recentChange.enabled) return Container.config.strings.codeLens.unsavedChanges.recentChangeOnly;
        return Container.config.strings.codeLens.unsavedChanges.authorsOnly;
    }
}

function getRangeFromSymbol(symbol: SymbolInformation) {
    // Normalize the range to deal with the new api
    return (symbol.location && symbol.location.range) || (symbol as any).range;
}

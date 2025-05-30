import type {
	CancellationToken,
	CodeLensProvider,
	Command,
	DocumentSelector,
	DocumentSymbol,
	Event,
	TextDocument,
	Uri,
} from 'vscode';
import { CodeLens, EventEmitter, Location, Position, Range, SymbolInformation, SymbolKind } from 'vscode';
import type {
	DiffWithPreviousCommandArgs,
	OpenOnRemoteCommandArgs,
	ShowCommitsInViewCommandArgs,
	ShowQuickCommitCommandArgs,
	ShowQuickCommitFileCommandArgs,
	ShowQuickFileHistoryCommandArgs,
	ToggleFileChangesAnnotationCommandArgs,
} from '../commands';
import type { CodeLensConfig, CodeLensLanguageScope } from '../config';
import { CodeLensCommand, CodeLensScopes, FileAnnotationType } from '../config';
import { Commands, Schemes } from '../constants';
import type { Container } from '../container';
import type { GitUri } from '../git/gitUri';
import type { GitBlame, GitBlameLines } from '../git/models/blame';
import type { GitCommit } from '../git/models/commit';
import { RemoteResourceType } from '../git/models/remoteResource';
import { asCommand, executeCoreCommand } from '../system/command';
import { configuration } from '../system/configuration';
import { is, once } from '../system/function';
import { filterMap, find, first, join, map } from '../system/iterable';
import { Logger } from '../system/logger';
import { isVirtualUri } from '../system/utils';

class GitRecentChangeCodeLens extends CodeLens {
	constructor(
		public readonly languageId: string,
		public readonly symbol: DocumentSymbol | SymbolInformation,
		public readonly uri: GitUri | undefined,
		public readonly dateFormat: string | null,
		private readonly blame: (() => GitBlameLines | undefined) | undefined,
		public readonly blameRange: Range,
		public readonly isFullRange: boolean,
		range: Range,
		public readonly desiredCommand: CodeLensCommand | false,
		command?: Command | undefined,
	) {
		super(range, command);
	}

	getBlame(): GitBlameLines | undefined {
		return this.blame?.();
	}
}

class GitAuthorsCodeLens extends CodeLens {
	constructor(
		public readonly languageId: string,
		public readonly symbol: DocumentSymbol | SymbolInformation,
		public readonly uri: GitUri | undefined,
		private readonly blame: () => GitBlameLines | undefined,
		public readonly blameRange: Range,
		public readonly isFullRange: boolean,
		range: Range,
		public readonly desiredCommand: CodeLensCommand | false,
	) {
		super(range);
	}

	getBlame(): GitBlameLines | undefined {
		return this.blame();
	}
}

export class GitCodeLensProvider implements CodeLensProvider {
	static selector: DocumentSelector = [
		{ scheme: Schemes.File },
		{ scheme: Schemes.Git },
		{ scheme: Schemes.GitLens },
		{ scheme: Schemes.PRs },
		{ scheme: Schemes.Vsls },
		{ scheme: Schemes.VslsScc },
		{ scheme: Schemes.Virtual },
		{ scheme: Schemes.GitHub },
	];

	private _onDidChangeCodeLenses = new EventEmitter<void>();
	get onDidChangeCodeLenses(): Event<void> {
		return this._onDidChangeCodeLenses.event;
	}

	constructor(private readonly container: Container) {}

	reset(_reason?: 'idle' | 'saved') {
		this._onDidChangeCodeLenses.fire();
	}

	async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
		// Since we can't currently blame edited virtual documents, don't even attempt anything if dirty
		if (document.isDirty && isVirtualUri(document.uri)) return [];

		const trackedDocument = await this.container.tracker.getOrAdd(document);
		if (!trackedDocument.isBlameable) return [];

		let dirty = false;
		if (document.isDirty) {
			// Only allow dirty blames if we are idle
			if (trackedDocument.isDirtyIdle) {
				const maxLines = configuration.get('advanced.blame.sizeThresholdAfterEdit');
				if (maxLines > 0 && document.lineCount > maxLines) {
					dirty = true;
				}
			} else {
				dirty = true;
			}
		}

		const cfg = configuration.get('codeLens', document);
		let languageScope = cfg.scopesByLanguage?.find(ll => ll.language?.toLowerCase() === document.languageId);
		if (languageScope == null) {
			languageScope = {
				language: document.languageId,
			};
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
				blame = await this.container.git.getBlame(gitUri, document);
			} else {
				[blame, symbols] = await Promise.all([
					this.container.git.getBlame(gitUri, document),
					executeCoreCommand<[Uri], SymbolInformation[]>(
						'vscode.executeDocumentSymbolProvider',
						document.uri,
					),
				]);
			}

			if (blame == null || blame?.lines.length === 0) return lenses;
		} else if (languageScope.scopes.length !== 1 || !languageScope.scopes.includes(CodeLensScopes.Document)) {
			let tracked;
			[tracked, symbols] = await Promise.all([
				this.container.git.isTracked(gitUri),
				executeCoreCommand<[Uri], SymbolInformation[]>('vscode.executeDocumentSymbolProvider', document.uri),
			]);

			if (!tracked) return lenses;
		}

		if (token.isCancellationRequested) return lenses;

		const documentRangeFn = once(() => document.validateRange(new Range(0, 0, 1000000, 1000000)));

		// Since blame information isn't valid when there are unsaved changes -- update the lenses appropriately
		const dirtyCommand: Command | undefined = dirty
			? { command: undefined!, title: this.getDirtyTitle(cfg) }
			: undefined;

		if (symbols !== undefined) {
			Logger.log('GitCodeLensProvider.provideCodeLenses:', `${symbols.length} symbol(s) found`);
			for (const sym of symbols) {
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
					dirtyCommand,
				);
			}
		}

		if (
			(languageScope.scopes.includes(CodeLensScopes.Document) || languageScope.symbolScopes.includes('file')) &&
			!languageScope.symbolScopes.includes('!file')
		) {
			// Check if we have a lens for the whole document -- if not add one
			if (lenses.find(l => l.range.start.line === 0 && l.range.end.line === 0) == null) {
				const blameRange = documentRangeFn();

				let blameForRangeFn: (() => GitBlameLines | undefined) | undefined = undefined;
				if (dirty || cfg.recentChange.enabled) {
					if (!dirty) {
						blameForRangeFn = once(() => this.container.git.getBlameRange(blame!, gitUri, blameRange));
					}

					const fileSymbol = new SymbolInformation(
						gitUri.fileName,
						SymbolKind.File,
						'',
						new Location(gitUri.documentUri(), new Range(0, 0, 0, blameRange.start.character)),
					);
					lenses.push(
						new GitRecentChangeCodeLens(
							document.languageId,
							fileSymbol,
							gitUri,
							cfg.dateFormat,
							blameForRangeFn,
							blameRange,
							true,
							getRangeFromSymbol(fileSymbol),
							cfg.recentChange.command,
							dirtyCommand,
						),
					);
				}
				if (!dirty && cfg.authors.enabled) {
					if (blameForRangeFn === undefined) {
						blameForRangeFn = once(() => this.container.git.getBlameRange(blame!, gitUri, blameRange));
					}

					const fileSymbol = new SymbolInformation(
						gitUri.fileName,
						SymbolKind.File,
						'',
						new Location(gitUri.documentUri(), new Range(0, 1, 0, blameRange.start.character)),
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
							cfg.authors.command,
						),
					);
				}
			}
		}

		return lenses;
	}

	private getValidateSymbolRange(
		symbol: SymbolInformation | DocumentSymbol,
		languageScope: Required<CodeLensLanguageScope>,
		documentRangeFn: () => Range,
		includeSingleLineSymbols: boolean,
	): Range | undefined {
		let valid = false;
		let range: Range | undefined;

		const symbolName = SymbolKind[symbol.kind].toLowerCase();
		switch (symbol.kind) {
			case SymbolKind.File:
				if (
					languageScope.scopes.includes(CodeLensScopes.Containers) ||
					languageScope.symbolScopes.includes(symbolName)
				) {
					valid = !languageScope.symbolScopes.includes(`!${symbolName}`);
				}

				if (valid) {
					// Adjust the range to be for the whole file
					range = documentRangeFn();
				}
				break;

			case SymbolKind.Package:
				if (
					languageScope.scopes.includes(CodeLensScopes.Containers) ||
					languageScope.symbolScopes.includes(symbolName)
				) {
					valid = !languageScope.symbolScopes.includes(`!${symbolName}`);
				}

				if (valid) {
					// Adjust the range to be for the whole file
					range = getRangeFromSymbol(symbol);
					if (range.start.line === 0 && range.end.line === 0) {
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
					languageScope.symbolScopes.includes(symbolName)
				) {
					range = getRangeFromSymbol(symbol);
					valid =
						!languageScope.symbolScopes.includes(`!${symbolName}`) &&
						(includeSingleLineSymbols || !range.isSingleLine);
				}
				break;

			case SymbolKind.Constructor:
			case SymbolKind.Enum:
			case SymbolKind.Function:
			case SymbolKind.Method:
			case SymbolKind.Property:
				if (
					languageScope.scopes.includes(CodeLensScopes.Blocks) ||
					languageScope.symbolScopes.includes(symbolName)
				) {
					range = getRangeFromSymbol(symbol);
					valid =
						!languageScope.symbolScopes.includes(`!${symbolName}`) &&
						(includeSingleLineSymbols || !range.isSingleLine);
				}
				break;

			case SymbolKind.String:
				if (
					languageScope.symbolScopes.includes(symbolName) ||
					// A special case for markdown files, SymbolKind.String seems to be returned for headers, so consider those containers
					(languageScope.language === 'markdown' && languageScope.scopes.includes(CodeLensScopes.Containers))
				) {
					range = getRangeFromSymbol(symbol);
					valid =
						!languageScope.symbolScopes.includes(`!${symbolName}`) &&
						(includeSingleLineSymbols || !range.isSingleLine);
				}
				break;

			default:
				if (languageScope.symbolScopes.includes(symbolName)) {
					range = getRangeFromSymbol(symbol);
					valid =
						!languageScope.symbolScopes.includes(`!${symbolName}`) &&
						(includeSingleLineSymbols || !range.isSingleLine);
				}
				break;
		}

		return valid ? range ?? getRangeFromSymbol(symbol) : undefined;
	}

	private provideCodeLens(
		lenses: CodeLens[],
		document: TextDocument,
		symbol: SymbolInformation | DocumentSymbol,
		languageScope: Required<CodeLensLanguageScope>,
		documentRangeFn: () => Range,
		blame: GitBlame | undefined,
		gitUri: GitUri | undefined,
		cfg: CodeLensConfig,
		dirty: boolean,
		dirtyCommand: Command | undefined,
	): void {
		try {
			const blameRange = this.getValidateSymbolRange(
				symbol,
				languageScope,
				documentRangeFn,
				cfg.includeSingleLineSymbols,
			);
			if (blameRange === undefined) return;

			const line = document.lineAt(getRangeFromSymbol(symbol).start);
			// Make sure there is only 1 lens per line
			if (lenses.length && lenses[lenses.length - 1].range.start.line === line.lineNumber) return;

			// Anchor the CodeLens to the start of the line -- so that the range won't change with edits (otherwise the CodeLens will be removed and re-added)
			let startChar = 0;

			let blameForRangeFn: (() => GitBlameLines | undefined) | undefined;
			if (dirty || cfg.recentChange.enabled) {
				if (!dirty) {
					blameForRangeFn = once(() => this.container.git.getBlameRange(blame!, gitUri!, blameRange));
				}
				lenses.push(
					new GitRecentChangeCodeLens(
						document.languageId,
						symbol,
						gitUri,
						cfg.dateFormat,
						blameForRangeFn,
						blameRange,
						false,
						line.range.with(new Position(line.range.start.line, startChar)),
						cfg.recentChange.command,
						dirtyCommand,
					),
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
						blameForRangeFn = once(() => this.container.git.getBlameRange(blame!, gitUri!, blameRange));
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
							cfg.authors.command,
						),
					);
				}
			}
		} finally {
			if (isDocumentSymbol(symbol)) {
				for (const child of symbol.children) {
					this.provideCodeLens(
						lenses,
						document,
						child,
						languageScope,
						documentRangeFn,
						blame,
						gitUri,
						cfg,
						dirty,
						dirtyCommand,
					);
				}
			}
		}
	}

	resolveCodeLens(lens: CodeLens, token: CancellationToken): CodeLens | Promise<CodeLens> {
		if (lens instanceof GitRecentChangeCodeLens) return this.resolveGitRecentChangeCodeLens(lens, token);
		if (lens instanceof GitAuthorsCodeLens) return this.resolveGitAuthorsCodeLens(lens, token);
		// eslint-disable-next-line prefer-promise-reject-errors
		return Promise.reject<CodeLens>(undefined);
	}

	private resolveGitRecentChangeCodeLens(lens: GitRecentChangeCodeLens, _token: CancellationToken): CodeLens {
		const blame = lens.getBlame();
		if (blame == null) return lens;

		const recentCommit = first(blame.commits.values());
		if (recentCommit == null) return lens;

		// TODO@eamodio This is FAR too expensive, but this accounts for commits that delete lines -- is there another way?
		// if (lens.uri != null) {
		// 	const commit = await this.container.git.getCommitForFile(lens.uri.repoPath, lens.uri.fsPath, {
		// 		range: lens.blameRange,
		// 	});
		// 	if (
		// 		commit != null &&
		// 		commit.sha !== recentCommit.sha &&
		// 		commit.date.getTime() > recentCommit.date.getTime()
		// 	) {
		// 		recentCommit = commit;
		// 	}
		// }

		let title = `${recentCommit.author.name}, ${
			lens.dateFormat == null ? recentCommit.formattedDate : recentCommit.formatDate(lens.dateFormat)
		}`;
		if (configuration.get('debug')) {
			title += ` [${lens.languageId}: ${SymbolKind[lens.symbol.kind]}(${lens.range.start.character}-${
				lens.range.end.character
			}${
				(lens.symbol as SymbolInformation).containerName
					? `|${(lens.symbol as SymbolInformation).containerName}`
					: ''
			}), Lines (${lens.blameRange.start.line + 1}-${lens.blameRange.end.line + 1}), Commit (${
				recentCommit.shortSha
			})]`;
		}

		if (lens.desiredCommand === false) {
			return applyCommandWithNoClickAction(title, lens);
		}

		switch (lens.desiredCommand) {
			case CodeLensCommand.CopyRemoteCommitUrl:
				return applyCopyOrOpenCommitOnRemoteCommand<GitRecentChangeCodeLens>(title, lens, recentCommit, true);
			case CodeLensCommand.CopyRemoteFileUrl:
				return applyCopyOrOpenFileOnRemoteCommand<GitRecentChangeCodeLens>(title, lens, recentCommit, true);
			case CodeLensCommand.DiffWithPrevious:
				return applyDiffWithPreviousCommand<GitRecentChangeCodeLens>(title, lens, recentCommit);
			case CodeLensCommand.OpenCommitOnRemote:
				return applyCopyOrOpenCommitOnRemoteCommand<GitRecentChangeCodeLens>(title, lens, recentCommit);
			case CodeLensCommand.OpenFileOnRemote:
				return applyCopyOrOpenFileOnRemoteCommand<GitRecentChangeCodeLens>(title, lens, recentCommit);
			case CodeLensCommand.RevealCommitInView:
				return applyRevealCommitInViewCommand<GitRecentChangeCodeLens>(title, lens, recentCommit);
			case CodeLensCommand.ShowCommitsInView:
				return applyShowCommitsInViewCommand<GitRecentChangeCodeLens>(title, lens, blame, recentCommit);
			case CodeLensCommand.ShowQuickCommitDetails:
				return applyShowQuickCommitDetailsCommand<GitRecentChangeCodeLens>(title, lens, recentCommit);
			case CodeLensCommand.ShowQuickCommitFileDetails:
				return applyShowQuickCommitFileDetailsCommand<GitRecentChangeCodeLens>(title, lens, recentCommit);
			case CodeLensCommand.ShowQuickCurrentBranchHistory:
				return applyShowQuickCurrentBranchHistoryCommand<GitRecentChangeCodeLens>(title, lens);
			case CodeLensCommand.ShowQuickFileHistory:
				return applyShowQuickFileHistoryCommand<GitRecentChangeCodeLens>(title, lens);
			case CodeLensCommand.ToggleFileBlame:
				return applyToggleFileBlameCommand<GitRecentChangeCodeLens>(title, lens);
			case CodeLensCommand.ToggleFileChanges:
				return applyToggleFileChangesCommand<GitRecentChangeCodeLens>(title, lens, recentCommit);
			case CodeLensCommand.ToggleFileChangesOnly:
				return applyToggleFileChangesCommand<GitRecentChangeCodeLens>(title, lens, recentCommit, true);
			case CodeLensCommand.ToggleFileHeatmap:
				return applyToggleFileHeatmapCommand<GitRecentChangeCodeLens>(title, lens);
			default:
				return lens;
		}
	}

	private resolveGitAuthorsCodeLens(lens: GitAuthorsCodeLens, _token: CancellationToken): CodeLens {
		const blame = lens.getBlame();
		if (blame == null) return lens;

		const count = blame.authors.size;
		const author = first(blame.authors.values())?.name ?? 'Unknown';

		let title = `${count} ${count > 1 ? 'authors' : 'author'} (${author}${count > 1 ? ' and others' : ''})`;
		if (configuration.get('debug')) {
			title += ` [${lens.languageId}: ${SymbolKind[lens.symbol.kind]}(${lens.range.start.character}-${
				lens.range.end.character
			}${
				(lens.symbol as SymbolInformation).containerName
					? `|${(lens.symbol as SymbolInformation).containerName}`
					: ''
			}), Lines (${lens.blameRange.start.line + 1}-${lens.blameRange.end.line + 1}), Authors (${join(
				map(blame.authors.values(), a => a.name),
				', ',
			)})]`;
		}

		if (lens.desiredCommand === false) {
			return applyCommandWithNoClickAction(title, lens);
		}

		const commit = find(blame.commits.values(), c => c.author.name === author) ?? first(blame.commits.values());
		if (commit == null) return lens;

		switch (lens.desiredCommand) {
			case CodeLensCommand.CopyRemoteCommitUrl:
				return applyCopyOrOpenCommitOnRemoteCommand<GitAuthorsCodeLens>(title, lens, commit, true);
			case CodeLensCommand.CopyRemoteFileUrl:
				return applyCopyOrOpenFileOnRemoteCommand<GitAuthorsCodeLens>(title, lens, commit, true);
			case CodeLensCommand.DiffWithPrevious:
				return applyDiffWithPreviousCommand<GitAuthorsCodeLens>(title, lens, commit);
			case CodeLensCommand.OpenCommitOnRemote:
				return applyCopyOrOpenCommitOnRemoteCommand<GitAuthorsCodeLens>(title, lens, commit);
			case CodeLensCommand.OpenFileOnRemote:
				return applyCopyOrOpenFileOnRemoteCommand<GitAuthorsCodeLens>(title, lens, commit);
			case CodeLensCommand.RevealCommitInView:
				return applyRevealCommitInViewCommand<GitAuthorsCodeLens>(title, lens, commit);
			case CodeLensCommand.ShowCommitsInView:
				return applyShowCommitsInViewCommand<GitAuthorsCodeLens>(title, lens, blame);
			case CodeLensCommand.ShowQuickCommitDetails:
				return applyShowQuickCommitDetailsCommand<GitAuthorsCodeLens>(title, lens, commit);
			case CodeLensCommand.ShowQuickCommitFileDetails:
				return applyShowQuickCommitFileDetailsCommand<GitAuthorsCodeLens>(title, lens, commit);
			case CodeLensCommand.ShowQuickCurrentBranchHistory:
				return applyShowQuickCurrentBranchHistoryCommand<GitAuthorsCodeLens>(title, lens);
			case CodeLensCommand.ShowQuickFileHistory:
				return applyShowQuickFileHistoryCommand<GitAuthorsCodeLens>(title, lens);
			case CodeLensCommand.ToggleFileBlame:
				return applyToggleFileBlameCommand<GitAuthorsCodeLens>(title, lens);
			case CodeLensCommand.ToggleFileChanges:
				return applyToggleFileChangesCommand<GitAuthorsCodeLens>(title, lens, commit);
			case CodeLensCommand.ToggleFileChangesOnly:
				return applyToggleFileChangesCommand<GitAuthorsCodeLens>(title, lens, commit, true);
			case CodeLensCommand.ToggleFileHeatmap:
				return applyToggleFileHeatmapCommand<GitAuthorsCodeLens>(title, lens);
			default:
				return lens;
		}
	}

	private getDirtyTitle(cfg: CodeLensConfig) {
		if (cfg.recentChange.enabled && cfg.authors.enabled) {
			return configuration.get('strings.codeLens.unsavedChanges.recentChangeAndAuthors');
		}
		if (cfg.recentChange.enabled) return configuration.get('strings.codeLens.unsavedChanges.recentChangeOnly');
		return configuration.get('strings.codeLens.unsavedChanges.authorsOnly');
	}
}

function applyDiffWithPreviousCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
	commit: GitCommit | undefined,
): T {
	lens.command = asCommand<[undefined, DiffWithPreviousCommandArgs]>({
		title: title,
		command: Commands.DiffWithPrevious,
		arguments: [
			undefined,
			{
				commit: commit,
				uri: lens.uri!.toFileUri(),
			},
		],
	});
	return lens;
}

function applyCopyOrOpenCommitOnRemoteCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
	commit: GitCommit,
	clipboard: boolean = false,
): T {
	lens.command = asCommand<[OpenOnRemoteCommandArgs]>({
		title: title,
		command: Commands.OpenOnRemote,
		arguments: [
			{
				resource: {
					type: RemoteResourceType.Commit,
					sha: commit.sha,
				},
				repoPath: commit.repoPath,
				clipboard: clipboard,
			},
		],
	});
	return lens;
}

function applyCopyOrOpenFileOnRemoteCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
	commit: GitCommit,
	clipboard: boolean = false,
): T {
	lens.command = asCommand<[OpenOnRemoteCommandArgs]>({
		title: title,
		command: Commands.OpenOnRemote,
		arguments: [
			{
				resource: {
					type: RemoteResourceType.Revision,
					fileName: commit.file?.path ?? '',
					sha: commit.sha,
				},
				repoPath: commit.repoPath,
				clipboard: clipboard,
			},
		],
	});
	return lens;
}

function applyRevealCommitInViewCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
	commit: GitCommit | undefined,
): T {
	lens.command = asCommand<[Uri, ShowQuickCommitCommandArgs]>({
		title: title,
		command: commit?.isUncommitted ? '' : CodeLensCommand.RevealCommitInView,
		arguments: [
			lens.uri!.toFileUri(),
			{
				commit: commit,
				sha: commit === undefined ? undefined : commit.sha,
			},
		],
	});
	return lens;
}

function applyShowCommitsInViewCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
	blame: GitBlameLines,
	commit?: GitCommit,
): T {
	let refs;
	if (commit === undefined) {
		refs = [...filterMap(blame.commits.values(), c => (c.isUncommitted ? undefined : c.ref))];
	} else {
		refs = [commit.ref];
	}

	lens.command = asCommand<[ShowCommitsInViewCommandArgs]>({
		title: title,
		command: refs.length === 0 ? '' : Commands.ShowCommitsInView,
		arguments: [
			{
				repoPath: blame.repoPath,
				refs: refs,
			},
		],
	});
	return lens;
}

function applyShowQuickCommitDetailsCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
	commit: GitCommit | undefined,
): T {
	lens.command = asCommand<[Uri, ShowQuickCommitCommandArgs]>({
		title: title,
		command: commit?.isUncommitted ? '' : CodeLensCommand.ShowQuickCommitDetails,
		arguments: [
			lens.uri!.toFileUri(),
			{
				commit: commit,
				sha: commit === undefined ? undefined : commit.sha,
			},
		],
	});
	return lens;
}

function applyShowQuickCommitFileDetailsCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
	commit: GitCommit | undefined,
): T {
	lens.command = asCommand<[Uri, ShowQuickCommitFileCommandArgs]>({
		title: title,
		command: commit?.isUncommitted ? '' : CodeLensCommand.ShowQuickCommitFileDetails,
		arguments: [
			lens.uri!.toFileUri(),
			{
				commit: commit,
				sha: commit === undefined ? undefined : commit.sha,
			},
		],
	});
	return lens;
}

function applyShowQuickCurrentBranchHistoryCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
): T {
	lens.command = asCommand<[Uri]>({
		title: title,
		command: CodeLensCommand.ShowQuickCurrentBranchHistory,
		arguments: [lens.uri!.toFileUri()],
	});
	return lens;
}

function applyShowQuickFileHistoryCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
): T {
	lens.command = asCommand<[Uri, ShowQuickFileHistoryCommandArgs]>({
		title: title,
		command: CodeLensCommand.ShowQuickFileHistory,
		arguments: [
			lens.uri!.toFileUri(),
			{
				range: lens.isFullRange ? undefined : lens.blameRange,
			},
		],
	});
	return lens;
}

function applyToggleFileBlameCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
): T {
	lens.command = asCommand<[Uri]>({
		title: title,
		command: Commands.ToggleFileBlame,
		arguments: [lens.uri!.toFileUri()],
	});
	return lens;
}

function applyToggleFileChangesCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
	commit: GitCommit,
	only?: boolean,
): T {
	lens.command = asCommand<[Uri, ToggleFileChangesAnnotationCommandArgs]>({
		title: title,
		command: Commands.ToggleFileChanges,
		arguments: [
			lens.uri!.toFileUri(),
			{
				type: FileAnnotationType.Changes,
				context: { sha: commit.sha, only: only, selection: false },
			},
		],
	});
	return lens;
}

function applyToggleFileHeatmapCommand<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
): T {
	lens.command = asCommand<[Uri]>({
		title: title,
		command: Commands.ToggleFileHeatmap,
		arguments: [lens.uri!.toFileUri()],
	});
	return lens;
}

function applyCommandWithNoClickAction<T extends GitRecentChangeCodeLens | GitAuthorsCodeLens>(
	title: string,
	lens: T,
): T {
	lens.command = {
		title: title,
		command: '',
	};
	return lens;
}

function getRangeFromSymbol(symbol: DocumentSymbol | SymbolInformation) {
	return isDocumentSymbol(symbol) ? symbol.range : symbol.location.range;
}

function isDocumentSymbol(symbol: DocumentSymbol | SymbolInformation): symbol is DocumentSymbol {
	return is<DocumentSymbol>(symbol, 'children');
}

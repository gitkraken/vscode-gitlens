'use strict';
import * as paths from 'path';
import {
	commands,
	Disposable,
	ExtensionContext,
	SourceControl,
	SourceControlResourceGroup,
	SourceControlResourceState,
	TextDocumentShowOptions,
	TextEditor,
	TextEditorEdit,
	Uri,
	ViewColumn,
	window,
	workspace,
} from 'vscode';
import { BuiltInCommands, DocumentSchemes, ImageMimetypes } from '../constants';
import { Container } from '../container';
import { GitBranch, GitCommit, GitContributor, GitFile, GitRemote, Repository } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { CommandQuickPickItem, RepositoryPicker } from '../quickpicks';
import { ViewNode, ViewRefNode } from '../views/nodes';

export enum Commands {
	AddAuthors = 'gitlens.addAuthors',
	BrowseRepoAtRevision = 'gitlens.browseRepoAtRevision',
	BrowseRepoAtRevisionInNewWindow = 'gitlens.browseRepoAtRevisionInNewWindow',
	ClearFileAnnotations = 'gitlens.clearFileAnnotations',
	CloseUnchangedFiles = 'gitlens.closeUnchangedFiles',
	CloseWelcomeView = 'gitlens.closeWelcomeView',
	ComputingFileAnnotations = 'gitlens.computingFileAnnotations',
	ConnectRemoteProvider = 'gitlens.connectRemoteProvider',
	CopyMessageToClipboard = 'gitlens.copyMessageToClipboard',
	CopyRemoteBranchesUrl = 'gitlens.copyRemoteBranchesUrl',
	CopyRemoteBranchUrl = 'gitlens.copyRemoteBranchUrl',
	CopyRemoteCommitUrl = 'gitlens.copyRemoteCommitUrl',
	CopyRemoteFileUrl = 'gitlens.copyRemoteFileUrlToClipboard',
	CopyRemoteRepositoryUrl = 'gitlens.copyRemoteRepositoryUrl',
	CopyShaToClipboard = 'gitlens.copyShaToClipboard',
	DiffDirectory = 'gitlens.diffDirectory',
	DiffDirectoryWithHead = 'gitlens.diffDirectoryWithHead',
	DiffHeadWith = 'gitlens.diffHeadWith',
	DiffWorkingWith = 'gitlens.diffWorkingWith',
	DiffWith = 'gitlens.diffWith',
	DiffWithNext = 'gitlens.diffWithNext',
	DiffWithNextInDiffLeft = 'gitlens.diffWithNextInDiffLeft',
	DiffWithNextInDiffRight = 'gitlens.diffWithNextInDiffRight',
	DiffWithPrevious = 'gitlens.diffWithPrevious',
	DiffWithPreviousInDiffLeft = 'gitlens.diffWithPreviousInDiffLeft',
	DiffWithPreviousInDiffRight = 'gitlens.diffWithPreviousInDiffRight',
	DiffLineWithPrevious = 'gitlens.diffLineWithPrevious',
	DiffWithRevision = 'gitlens.diffWithRevision',
	DiffWithRevisionFrom = 'gitlens.diffWithRevisionFrom',
	DiffWithWorking = 'gitlens.diffWithWorking',
	DiffWithWorkingInDiffLeft = 'gitlens.diffWithWorkingInDiffLeft',
	DiffWithWorkingInDiffRight = 'gitlens.diffWithWorkingInDiffRight',
	DiffLineWithWorking = 'gitlens.diffLineWithWorking',
	DisconnectRemoteProvider = 'gitlens.disconnectRemoteProvider',
	ExternalDiff = 'gitlens.externalDiff',
	ExternalDiffAll = 'gitlens.externalDiffAll',
	FetchRepositories = 'gitlens.fetchRepositories',
	InviteToLiveShare = 'gitlens.inviteToLiveShare',
	OpenChangedFiles = 'gitlens.openChangedFiles',
	OpenBranchesInRemote = 'gitlens.openBranchesInRemote',
	OpenBranchInRemote = 'gitlens.openBranchInRemote',
	OpenCommitInRemote = 'gitlens.openCommitInRemote',
	OpenFileFromRemote = 'gitlens.openFileFromRemote',
	OpenFileInRemote = 'gitlens.openFileInRemote',
	OpenFileAtRevision = 'gitlens.openFileRevision',
	OpenFileAtRevisionFrom = 'gitlens.openFileRevisionFrom',
	OpenInRemote = 'gitlens.openInRemote',
	OpenPullRequestOnRemote = 'gitlens.openPullRequestOnRemote',
	OpenAssociatedPullRequestOnRemote = 'gitlens.openAssociatedPullRequestOnRemote',
	OpenRepoInRemote = 'gitlens.openRepoInRemote',
	OpenRevisionFile = 'gitlens.openRevisionFile',
	OpenRevisionFileInDiffLeft = 'gitlens.openRevisionFileInDiffLeft',
	OpenRevisionFileInDiffRight = 'gitlens.openRevisionFileInDiffRight',
	OpenWorkingFile = 'gitlens.openWorkingFile',
	OpenWorkingFileInDiffLeft = 'gitlens.openWorkingFileInDiffLeft',
	OpenWorkingFileInDiffRight = 'gitlens.openWorkingFileInDiffRight',
	PullRepositories = 'gitlens.pullRepositories',
	PushRepositories = 'gitlens.pushRepositories',
	GitCommands = 'gitlens.gitCommands',
	RefreshHover = 'gitlens.refreshHover',
	ResetSuppressedWarnings = 'gitlens.resetSuppressedWarnings',
	RevealCommitInView = 'gitlens.revealCommitInView',
	SearchCommits = 'gitlens.showCommitSearch',
	SearchCommitsInView = 'gitlens.views.searchAndCompare.searchCommits',
	SetViewsLayout = 'gitlens.setViewsLayout',
	ShowCommitInView = 'gitlens.showCommitInView',
	ShowCommitsInView = 'gitlens.showCommitsInView',
	ShowFileHistoryView = 'gitlens.showFileHistoryView',
	ShowFileHistoryInView = 'gitlens.showFileHistoryInView',
	ShowLineHistoryView = 'gitlens.showLineHistoryView',
	ShowLastQuickPick = 'gitlens.showLastQuickPick',
	ShowQuickBranchHistory = 'gitlens.showQuickBranchHistory',
	ShowQuickCommit = 'gitlens.showQuickCommitDetails',
	ShowQuickCommitFile = 'gitlens.showQuickCommitFileDetails',
	ShowQuickCurrentBranchHistory = 'gitlens.showQuickRepoHistory',
	ShowQuickFileHistory = 'gitlens.showQuickFileHistory',
	ShowQuickRepoStatus = 'gitlens.showQuickRepoStatus',
	ShowQuickCommitRevision = 'gitlens.showQuickRevisionDetails',
	ShowQuickCommitRevisionInDiffLeft = 'gitlens.showQuickRevisionDetailsInDiffLeft',
	ShowQuickCommitRevisionInDiffRight = 'gitlens.showQuickRevisionDetailsInDiffRight',
	ShowQuickStashList = 'gitlens.showQuickStashList',
	ShowRepositoriesView = 'gitlens.showRepositoriesView',
	ShowSearchAndCompareView = 'gitlens.showSearchAndCompareView',
	ShowHistoryPage = 'gitlens.showHistoryPage',
	ShowSettingsPage = 'gitlens.showSettingsPage',
	ShowSettingsPageAndJumpToBranchesView = 'gitlens.showSettingsPage#branches-view',
	ShowSettingsPageAndJumpToCommitsView = 'gitlens.showSettingsPage#commits-view',
	ShowSettingsPageAndJumpToContributorsView = 'gitlens.showSettingsPage#contributors-view',
	ShowSettingsPageAndJumpToFileHistoryView = 'gitlens.showSettingsPage#file-history-view',
	ShowSettingsPageAndJumpToLineHistoryView = 'gitlens.showSettingsPage#line-history-view',
	ShowSettingsPageAndJumpToRemotesView = 'gitlens.showSettingsPage#remotes-view',
	ShowSettingsPageAndJumpToRepositoriesView = 'gitlens.showSettingsPage#repositories-view',
	ShowSettingsPageAndJumpToSearchAndCompareView = 'gitlens.showSettingsPage#search-compare-view',
	ShowSettingsPageAndJumpToStashesView = 'gitlens.showSettingsPage#stashes-view',
	ShowSettingsPageAndJumpToTagsView = 'gitlens.showSettingsPage#tags-view',
	ShowWelcomePage = 'gitlens.showWelcomePage',
	StashApply = 'gitlens.stashApply',
	StashSave = 'gitlens.stashSave',
	StashSaveFiles = 'gitlens.stashSaveFiles',
	SupportGitLens = 'gitlens.supportGitLens',
	SwitchMode = 'gitlens.switchMode',
	ToggleCodeLens = 'gitlens.toggleCodeLens',
	ToggleFileBlame = 'gitlens.toggleFileBlame',
	ToggleFileBlameInDiffLeft = 'gitlens.toggleFileBlameInDiffLeft',
	ToggleFileBlameInDiffRight = 'gitlens.toggleFileBlameInDiffRight',
	ToggleFileChanges = 'gitlens.toggleFileChanges',
	ToggleFileHeatmap = 'gitlens.toggleFileHeatmap',
	ToggleFileHeatmapInDiffLeft = 'gitlens.toggleFileHeatmapInDiffLeft',
	ToggleFileHeatmapInDiffRight = 'gitlens.toggleFileHeatmapInDiffRight',
	ToggleLineBlame = 'gitlens.toggleLineBlame',
	ToggleReviewMode = 'gitlens.toggleReviewMode',
	ToggleZenMode = 'gitlens.toggleZenMode',
	ViewsOpenDirectoryDiff = 'gitlens.views.openDirectoryDiff',
	ViewsOpenDirectoryDiffWithWorking = 'gitlens.views.openDirectoryDiffWithWorking',
}

export function executeCommand<T>(command: Commands, args: T) {
	return commands.executeCommand(command, args);
}

export function executeEditorCommand<T>(command: Commands, uri: Uri | undefined, args: T) {
	return commands.executeCommand(command, uri, args);
}

interface CommandConstructor {
	new (): Command;
}

const registrableCommands: CommandConstructor[] = [];

export function command(): ClassDecorator {
	return (target: any) => {
		registrableCommands.push(target);
	};
}

export function registerCommands(context: ExtensionContext): void {
	for (const c of registrableCommands) {
		context.subscriptions.push(new c());
	}
}

export function getCommandUri(uri?: Uri, editor?: TextEditor): Uri | undefined {
	// Always use the editor.uri (if we have one), so we are correct for a split diff
	return editor?.document?.uri ?? uri;
}

export async function getRepoPathOrActiveOrPrompt(uri: Uri | undefined, editor: TextEditor | undefined, title: string) {
	const repoPath = await Container.git.getRepoPathOrActive(uri, editor);
	if (repoPath) return repoPath;

	const pick = await RepositoryPicker.show(title);
	if (pick instanceof CommandQuickPickItem) {
		await pick.execute();
		return undefined;
	}

	return pick?.repoPath;
}

export async function getRepoPathOrPrompt(title: string, uri?: Uri) {
	const repoPath = await Container.git.getRepoPath(uri);
	if (repoPath) return repoPath;

	const pick = await RepositoryPicker.show(title);
	if (pick instanceof CommandQuickPickItem) {
		void (await pick.execute());
		return undefined;
	}

	return pick?.repoPath;
}

export interface CommandContextParsingOptions {
	expectsEditor: boolean;
}

export interface CommandBaseContext {
	command: string;
	editor?: TextEditor;
	uri?: Uri;
}

export interface CommandScmGroupsContext extends CommandBaseContext {
	type: 'scm-groups';
	scmResourceGroups: SourceControlResourceGroup[];
}

export interface CommandScmStatesContext extends CommandBaseContext {
	type: 'scm-states';
	scmResourceStates: SourceControlResourceState[];
}

export interface CommandUnknownContext extends CommandBaseContext {
	type: 'unknown';
}

export interface CommandUriContext extends CommandBaseContext {
	type: 'uri';
}

export interface CommandUrisContext extends CommandBaseContext {
	type: 'uris';
	uris: Uri[];
}

// export interface CommandViewContext extends CommandBaseContext {
//     type: 'view';
// }

export interface CommandViewItemContext extends CommandBaseContext {
	type: 'viewItem';
	node: ViewNode;
}

export function isCommandViewContextWithBranch(
	context: CommandContext,
): context is CommandViewItemContext & { node: ViewNode & { branch: GitBranch } } {
	if (context.type !== 'viewItem') return false;

	return GitBranch.is((context.node as ViewNode & { branch: GitBranch }).branch);
}

export function isCommandViewContextWithCommit<T extends GitCommit>(
	context: CommandContext,
): context is CommandViewItemContext & { node: ViewNode & { commit: T } } {
	if (context.type !== 'viewItem') return false;

	return GitCommit.is((context.node as ViewNode & { commit: GitCommit }).commit);
}

export function isCommandViewContextWithContributor(
	context: CommandContext,
): context is CommandViewItemContext & { node: ViewNode & { contributor: GitContributor } } {
	if (context.type !== 'viewItem') return false;

	return GitContributor.is((context.node as ViewNode & { contributor: GitContributor }).contributor);
}

export function isCommandViewContextWithFile(
	context: CommandContext,
): context is CommandViewItemContext & { node: ViewNode & { file: GitFile; repoPath: string } } {
	if (context.type !== 'viewItem') return false;

	const node = context.node as ViewNode & { file: GitFile; repoPath: string };
	return node.file != null && (node.file.repoPath != null || node.repoPath != null);
}

export function isCommandViewContextWithFileCommit(
	context: CommandContext,
): context is CommandViewItemContext & { node: ViewNode & { commit: GitCommit; file: GitFile; repoPath: string } } {
	if (context.type !== 'viewItem') return false;

	const node = context.node as ViewNode & { commit: GitCommit; file: GitFile; repoPath: string };
	return node.file != null && GitCommit.is(node.commit) && (node.file.repoPath != null || node.repoPath != null);
}

export function isCommandViewContextWithFileRefs(
	context: CommandContext,
): context is CommandViewItemContext & {
	node: ViewNode & { file: GitFile; ref1: string; ref2: string; repoPath: string };
} {
	if (context.type !== 'viewItem') return false;

	const node = context.node as ViewNode & { file: GitFile; ref1: string; ref2: string; repoPath: string };
	return (
		node.file != null &&
		node.ref1 != null &&
		node.ref2 != null &&
		(node.file.repoPath != null || node.repoPath != null)
	);
}

export function isCommandViewContextWithRef(
	context: CommandContext,
): context is CommandViewItemContext & { node: ViewNode & { ref: string } } {
	return context.type === 'viewItem' && context.node instanceof ViewRefNode;
}

export function isCommandViewContextWithRemote(
	context: CommandContext,
): context is CommandViewItemContext & { node: ViewNode & { remote: GitRemote } } {
	if (context.type !== 'viewItem') return false;

	return GitRemote.is((context.node as ViewNode & { remote: GitRemote }).remote);
}

export function isCommandViewContextWithRepo(
	context: CommandContext,
): context is CommandViewItemContext & { node: ViewNode & { repo: Repository } } {
	if (context.type !== 'viewItem') return false;

	return (context.node as ViewNode & { repo?: Repository }).repo instanceof Repository;
}

export function isCommandViewContextWithRepoPath(
	context: CommandContext,
): context is CommandViewItemContext & { node: ViewNode & { repoPath: string } } {
	if (context.type !== 'viewItem') return false;

	return typeof (context.node as ViewNode & { repoPath?: string }).repoPath === 'string';
}

export type CommandContext =
	| CommandScmGroupsContext
	| CommandScmStatesContext
	| CommandUnknownContext
	| CommandUriContext
	| CommandUrisContext
	// | CommandViewContext
	| CommandViewItemContext;

function isScmResourceGroup(group: any): group is SourceControlResourceGroup {
	if (group == null) return false;

	return (
		(group as SourceControl).inputBox == null &&
		(group as SourceControlResourceGroup).id != null &&
		(group.handle != null ||
			(group as SourceControlResourceGroup).label != null ||
			(group as SourceControlResourceGroup).resourceStates != null)
	);
}

function isScmResourceState(state: any): state is SourceControlResourceState {
	if (state == null) return false;

	return (state as SourceControlResourceState).resourceUri != null;
}

export abstract class Command implements Disposable {
	static getMarkdownCommandArgsCore<T>(command: Commands, args: T): string {
		return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
	}

	protected readonly contextParsingOptions: CommandContextParsingOptions = { expectsEditor: false };

	private readonly _disposable: Disposable;

	constructor(command: Commands | Commands[]) {
		if (typeof command === 'string') {
			this._disposable = commands.registerCommand(
				command,
				(...args: any[]) => this._execute(command, ...args),
				this,
			);

			return;
		}

		const subscriptions = command.map(cmd =>
			commands.registerCommand(cmd, (...args: any[]) => this._execute(cmd, ...args), this),
		);
		this._disposable = Disposable.from(...subscriptions);
	}

	dispose() {
		this._disposable.dispose();
	}

	protected preExecute(context: CommandContext, ...args: any[]): Promise<any> {
		return this.execute(...args);
	}

	abstract execute(...args: any[]): any;

	protected _execute(command: string, ...args: any[]): any {
		const [context, rest] = Command.parseContext(command, { ...this.contextParsingOptions }, ...args);
		return this.preExecute(context, ...rest);
	}

	private static parseContext(
		command: string,
		options: CommandContextParsingOptions,
		...args: any[]
	): [CommandContext, any[]] {
		let editor: TextEditor | undefined = undefined;

		let firstArg = args[0];

		if (options.expectsEditor) {
			if (firstArg == null || (firstArg.id != null && firstArg.document?.uri != null)) {
				editor = firstArg;
				args = args.slice(1);
				firstArg = args[0];
			}

			if (args.length > 0 && (firstArg == null || firstArg instanceof Uri)) {
				const [uri, ...rest] = args as [Uri, any];
				if (uri != null) {
					// If the uri matches the active editor (or we are in a left-hand side of a diff), then pass the active editor
					if (
						editor == null &&
						(uri.toString() === window.activeTextEditor?.document.uri.toString() ||
							command.endsWith('InDiffLeft'))
					) {
						editor = window.activeTextEditor;
					}

					const uris = rest[0];
					if (uris != null && Array.isArray(uris) && uris.length !== 0 && uris[0] instanceof Uri) {
						return [
							{ command: command, type: 'uris', editor: editor, uri: uri, uris: uris },
							rest.slice(1),
						];
					}
					return [{ command: command, type: 'uri', editor: editor, uri: uri }, rest];
				}

				args = args.slice(1);
			} else if (editor == null) {
				// If we are expecting an editor and we have no uri, then pass the active editor
				editor = window.activeTextEditor;
			}
		}

		if (firstArg instanceof ViewNode) {
			const [node, ...rest] = args as [ViewNode, any];
			return [{ command: command, type: 'viewItem', node: node, uri: node.uri }, rest];
		}

		if (isScmResourceState(firstArg)) {
			const states = [];
			let count = 0;
			for (const arg of args) {
				if (!isScmResourceState(arg)) break;

				count++;
				states.push(arg);
			}

			return [
				{ command: command, type: 'scm-states', scmResourceStates: states, uri: states[0].resourceUri },
				args.slice(count),
			];
		}

		if (isScmResourceGroup(firstArg)) {
			const groups = [];
			let count = 0;
			for (const arg of args) {
				if (!isScmResourceGroup(arg)) break;

				count++;
				groups.push(arg);
			}

			return [{ command: command, type: 'scm-groups', scmResourceGroups: groups }, args.slice(count)];
		}

		return [{ command: command, type: 'unknown', editor: editor, uri: editor?.document.uri }, args];
	}
}

export abstract class ActiveEditorCommand extends Command {
	protected readonly contextParsingOptions: CommandContextParsingOptions = { expectsEditor: true };

	constructor(command: Commands | Commands[]) {
		super(command);
	}

	protected preExecute(context: CommandContext, ...args: any[]): Promise<any> {
		return this.execute(context.editor, context.uri, ...args);
	}

	protected _execute(command: string, ...args: any[]): any {
		return super._execute(command, undefined, ...args);
	}

	abstract execute(editor?: TextEditor, ...args: any[]): any;
}

let lastCommand: { command: string; args: any[] } | undefined = undefined;
export function getLastCommand() {
	return lastCommand;
}

export abstract class ActiveEditorCachedCommand extends ActiveEditorCommand {
	constructor(command: Commands | Commands[]) {
		super(command);
	}

	protected _execute(command: string, ...args: any[]): any {
		lastCommand = {
			command: command,
			args: args,
		};
		return super._execute(command, ...args);
	}

	abstract execute(editor: TextEditor, ...args: any[]): any;
}

export abstract class EditorCommand implements Disposable {
	private readonly _disposable: Disposable;

	constructor(command: Commands | Commands[]) {
		if (!Array.isArray(command)) {
			command = [command];
		}

		const subscriptions = [];
		for (const cmd of command) {
			subscriptions.push(
				commands.registerTextEditorCommand(
					cmd,
					(editor: TextEditor, edit: TextEditorEdit, ...args: any[]) =>
						this.executeCore(cmd, editor, edit, ...args),
					this,
				),
			);
		}
		this._disposable = Disposable.from(...subscriptions);
	}

	dispose() {
		this._disposable.dispose();
	}

	private executeCore(command: string, editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any {
		return this.execute(editor, edit, ...args);
	}

	abstract execute(editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any;
}

export function findEditor(uri: Uri): TextEditor | undefined {
	const active = window.activeTextEditor;
	const normalizedUri = uri.toString();

	for (const e of [...(active != null ? [active] : []), ...window.visibleTextEditors]) {
		// Don't include diff editors
		if (e.document.uri.toString() === normalizedUri && e?.viewColumn != null) {
			return e;
		}
	}

	return undefined;
}

export async function findOrOpenEditor(
	uri: Uri,
	options?: TextDocumentShowOptions & { throwOnError?: boolean },
): Promise<TextEditor | undefined> {
	const e = findEditor(uri);
	if (e != null) {
		if (!options?.preserveFocus) {
			await window.showTextDocument(e.document, { ...options, viewColumn: e.viewColumn });
		}

		return e;
	}

	return openEditor(uri, { viewColumn: window.activeTextEditor?.viewColumn, ...options });
}

export function findOrOpenEditors(uris: Uri[]): void {
	const normalizedUris = new Map(uris.map(uri => [uri.toString(), uri]));

	for (const e of window.visibleTextEditors) {
		// Don't include diff editors
		if (e?.viewColumn != null) {
			normalizedUris.delete(e.document.uri.toString());
		}
	}

	for (const uri of normalizedUris.values()) {
		void commands.executeCommand(BuiltInCommands.Open, uri, { background: true, preview: false });
	}
}

export async function openEditor(
	uri: Uri,
	options: TextDocumentShowOptions & { rethrow?: boolean } = {},
): Promise<TextEditor | undefined> {
	const { rethrow, ...opts } = options;
	try {
		if (GitUri.is(uri)) {
			uri = uri.documentUri();
		}

		if (uri.scheme === DocumentSchemes.GitLens && ImageMimetypes[paths.extname(uri.fsPath)]) {
			await commands.executeCommand(BuiltInCommands.Open, uri);

			return undefined;
		}

		const document = await workspace.openTextDocument(uri);
		return window.showTextDocument(document, {
			preserveFocus: false,
			preview: true,
			viewColumn: ViewColumn.Active,
			...opts,
		});
	} catch (ex) {
		const msg: string = ex?.toString() ?? '';
		if (msg.includes('File seems to be binary and cannot be opened as text')) {
			await commands.executeCommand(BuiltInCommands.Open, uri);

			return undefined;
		}

		if (rethrow) throw ex;

		Logger.error(ex, 'openEditor');
		return undefined;
	}
}

export function openWorkspace(uri: Uri, name: string, options: { openInNewWindow?: boolean } = {}) {
	if (options.openInNewWindow) {
		void commands.executeCommand(BuiltInCommands.OpenFolder, uri, true);

		return true;
	}

	return workspace.updateWorkspaceFolders(
		workspace.workspaceFolders != null ? workspace.workspaceFolders.length : 0,
		null,
		{ uri: uri, name: name },
	);
}

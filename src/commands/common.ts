'use strict';
import { commands, Disposable, SourceControlResourceGroup, SourceControlResourceState, TextDocumentShowOptions, TextEditor, TextEditorEdit, Uri, window, workspace } from 'vscode';
import { ExplorerNode } from '../views/explorerNodes';
import { GitBranch, GitCommit, GitRemote, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Telemetry } from '../telemetry';

export enum Commands {
    ClearFileAnnotations = 'gitlens.clearFileAnnotations',
    CloseUnchangedFiles = 'gitlens.closeUnchangedFiles',
    CopyMessageToClipboard = 'gitlens.copyMessageToClipboard',
    CopyShaToClipboard = 'gitlens.copyShaToClipboard',
    DiffDirectory = 'gitlens.diffDirectory',
    ExternalDiffAll = 'gitlens.externalDiffAll',
    DiffWith = 'gitlens.diffWith',
    DiffWithBranch = 'gitlens.diffWithBranch',
    DiffWithNext = 'gitlens.diffWithNext',
    DiffWithPrevious = 'gitlens.diffWithPrevious',
    DiffLineWithPrevious = 'gitlens.diffLineWithPrevious',
    DiffWithRevision = 'gitlens.diffWithRevision',
    DiffWithWorking = 'gitlens.diffWithWorking',
    DiffLineWithWorking = 'gitlens.diffLineWithWorking',
    ExternalDiff = 'gitlens.externalDiff',
    OpenChangedFiles = 'gitlens.openChangedFiles',
    OpenBranchesInRemote = 'gitlens.openBranchesInRemote',
    OpenBranchInRemote = 'gitlens.openBranchInRemote',
    OpenCommitInRemote = 'gitlens.openCommitInRemote',
    OpenFileInRemote = 'gitlens.openFileInRemote',
    OpenFileRevision = 'gitlens.openFileRevision',
    OpenInRemote = 'gitlens.openInRemote',
    OpenRepoInRemote = 'gitlens.openRepoInRemote',
    ResetSuppressedWarnings = 'gitlens.resetSuppressedWarnings',
    ShowCommitSearch = 'gitlens.showCommitSearch',
    ShowFileBlame = 'gitlens.showFileBlame',
    ShowLastQuickPick = 'gitlens.showLastQuickPick',
    ShowLineBlame = 'gitlens.showLineBlame',
    ShowQuickCommitDetails = 'gitlens.showQuickCommitDetails',
    ShowQuickCommitFileDetails = 'gitlens.showQuickCommitFileDetails',
    ShowQuickFileHistory = 'gitlens.showQuickFileHistory',
    ShowQuickBranchHistory = 'gitlens.showQuickBranchHistory',
    ShowQuickCurrentBranchHistory = 'gitlens.showQuickRepoHistory',
    ShowQuickRepoStatus = 'gitlens.showQuickRepoStatus',
    ShowQuickStashList = 'gitlens.showQuickStashList',
    StashApply = 'gitlens.stashApply',
    StashDelete = 'gitlens.stashDelete',
    StashSave = 'gitlens.stashSave',
    ToggleCodeLens = 'gitlens.toggleCodeLens',
    ToggleFileBlame = 'gitlens.toggleFileBlame',
    ToggleFileRecentChanges = 'gitlens.toggleFileRecentChanges',
    ToggleLineBlame = 'gitlens.toggleLineBlame'
}

export function getCommandUri(uri?: Uri, editor?: TextEditor): Uri | undefined {
    if (uri instanceof Uri) return uri;
    if (editor === undefined || editor.document === undefined) return undefined;
    return editor.document.uri;
}

export interface CommandContextParsingOptions {
    editor: boolean;
    uri: boolean;
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

export interface CommandViewContext extends CommandBaseContext {
    type: 'view';
    node: ExplorerNode;
}

export function isCommandViewContextWithBranch(context: CommandContext): context is CommandViewContext & { node: (ExplorerNode & { branch: GitBranch }) } {
    return context.type === 'view' && (context.node as any).branch && (context.node as any).branch instanceof GitBranch;
}

interface ICommandViewContextWithCommit<T extends GitCommit> extends CommandViewContext {
    node: (ExplorerNode & { commit: T });
}

export function isCommandViewContextWithCommit<T extends GitCommit>(context: CommandContext): context is ICommandViewContextWithCommit<T> {
    return context.type === 'view' && (context.node as any).commit && (context.node as any).commit instanceof GitCommit;
}

export function isCommandViewContextWithRemote(context: CommandContext): context is CommandViewContext & { node: (ExplorerNode & { remote: GitRemote }) } {
    return context.type === 'view' && (context.node as any).remote && (context.node as any).remote instanceof GitRemote;
}

export type CommandContext = CommandScmGroupsContext | CommandScmStatesContext | CommandUnknownContext | CommandUriContext | CommandViewContext;

function isScmResourceGroup(group: any): group is SourceControlResourceGroup {
    if (group === undefined) return false;

    return (group as SourceControlResourceGroup).id !== undefined && (group.handle !== undefined || (group as SourceControlResourceGroup).label !== undefined || (group as SourceControlResourceGroup).resourceStates !== undefined);
}

function isScmResourceState(state: any): state is SourceControlResourceState {
    if (state === undefined) return false;

    return (state as SourceControlResourceState).resourceUri !== undefined;
}

function isTextEditor(editor: any): editor is TextEditor {
    if (editor === undefined) return false;

    return editor.id !== undefined && ((editor as TextEditor).edit !== undefined || (editor as TextEditor).document !== undefined);
}

export abstract class Command extends Disposable {

    static getMarkdownCommandArgsCore<T>(command: Commands, args: T): string {
        return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
    }

    protected readonly contextParsingOptions: CommandContextParsingOptions = { editor: false, uri: false };

    private _disposable: Disposable;

    constructor(command: Commands | Commands[]) {
        super(() => this.dispose());

        if (!Array.isArray(command)) {
            command = [command];
        }

        const subscriptions = [];
        for (const cmd of command) {
            subscriptions.push(commands.registerCommand(cmd, (...args: any[]) => this._execute(cmd, ...args), this));
        }
        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    protected async preExecute(context: CommandContext, ...args: any[]): Promise<any> {
        return this.execute(...args);
    }

    abstract execute(...args: any[]): any;

    protected _execute(command: string, ...args: any[]): any {
        Telemetry.trackEvent(command);

        const [context, rest] = Command._parseContext(command, this.contextParsingOptions, ...args);
        return this.preExecute(context, ...rest);
    }

    private static _parseContext(command: string, options: CommandContextParsingOptions, ...args: any[]): [CommandContext, any[]] {
        let editor: TextEditor | undefined = undefined;

        let firstArg = args[0];
        if (options.editor && (firstArg === undefined || isTextEditor(firstArg))) {
            editor = firstArg;
            args = args.slice(1);
            firstArg = args[0];
        }

        if (options.uri && (firstArg === undefined || firstArg instanceof Uri)) {
            const [uri, ...rest] = args as [Uri, any];
            return [{ command: command, type: 'uri', editor: editor, uri: uri }, rest];
        }

        if (firstArg instanceof ExplorerNode) {
            const [node, ...rest] = args as [ExplorerNode, any];
            return [{ command: command, type: 'view', node: node, uri: node.uri }, rest];
        }

        if (isScmResourceState(firstArg)) {
            const states = [];
            let count = 0;
            for (const arg of args) {
                if (!isScmResourceState(arg)) break;

                count++;
                states.push(arg);
            }

            return [{ command: command, type: 'scm-states', scmResourceStates: states, uri: states[0].resourceUri }, args.slice(count)];
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

        return [{ command: command, type: 'unknown', editor: editor }, args];
    }
}

export abstract class ActiveEditorCommand extends Command {

    protected readonly contextParsingOptions: CommandContextParsingOptions = { editor: true, uri: true };

    constructor(command: Commands | Commands[]) {
        super(command);
    }

    protected async preExecute(context: CommandContext, ...args: any[]): Promise<any> {
        return this.execute(context.editor, context.uri, ...args);
    }

    protected _execute(command: string, ...args: any[]): any {
        return super._execute(command, window.activeTextEditor, ...args);
    }

    abstract execute(editor?: TextEditor, ...args: any[]): any;
}

let lastCommand: { command: string, args: any[] } | undefined = undefined;
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
            args: args
        };
        return super._execute(command, ...args);
    }

    abstract execute(editor: TextEditor, ...args: any[]): any;
}

export abstract class EditorCommand extends Disposable {

    private _disposable: Disposable;

    constructor(command: Commands | Commands[]) {
        super(() => this.dispose());

        if (!Array.isArray(command)) {
            command = [command];
        }

        const subscriptions = [];
        for (const cmd of command) {
            subscriptions.push(commands.registerCommand(cmd, (editor: TextEditor, edit: TextEditorEdit, ...args: any[]) => this._execute(cmd, editor, edit, ...args), this));
        }
        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    private _execute(command: string, editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any {
        Telemetry.trackEvent(command);
        return this.execute(editor, edit, ...args);
    }

    abstract execute(editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any;
}

export async function openEditor(uri: Uri, options?: TextDocumentShowOptions): Promise<TextEditor | undefined> {
    try {
        const defaults: TextDocumentShowOptions = {
            preserveFocus: false,
            preview: true,
            viewColumn: (window.activeTextEditor && window.activeTextEditor.viewColumn) || 1
        };

        if (uri instanceof GitUri) {
            uri = Uri.file(uri.fsPath);
        }

        const document = await workspace.openTextDocument(uri);
        return window.showTextDocument(document, { ...defaults, ...(options || {}) });
    }
    catch (ex) {
        Logger.error(ex, 'openEditor');
        return undefined;
    }
}
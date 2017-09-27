'use strict';
import { commands, Disposable, SourceControlResourceGroup, SourceControlResourceState, TextDocumentShowOptions, TextEditor, TextEditorEdit, Uri, window, workspace } from 'vscode';
import { ExplorerNode } from '../views/explorerNodes';
import { GitBranch, GitCommit, GitRemote } from '../gitService';
import { Logger } from '../logger';
import { Telemetry } from '../telemetry';

export type Commands =
    'gitlens.clearFileAnnotations' |
    'gitlens.closeUnchangedFiles' |
    'gitlens.copyMessageToClipboard' |
    'gitlens.copyShaToClipboard' |
    'gitlens.diffDirectory' |
    'gitlens.diffWith' |
    'gitlens.diffWithBranch' |
    'gitlens.diffWithNext' |
    'gitlens.diffWithPrevious' |
    'gitlens.diffLineWithPrevious' |
    'gitlens.diffWithRevision' |
    'gitlens.diffWithWorking' |
    'gitlens.diffLineWithWorking' |
    'gitlens.externalDiff' |
    'gitlens.openChangedFiles' |
    'gitlens.openBranchesInRemote' |
    'gitlens.openBranchInRemote' |
    'gitlens.openCommitInRemote' |
    'gitlens.openFileInRemote' |
    'gitlens.openInRemote' |
    'gitlens.openRepoInRemote' |
    'gitlens.resetSuppressedWarnings' |
    'gitlens.showBlameHistory' |
    'gitlens.showCommitSearch' |
    'gitlens.showFileBlame' |
    'gitlens.showFileHistory' |
    'gitlens.showLastQuickPick' |
    'gitlens.showLineBlame' |
    'gitlens.showQuickBranchHistory' |
    'gitlens.showQuickCommitDetails' |
    'gitlens.showQuickCommitFileDetails' |
    'gitlens.showQuickFileHistory' |
    'gitlens.showQuickRepoHistory' |
    'gitlens.showQuickRepoStatus' |
    'gitlens.showQuickStashList' |
    'gitlens.stashApply' |
    'gitlens.stashDelete' |
    'gitlens.stashSave' |
    'gitlens.toggleCodeLens' |
    'gitlens.toggleFileBlame' |
    'gitlens.toggleFileRecentChanges' |
    'gitlens.toggleLineBlame';
export const Commands = {
    ClearFileAnnotations: 'gitlens.clearFileAnnotations' as Commands,
    CloseUnchangedFiles: 'gitlens.closeUnchangedFiles' as Commands,
    CopyMessageToClipboard: 'gitlens.copyMessageToClipboard' as Commands,
    CopyShaToClipboard: 'gitlens.copyShaToClipboard' as Commands,
    DiffDirectory: 'gitlens.diffDirectory' as Commands,
    DiffWith: 'gitlens.diffWith' as Commands,
    DiffWithBranch: 'gitlens.diffWithBranch' as Commands,
    DiffWithNext: 'gitlens.diffWithNext' as Commands,
    DiffWithPrevious: 'gitlens.diffWithPrevious' as Commands,
    DiffLineWithPrevious: 'gitlens.diffLineWithPrevious' as Commands,
    DiffWithRevision: 'gitlens.diffWithRevision' as Commands,
    DiffWithWorking: 'gitlens.diffWithWorking' as Commands,
    DiffLineWithWorking: 'gitlens.diffLineWithWorking' as Commands,
    ExternalDiff: 'gitlens.externalDiff' as Commands,
    OpenChangedFiles: 'gitlens.openChangedFiles' as Commands,
    OpenBranchesInRemote: 'gitlens.openBranchesInRemote' as Commands,
    OpenBranchInRemote: 'gitlens.openBranchInRemote' as Commands,
    OpenCommitInRemote: 'gitlens.openCommitInRemote' as Commands,
    OpenFileInRemote: 'gitlens.openFileInRemote' as Commands,
    OpenInRemote: 'gitlens.openInRemote' as Commands,
    OpenRepoInRemote: 'gitlens.openRepoInRemote' as Commands,
    ResetSuppressedWarnings: 'gitlens.resetSuppressedWarnings' as Commands,
    ShowBlameHistory: 'gitlens.showBlameHistory' as Commands,
    ShowCommitSearch: 'gitlens.showCommitSearch' as Commands,
    ShowFileBlame: 'gitlens.showFileBlame' as Commands,
    ShowFileHistory: 'gitlens.showFileHistory' as Commands,
    ShowLastQuickPick: 'gitlens.showLastQuickPick' as Commands,
    ShowLineBlame: 'gitlens.showLineBlame' as Commands,
    ShowQuickCommitDetails: 'gitlens.showQuickCommitDetails' as Commands,
    ShowQuickCommitFileDetails: 'gitlens.showQuickCommitFileDetails' as Commands,
    ShowQuickFileHistory: 'gitlens.showQuickFileHistory' as Commands,
    ShowQuickBranchHistory: 'gitlens.showQuickBranchHistory' as Commands,
    ShowQuickCurrentBranchHistory: 'gitlens.showQuickRepoHistory' as Commands,
    ShowQuickRepoStatus: 'gitlens.showQuickRepoStatus' as Commands,
    ShowQuickStashList: 'gitlens.showQuickStashList' as Commands,
    StashApply: 'gitlens.stashApply' as Commands,
    StashDelete: 'gitlens.stashDelete' as Commands,
    StashSave: 'gitlens.stashSave' as Commands,
    ToggleCodeLens: 'gitlens.toggleCodeLens' as Commands,
    ToggleFileBlame: 'gitlens.toggleFileBlame' as Commands,
    ToggleFileRecentChanges: 'gitlens.toggleFileRecentChanges' as Commands,
    ToggleLineBlame: 'gitlens.toggleLineBlame' as Commands
};

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

    constructor(protected command: Commands) {
        super(() => this.dispose());

        this._disposable = commands.registerCommand(command, this._execute, this);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    protected async preExecute(context: CommandContext, ...args: any[]): Promise<any> {
        return this.execute(...args);
    }

    abstract execute(...args: any[]): any;

    protected _execute(...args: any[]): any {
        Telemetry.trackEvent(this.command);

        const [context, rest] = Command._parseContext(this.contextParsingOptions, ...args);
        return this.preExecute(context, ...rest);
    }

    private static _parseContext(options: CommandContextParsingOptions, ...args: any[]): [CommandContext, any[]] {
        let editor: TextEditor | undefined = undefined;

        let firstArg = args[0];
        if (options.editor && (firstArg === undefined || isTextEditor(firstArg))) {
            editor = firstArg;
            args = args.slice(1);
            firstArg = args[0];
        }

        if (options.uri && (firstArg === undefined || firstArg instanceof Uri)) {
            const [uri, ...rest] = args as [Uri, any];
            return [{ type: 'uri', editor: editor, uri: uri }, rest];
        }

        if (firstArg instanceof ExplorerNode) {
            const [node, ...rest] = args as [ExplorerNode, any];
            return [{ type: 'view', node: node, uri: node.uri }, rest];
        }

        if (isScmResourceState(firstArg)) {
            const states = [];
            let count = 0;
            for (const arg of args) {
                if (!isScmResourceState(arg)) break;

                count++;
                states.push(arg);
            }

            return [{ type: 'scm-states', scmResourceStates: states, uri: states[0].resourceUri }, args.slice(count)];
        }

        if (isScmResourceGroup(firstArg)) {
            const groups = [];
            let count = 0;
            for (const arg of args) {
                if (!isScmResourceGroup(arg)) break;

                count++;
                groups.push(arg);
            }

            return [{ type: 'scm-groups', scmResourceGroups: groups }, args.slice(count)];
        }

        return [{ type: 'unknown', editor: editor }, args];
    }
}

export abstract class ActiveEditorCommand extends Command {

    protected readonly contextParsingOptions: CommandContextParsingOptions = { editor: true, uri: true };

    constructor(public readonly command: Commands) {
        super(command);
    }

    protected async preExecute(context: CommandContext, ...args: any[]): Promise<any> {
        return this.execute(context.editor, context.uri, ...args);
    }

    protected _execute(...args: any[]): any {
        return super._execute(window.activeTextEditor, ...args);
    }

    abstract execute(editor?: TextEditor, ...args: any[]): any;
}

let lastCommand: { command: string, args: any[] } | undefined = undefined;
export function getLastCommand() {
    return lastCommand;
}

export abstract class ActiveEditorCachedCommand extends ActiveEditorCommand {

    constructor(public readonly command: Commands) {
        super(command);
    }

    protected _execute(...args: any[]): any {
        lastCommand = {
            command: this.command,
            args: args
        };
        return super._execute(...args);
    }

    abstract execute(editor: TextEditor, ...args: any[]): any;
}

export abstract class EditorCommand extends Disposable {

    private _disposable: Disposable;

    constructor(public readonly command: Commands) {
        super(() => this.dispose());
        this._disposable = commands.registerTextEditorCommand(command, this._execute, this);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    private _execute(editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any {
        Telemetry.trackEvent(this.command);
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

        const document = await workspace.openTextDocument(uri);
        return window.showTextDocument(document, { ...defaults, ...(options || {}) });
    }
    catch (ex) {
        Logger.error(ex, 'openEditor');
        return undefined;
    }
}
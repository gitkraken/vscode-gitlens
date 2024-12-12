import type {
	GitTimelineItem,
	SourceControl,
	SourceControlResourceGroup,
	SourceControlResourceState,
	TextEditor,
	TextEditorEdit,
	TimelineItem,
} from 'vscode';
import { commands, Disposable, Uri, window } from 'vscode';
import type { GlCommands } from '../constants.commands';
import type { StoredNamedRef } from '../constants.storage';
import type { GitBranch } from '../git/models/branch';
import { isBranch } from '../git/models/branch';
import type { GitCommit, GitStashCommit } from '../git/models/commit';
import { isCommit } from '../git/models/commit';
import type { GitContributor } from '../git/models/contributor';
import { isContributor } from '../git/models/contributor';
import type { GitFile } from '../git/models/file';
import type { GitReference } from '../git/models/reference';
import type { GitRemote } from '../git/models/remote';
import { isRemote } from '../git/models/remote';
import { Repository } from '../git/models/repository';
import type { GitTag } from '../git/models/tag';
import { isTag } from '../git/models/tag';
import { CloudWorkspace, LocalWorkspace } from '../plus/workspaces/models';
import { sequentialize } from '../system/function';
import { registerCommand } from '../system/vscode/command';
import { ViewNode } from '../views/nodes/abstract/viewNode';
import { ViewRefFileNode, ViewRefNode } from '../views/nodes/abstract/viewRefNode';

export function getCommandUri(uri?: Uri, editor?: TextEditor): Uri | undefined {
	// Always use the editor.uri (if we have one), so we are correct for a split diff
	return editor?.document?.uri ?? uri;
}

export interface CommandContextParsingOptions {
	expectsEditor: boolean;
}

export interface CommandBaseContext {
	command: string;
	editor?: TextEditor;
	uri?: Uri;
}

export interface CommandEditorLineContext extends CommandBaseContext {
	readonly type: 'editorLine';
	readonly line: number;
	readonly uri: Uri;
}

export interface CommandGitTimelineItemContext extends CommandBaseContext {
	readonly type: 'timeline-item:git';
	readonly item: GitTimelineItem;
	readonly uri: Uri;
}

export interface CommandScmContext extends CommandBaseContext {
	readonly type: 'scm';
	readonly scm: SourceControl;
}

export interface CommandScmGroupsContext extends CommandBaseContext {
	readonly type: 'scm-groups';
	readonly scmResourceGroups: SourceControlResourceGroup[];
}

export interface CommandScmStatesContext extends CommandBaseContext {
	readonly type: 'scm-states';
	readonly scmResourceStates: SourceControlResourceState[];
}

export interface CommandUnknownContext extends CommandBaseContext {
	readonly type: 'unknown';
}

export interface CommandUriContext extends CommandBaseContext {
	readonly type: 'uri';
}

export interface CommandUrisContext extends CommandBaseContext {
	readonly type: 'uris';
	readonly uris: Uri[];
}

// export interface CommandViewContext extends CommandBaseContext {
//     readonly type: 'view';
// }

export interface CommandViewNodeContext extends CommandBaseContext {
	readonly type: 'viewItem';
	readonly node: ViewNode;
}

export interface CommandViewNodesContext extends CommandBaseContext {
	readonly type: 'viewItems';
	readonly node: ViewNode;
	readonly nodes: ViewNode[];
}

export function isCommandContextEditorLine(context: CommandContext): context is CommandEditorLineContext {
	return context.type === 'editorLine';
}

export function isCommandContextGitTimelineItem(context: CommandContext): context is CommandGitTimelineItemContext {
	return context.type === 'timeline-item:git';
}

export function isCommandContextViewNodeHasBranch(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { branch: GitBranch } } {
	if (context.type !== 'viewItem') return false;

	return isBranch((context.node as ViewNode & { branch: GitBranch }).branch);
}

export function isCommandContextViewNodeHasCommit<T extends GitCommit | GitStashCommit>(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { commit: T } } {
	if (context.type !== 'viewItem') return false;

	return isCommit((context.node as ViewNode & { commit: GitCommit | GitStashCommit }).commit);
}

export function isCommandContextViewNodeHasContributor(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { contributor: GitContributor } } {
	if (context.type !== 'viewItem') return false;

	return isContributor((context.node as ViewNode & { contributor: GitContributor }).contributor);
}

export function isCommandContextViewNodeHasFile(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { file: GitFile; repoPath: string } } {
	if (context.type !== 'viewItem') return false;

	const node = context.node as ViewNode & { file: GitFile; repoPath: string };
	return node.file != null && (node.file.repoPath != null || node.repoPath != null);
}

export function isCommandContextViewNodeHasFileCommit(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { commit: GitCommit; file: GitFile; repoPath: string } } {
	if (context.type !== 'viewItem') return false;

	const node = context.node as ViewNode & { commit: GitCommit; file: GitFile; repoPath: string };
	return node.file != null && isCommit(node.commit) && (node.file.repoPath != null || node.repoPath != null);
}

export function isCommandContextViewNodeHasFileRefs(context: CommandContext): context is CommandViewNodeContext & {
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

export function isCommandContextViewNodeHasComparison(context: CommandContext): context is CommandViewNodeContext & {
	node: ViewNode & { compareRef: StoredNamedRef; compareWithRef: StoredNamedRef };
} {
	if (context.type !== 'viewItem') return false;

	return (
		typeof (context.node as ViewNode & { compareRef: StoredNamedRef; compareWithRef: StoredNamedRef }).compareRef
			?.ref === 'string' &&
		typeof (context.node as ViewNode & { compareRef: StoredNamedRef; compareWithRef: StoredNamedRef })
			.compareWithRef?.ref === 'string'
	);
}

export function isCommandContextViewNodeHasRef(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { ref: GitReference } } {
	return (
		context.type === 'viewItem' && (context.node instanceof ViewRefNode || context.node instanceof ViewRefFileNode)
	);
}

export function isCommandContextViewNodeHasRemote(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { remote: GitRemote } } {
	if (context.type !== 'viewItem') return false;

	return isRemote((context.node as ViewNode & { remote: GitRemote }).remote);
}

export function isCommandContextViewNodeHasRepository(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { repo: Repository } } {
	if (context.type !== 'viewItem') return false;

	return (context.node as ViewNode & { repo?: Repository }).repo instanceof Repository;
}

export function isCommandContextViewNodeHasRepoPath(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { repoPath: string } } {
	if (context.type !== 'viewItem') return false;

	return typeof (context.node as ViewNode & { repoPath?: string }).repoPath === 'string';
}

export function isCommandContextViewNodeHasTag(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { tag: GitTag } } {
	if (context.type !== 'viewItem') return false;

	return isTag((context.node as ViewNode & { tag: GitTag }).tag);
}

export function isCommandContextViewNodeHasWorkspace(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { workspace: CloudWorkspace | LocalWorkspace } } {
	if (context.type !== 'viewItem') return false;
	const workspace = (context.node as ViewNode & { workspace?: CloudWorkspace | LocalWorkspace }).workspace;
	return workspace instanceof CloudWorkspace || workspace instanceof LocalWorkspace;
}

export type CommandContext =
	| CommandEditorLineContext
	| CommandGitTimelineItemContext
	| CommandScmContext
	| CommandScmGroupsContext
	| CommandScmStatesContext
	| CommandUnknownContext
	| CommandUriContext
	| CommandUrisContext
	// | CommandViewContext
	| CommandViewNodeContext
	| CommandViewNodesContext;

export function isScm(scm: any): scm is SourceControl {
	if (scm == null) return false;

	return (
		(scm as SourceControl).id != null &&
		(scm as SourceControl).rootUri != null &&
		(scm as SourceControl).inputBox != null &&
		(scm as SourceControl).statusBarCommands != null
	);
}

function isScmResourceGroup(group: any): group is SourceControlResourceGroup {
	if (group == null) return false;

	return (
		(group as SourceControlResourceGroup).id != null &&
		(group as SourceControlResourceGroup).label != null &&
		(group as SourceControlResourceGroup).resourceStates != null &&
		Array.isArray((group as SourceControlResourceGroup).resourceStates)
	);
}

function isScmResourceState(resource: any): resource is SourceControlResourceState {
	if (resource == null) return false;

	return (resource as SourceControlResourceState).resourceUri != null;
}

function isTimelineItem(item: any): item is TimelineItem {
	if (item == null) return false;

	return (item as TimelineItem).timestamp != null && (item as TimelineItem).label != null;
}

function isGitTimelineItem(item: any): item is GitTimelineItem {
	if (item == null) return false;

	return (
		isTimelineItem(item) &&
		(item as GitTimelineItem).ref != null &&
		(item as GitTimelineItem).previousRef != null &&
		(item as GitTimelineItem).message != null
	);
}

export abstract class GlCommandBase implements Disposable {
	protected readonly contextParsingOptions: CommandContextParsingOptions = { expectsEditor: false };

	private readonly _disposable: Disposable;

	constructor(command: GlCommands | GlCommands[]) {
		if (typeof command === 'string') {
			this._disposable = registerCommand(command, (...args: any[]) => this._execute(command, ...args), this);

			return;
		}

		const subscriptions = command.map(cmd =>
			registerCommand(cmd, (...args: any[]) => this._execute(cmd, ...args), this),
		);
		this._disposable = Disposable.from(...subscriptions);
	}

	dispose() {
		this._disposable.dispose();
	}

	protected preExecute(_context: CommandContext, ...args: any[]): Promise<unknown> {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return this.execute(...args);
	}

	abstract execute(...args: any[]): any;

	protected _execute(command: string, ...args: any[]): Promise<unknown> {
		const [context, rest] = parseCommandContext(command, { ...this.contextParsingOptions }, ...args);

		// If there an array of contexts, then we want to execute the command for each
		if (Array.isArray(context)) {
			return sequentialize(
				this.preExecute,
				context.map<[CommandContext, ...any[]]>((c: CommandContext) => [c, ...rest]),
				this,
			);
		}

		return this.preExecute(context, ...rest);
	}
}

export function parseCommandContext(
	command: string,
	options?: CommandContextParsingOptions,
	...args: any[]
): [CommandContext | CommandContext[], any[]] {
	let editor: TextEditor | undefined = undefined;

	let firstArg = args[0];

	if (options?.expectsEditor) {
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
					return [{ command: command, type: 'uris', editor: editor, uri: uri, uris: uris }, rest.slice(1)];
				}
				return [{ command: command, type: 'uri', editor: editor, uri: uri }, rest];
			}

			args = args.slice(1);
		} else if (editor == null) {
			if (firstArg != null && typeof firstArg === 'object' && 'lineNumber' in firstArg && 'uri' in firstArg) {
				const [, ...rest] = args;
				return [
					{
						command: command,
						type: 'editorLine',
						editor: undefined,
						line: firstArg.lineNumber - 1, // convert to zero-based
						uri: firstArg.uri,
					},
					rest,
				];
			}

			// If we are expecting an editor and we have no uri, then pass the active editor
			editor = window.activeTextEditor;
		}
	}

	if (firstArg instanceof ViewNode) {
		let [node, ...rest] = args as [ViewNode, unknown];

		// If there is a node followed by an array of nodes, then we want to execute the command for each
		firstArg = rest[0];
		if (Array.isArray(firstArg) && firstArg[0] instanceof ViewNode) {
			let nodes;
			[nodes, ...rest] = rest as unknown as [ViewNode[], unknown];

			const contexts: CommandContext[] = [];
			for (const n of nodes) {
				if (n?.constructor === node.constructor) {
					contexts.push({ command: command, type: 'viewItem', node: n, uri: n.uri });
				}
			}

			return [contexts, rest];
		}

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

	if (isGitTimelineItem(firstArg)) {
		const [item, uri, ...rest] = args as [GitTimelineItem, Uri, any];
		return [{ command: command, type: 'timeline-item:git', item: item, uri: uri }, rest];
	}

	if (isScm(firstArg)) {
		const [scm, ...rest] = args as [SourceControl, any];
		return [{ command: command, type: 'scm', scm: scm }, rest];
	}

	return [{ command: command, type: 'unknown', editor: editor, uri: editor?.document.uri }, args];
}

export abstract class ActiveEditorCommand extends GlCommandBase {
	protected override readonly contextParsingOptions: CommandContextParsingOptions = { expectsEditor: true };

	protected override preExecute(context: CommandContext, ...args: any[]): Promise<any> {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return this.execute(context.editor, context.uri, ...args);
	}

	protected override _execute(command: string, ...args: any[]): any {
		return super._execute(command, undefined, ...args);
	}

	abstract override execute(editor?: TextEditor, ...args: any[]): any;
}

let lastCommand: { command: string; args: any[] } | undefined = undefined;
export function getLastCommand() {
	return lastCommand;
}

export abstract class ActiveEditorCachedCommand extends ActiveEditorCommand {
	protected override _execute(command: string, ...args: any[]): any {
		lastCommand = {
			command: command,
			args: args,
		};
		return super._execute(command, ...args);
	}

	abstract override execute(editor: TextEditor, ...args: any[]): any;
}

export abstract class EditorCommand implements Disposable {
	private readonly _disposable: Disposable;

	constructor(command: GlCommands | GlCommands[]) {
		if (!Array.isArray(command)) {
			command = [command];
		}

		const subscriptions = [];
		for (const cmd of command) {
			subscriptions.push(
				commands.registerTextEditorCommand(
					cmd,
					(editor: TextEditor, edit: TextEditorEdit, ...args: any[]) =>
						// eslint-disable-next-line @typescript-eslint/no-unsafe-return
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

	private executeCore(_command: string, editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any {
		return this.execute(editor, edit, ...args);
	}

	abstract execute(editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any;
}

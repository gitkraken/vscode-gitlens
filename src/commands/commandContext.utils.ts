import type { GitTimelineItem, SourceControl, TextEditor } from 'vscode';
import { Uri, window } from 'vscode';
import type { GlCommands, GlCommandsDeprecated } from '../constants.commands';
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
import { GitWorktree } from '../git/models/worktree';
import { CloudWorkspace } from '../plus/workspaces/models/cloudWorkspace';
import { LocalWorkspace } from '../plus/workspaces/models/localWorkspace';
import { isScm, isScmResourceGroup, isScmResourceState } from '../system/-webview/scm';
import { isGitTimelineItem } from '../system/-webview/timeline';
import { ViewNode } from '../views/nodes/abstract/viewNode';
import { ViewRefFileNode, ViewRefNode } from '../views/nodes/abstract/viewRefNode';
import type {
	CommandContext,
	CommandEditorLineContext,
	CommandGitTimelineItemContext,
	CommandViewNodeContext,
} from './commandContext';

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

export function isCommandContextViewNodeHasRefFile(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewRefFileNode } {
	return context.type === 'viewItem' && context.node instanceof ViewRefFileNode;
}

export function isCommandContextViewNodeHasRemote(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { remote: GitRemote } } {
	if (context.type !== 'viewItem') return false;

	return isRemote((context.node as ViewNode & { remote: GitRemote }).remote);
}

export function isCommandContextViewNodeHasWorktree(
	context: CommandContext,
): context is CommandViewNodeContext & { node: ViewNode & { worktree: GitWorktree } } {
	if (context.type !== 'viewItem') return false;

	return (context.node as ViewNode & { worktree?: GitWorktree }).worktree instanceof GitWorktree;
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

export interface CommandContextParsingOptions {
	expectsEditor: boolean;
}

export function parseCommandContext(
	command: GlCommands | GlCommandsDeprecated,
	options?: CommandContextParsingOptions,
	...args: any[]
): [CommandContext, any[]] {
	let editor: TextEditor | undefined = undefined;

	const originalArgs = [...args];
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
					return [
						{ command: command, type: 'uris', args: originalArgs, editor: editor, uri: uri, uris: uris },
						rest.slice(1),
					];
				}
				return [{ command: command, type: 'uri', args: originalArgs, editor: editor, uri: uri }, rest];
			}

			args = args.slice(1);
		} else if (editor == null) {
			if (firstArg != null && typeof firstArg === 'object' && 'lineNumber' in firstArg && 'uri' in firstArg) {
				const [, ...rest] = args;
				return [
					{
						command: command,
						type: 'editorLine',
						args: originalArgs,
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
		const [active, selection, ...rest] = args as [ViewNode, unknown];

		// If there is a node followed by an array of nodes, then check how we want to execute the command
		if (active instanceof ViewNode && Array.isArray(selection) && selection[0] instanceof ViewNode) {
			const nodes = selection.filter((n): n is ViewNode => n?.constructor === active.constructor);
			return [{ command: command, type: 'viewItems', args: originalArgs, node: active, nodes: nodes }, rest];
		}

		return [{ command: command, type: 'viewItem', args: originalArgs, node: active, uri: active.uri }, rest];
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
			{
				command: command,
				type: 'scm-states',
				args: originalArgs,
				scmResourceStates: states,
				uri: states[0].resourceUri,
			},
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

		return [
			{ command: command, type: 'scm-groups', args: originalArgs, scmResourceGroups: groups },
			args.slice(count),
		];
	}

	if (isGitTimelineItem(firstArg)) {
		const [item, uri, ...rest] = args as [GitTimelineItem, Uri, any];
		return [{ command: command, type: 'timeline-item:git', args: originalArgs, item: item, uri: uri }, rest];
	}

	if (isScm(firstArg)) {
		const [scm, ...rest] = args as [SourceControl, any];
		return [{ command: command, type: 'scm', args: originalArgs, scm: scm }, rest];
	}

	return [{ command: command, type: 'unknown', args: originalArgs, editor: editor, uri: editor?.document.uri }, args];
}

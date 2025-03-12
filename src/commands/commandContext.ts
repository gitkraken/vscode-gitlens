import type {
	GitTimelineItem,
	SourceControl,
	SourceControlResourceGroup,
	SourceControlResourceState,
	TextEditor,
	Uri,
} from 'vscode';
import type { GlCommands, GlCommandsDeprecated } from '../constants.commands';
import type { ViewNode } from '../views/nodes/abstract/viewNode';

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

export interface CommandContextBase {
	command: GlCommands | GlCommandsDeprecated;
	editor?: TextEditor;
	uri?: Uri;

	readonly args: unknown[];
}

export interface CommandEditorLineContext extends CommandContextBase {
	readonly type: 'editorLine';
	readonly line: number;
	readonly uri: Uri;
}

export interface CommandGitTimelineItemContext extends CommandContextBase {
	readonly type: 'timeline-item:git';
	readonly item: GitTimelineItem;
	readonly uri: Uri;
}

export interface CommandScmContext extends CommandContextBase {
	readonly type: 'scm';
	readonly scm: SourceControl;
}

export interface CommandScmGroupsContext extends CommandContextBase {
	readonly type: 'scm-groups';
	readonly scmResourceGroups: SourceControlResourceGroup[];
}

export interface CommandScmStatesContext extends CommandContextBase {
	readonly type: 'scm-states';
	readonly scmResourceStates: SourceControlResourceState[];
}

export interface CommandUnknownContext extends CommandContextBase {
	readonly type: 'unknown';
}

export interface CommandUriContext extends CommandContextBase {
	readonly type: 'uri';
}

export interface CommandUrisContext extends CommandContextBase {
	readonly type: 'uris';
	readonly uris: Uri[];
}

// export interface CommandViewContext extends CommandBaseContext {
//     readonly type: 'view';
// }

export interface CommandViewNodeContext extends CommandContextBase {
	readonly type: 'viewItem';
	readonly node: ViewNode;
}

export interface CommandViewNodesContext extends CommandContextBase {
	readonly type: 'viewItems';
	readonly node: ViewNode;
	readonly nodes: ViewNode[];
}

import type { TreeViewRefFileNodeTypes, TreeViewRefNodeTypes } from '../../../constants.views.js';
import type { GitUri } from '../../../git/gitUri.js';
import type { GitReference, GitRevisionReference } from '../../../git/models/reference.js';
import { getReferenceLabel } from '../../../git/utils/reference.utils.js';
import { loggable } from '../../../system/decorators/log.js';
import type { View } from '../../viewBase.js';
import { ViewFileNode } from './viewFileNode.js';
import { ViewNode } from './viewNode.js';

@loggable(i => getReferenceLabel(i.ref, false))
export abstract class ViewRefNode<
	Type extends TreeViewRefNodeTypes = TreeViewRefNodeTypes,
	TView extends View = View,
	TReference extends GitReference = GitReference,
	State extends object = any,
> extends ViewNode<Type, TView, State> {
	constructor(
		type: Type,
		uri: GitUri,
		view: TView,
		protected override readonly parent: ViewNode,
	) {
		super(type, uri, view, parent);
	}

	abstract get ref(): TReference;

	get repoPath(): string {
		return this.uri.repoPath!;
	}
}

@loggable(i => i.file.path)
export abstract class ViewRefFileNode<
	Type extends TreeViewRefFileNodeTypes = TreeViewRefFileNodeTypes,
	TView extends View = View,
	State extends object = any,
> extends ViewFileNode<Type, TView, State> {
	abstract get ref(): GitRevisionReference;
}

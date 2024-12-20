import type { TreeViewRefFileNodeTypes, TreeViewRefNodeTypes } from '../../../constants.views';
import type { GitUri } from '../../../git/gitUri';
import type { GitReference, GitRevisionReference } from '../../../git/models/reference';
import { getReferenceLabel } from '../../../git/models/reference.utils';
import type { View } from '../../viewBase';
import { ViewFileNode } from './viewFileNode';
import { ViewNode } from './viewNode';

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

	override toString(): string {
		return `${super.toString()}:${getReferenceLabel(this.ref, false)}`;
	}
}

export abstract class ViewRefFileNode<
	Type extends TreeViewRefFileNodeTypes = TreeViewRefFileNodeTypes,
	TView extends View = View,
	State extends object = any,
> extends ViewFileNode<Type, TView, State> {
	abstract get ref(): GitRevisionReference;

	override toString(): string {
		return `${super.toString()}:${this.file.path}`;
	}
}

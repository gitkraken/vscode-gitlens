import type { TreeViewFileNodeTypes } from '../../../constants.views';
import type { GitUri } from '../../../git/gitUri';
import type { GitFile } from '../../../git/models/file';
import type { View } from '../../viewBase';
import { ViewNode } from './viewNode';

export abstract class ViewFileNode<
	Type extends TreeViewFileNodeTypes = TreeViewFileNodeTypes,
	TView extends View = View,
	State extends object = any,
> extends ViewNode<Type, TView, State> {
	constructor(
		type: Type,
		uri: GitUri,
		view: TView,
		public override parent: ViewNode,
		public readonly file: GitFile,
	) {
		super(type, uri, view, parent);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	override toString(): string {
		return `${super.toString()}:${this.file.path}`;
	}
}

export function isViewFileNode(node: unknown): node is ViewFileNode {
	return node instanceof ViewFileNode;
}

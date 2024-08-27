import type { TreeViewNodeTypes } from '../../../constants.views';
import { debug } from '../../../system/decorators/log';
import type { View } from '../../viewBase';
import { disposeChildren } from '../../viewBase';
import { ViewNode } from './viewNode';

export abstract class CacheableChildrenViewNode<
	Type extends TreeViewNodeTypes = TreeViewNodeTypes,
	TView extends View = View,
	TChild extends ViewNode = ViewNode,
	State extends object = any,
> extends ViewNode<Type, TView, State> {
	private _children: TChild[] | undefined;
	protected get children(): TChild[] | undefined {
		return this._children;
	}
	protected set children(value: TChild[] | undefined) {
		if (this._children === value) return;

		disposeChildren(this._children, value);
		this._children = value;
	}

	override dispose() {
		super.dispose();
		this.children = undefined;
	}

	@debug()
	override refresh(reset: boolean = false) {
		if (reset) {
			this.children = undefined;
		}
	}
}

import type { TreeViewNodeTypes } from '../../../constants.views.js';
import { trace } from '../../../system/decorators/log.js';
import type { View } from '../../viewBase.js';
import { disposeChildren } from '../../viewBase.js';
import { ViewNode } from './viewNode.js';

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

	override dispose(): void {
		super.dispose();
		this.children = undefined;
	}

	@trace()
	override refresh(reset: boolean = false): void | { cancel: boolean } | Promise<void | { cancel: boolean }> {
		if (reset) {
			this.children = undefined;
		}
	}
}

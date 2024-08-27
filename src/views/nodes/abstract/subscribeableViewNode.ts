import type { TreeViewVisibilityChangeEvent } from 'vscode';
import { Disposable } from 'vscode';
import type { TreeViewSubscribableNodeTypes } from '../../../constants.views';
import type { GitUri } from '../../../git/gitUri';
import { gate } from '../../../system/decorators/gate';
import { debug } from '../../../system/decorators/log';
import { weakEvent } from '../../../system/event';
import type { View } from '../../viewBase';
import { CacheableChildrenViewNode } from './cacheableChildrenViewNode';
import type { ViewNode } from './viewNode';
import { canAutoRefreshView } from './viewNode';

export abstract class SubscribeableViewNode<
	Type extends TreeViewSubscribableNodeTypes = TreeViewSubscribableNodeTypes,
	TView extends View = View,
	TChild extends ViewNode = ViewNode,
	State extends object = any,
> extends CacheableChildrenViewNode<Type, TView, TChild, State> {
	protected disposable: Disposable;
	protected subscription: Promise<Disposable | undefined> | undefined;

	protected loaded: boolean = false;

	constructor(type: Type, uri: GitUri, view: TView, parent?: ViewNode) {
		super(type, uri, view, parent);

		const disposables = [
			weakEvent(this.view.onDidChangeVisibility, this.onVisibilityChanged, this),
			// weak(this.view.onDidChangeNodeCollapsibleState, this.onNodeCollapsibleStateChanged, this),
		];

		if (canAutoRefreshView(this.view)) {
			disposables.push(weakEvent(this.view.onDidChangeAutoRefresh, this.onAutoRefreshChanged, this));
		}

		const getTreeItem = this.getTreeItem;
		this.getTreeItem = function (this: SubscribeableViewNode<Type, TView>) {
			this.loaded = true;
			void this.ensureSubscription();
			return getTreeItem.apply(this);
		};

		const getChildren = this.getChildren;
		this.getChildren = function (this: SubscribeableViewNode<Type, TView>) {
			this.loaded = true;
			void this.ensureSubscription();
			return getChildren.apply(this);
		};

		this.disposable = Disposable.from(...disposables);
	}

	override dispose() {
		super.dispose();
		void this.unsubscribe();
		this.disposable?.dispose();
	}

	@debug()
	override async triggerChange(reset: boolean = false, force: boolean = false): Promise<void> {
		if (!this.loaded || this._disposed) return;

		if (reset && !this.view.visible) {
			this._pendingReset = reset;
		}
		await super.triggerChange(reset, force);
	}

	private _canSubscribe: boolean = true;
	protected get canSubscribe(): boolean {
		return this._canSubscribe && !this._disposed;
	}
	protected set canSubscribe(value: boolean) {
		if (this._canSubscribe === value) return;

		this._canSubscribe = value;

		void this.ensureSubscription();
		if (value) {
			void this.triggerChange();
		}
	}

	private _etag: number | undefined;
	protected abstract etag(): number;

	private _pendingReset: boolean = false;
	private get requiresResetOnVisible(): boolean {
		let reset = this._pendingReset;
		this._pendingReset = false;

		const etag = this.etag();
		if (etag !== this._etag) {
			this._etag = etag;
			reset = true;
		}

		return reset;
	}

	protected abstract subscribe(): Disposable | undefined | Promise<Disposable | undefined>;

	@debug()
	protected async unsubscribe(): Promise<void> {
		this._etag = this.etag();

		if (this.subscription != null) {
			const subscriptionPromise = this.subscription;
			this.subscription = undefined;

			(await subscriptionPromise)?.dispose();
		}
	}

	@debug()
	protected onAutoRefreshChanged() {
		this.onVisibilityChanged({ visible: this.view.visible });
	}

	// protected onParentCollapsibleStateChanged?(state: TreeItemCollapsibleState): void;
	// protected onCollapsibleStateChanged?(state: TreeItemCollapsibleState): void;
	// protected collapsibleState: TreeItemCollapsibleState | undefined;
	// protected onNodeCollapsibleStateChanged(e: TreeViewNodeCollapsibleStateChangeEvent<ViewNode>) {
	// 	if (e.element === this) {
	// 		this.collapsibleState = e.state;
	// 		if (this.onCollapsibleStateChanged !== undefined) {
	// 			this.onCollapsibleStateChanged(e.state);
	// 		}
	// 	} else if (e.element === this.parent) {
	// 		if (this.onParentCollapsibleStateChanged !== undefined) {
	// 			this.onParentCollapsibleStateChanged(e.state);
	// 		}
	// 	}
	// }
	@debug()
	protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
		void this.ensureSubscription();

		if (e.visible) {
			void this.triggerChange(this.requiresResetOnVisible);
		}
	}

	@gate()
	@debug()
	async ensureSubscription() {
		// We only need to subscribe if we are visible and if auto-refresh enabled (when supported)
		if (!this.canSubscribe || !this.view.visible || (canAutoRefreshView(this.view) && !this.view.autoRefresh)) {
			await this.unsubscribe();

			return;
		}

		// If we already have a subscription, just kick out
		if (this.subscription != null) return;

		this.subscription = Promise.resolve(this.subscribe());
		void (await this.subscription);
	}

	@gate()
	@debug()
	async resetSubscription() {
		await this.unsubscribe();
		await this.ensureSubscription();
	}
}

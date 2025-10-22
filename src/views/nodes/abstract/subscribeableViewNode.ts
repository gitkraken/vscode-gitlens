import type { TreeViewVisibilityChangeEvent } from 'vscode';
import { Disposable } from 'vscode';
import type { TreeViewSubscribableNodeTypes } from '../../../constants.views';
import type { GitUri } from '../../../git/gitUri';
import { gate } from '../../../system/decorators/gate';
import { debug } from '../../../system/decorators/log';
import { weakEvent } from '../../../system/event';
import { getLogScope, setLogScopeExit } from '../../../system/logger.scope';
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
		this.getTreeItem = async function (this: SubscribeableViewNode<Type, TView>) {
			this.loaded = true;
			await this.ensureSubscription();
			return getTreeItem.apply(this);
		};

		const getChildren = this.getChildren;
		this.getChildren = async function (this: SubscribeableViewNode<Type, TView>) {
			this.loaded = true;
			await this.ensureSubscription();
			return getChildren.apply(this);
		};

		this.disposable = Disposable.from(...disposables);
	}

	override dispose(): void {
		super.dispose();
		void this.unsubscribe();
		this.disposable?.dispose();
	}

	@debug()
	override async triggerChange(reset: boolean = false, force: boolean = false): Promise<void> {
		const scope = getLogScope();

		// If the node has been disposed, nothing to do
		if (this._disposed) {
			setLogScopeExit(scope, ' \u2022 ignored; disposed');
			return;
		}

		// If the node hasn't been loaded yet, don't trigger view refreshes now.
		// If this is a reset, record it so it will be applied when the node becomes loaded/visible.
		if (!this.loaded) {
			if (reset) {
				setLogScopeExit(scope, ' \u2022 ignored; pending reset');
				// If the view isn't visible, we'll persist the pending reset for application on visible.
				// If the view is visible but the node isn't loaded, it's still safer to record the reset
				// and let the normal load/visibility logic apply it rather than firing tree updates for
				// a node that doesn't exist yet in the tree.
				this._pendingReset = reset;
			} else {
				setLogScopeExit(scope, ' \u2022 ignored; not loaded');
			}
			return;
		}

		if (reset && !this.view.visible) {
			this._pendingReset = reset;
		}

		setLogScopeExit(scope, ' \u2022 refreshing view');
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
	protected onAutoRefreshChanged(): void {
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
	protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent): void {
		void this.ensureSubscription();

		if (e.visible) {
			void this.triggerChange(this.requiresResetOnVisible);
		}
	}

	@gate()
	@debug()
	async ensureSubscription(): Promise<void> {
		const scope = getLogScope();

		// We only need to subscribe if we are visible and if auto-refresh isn't disabled
		const {
			canSubscribe,
			view: { visible: isVisible },
		} = this;
		const autoRefreshDisabled = canAutoRefreshView(this.view) && !this.view.autoRefresh;

		if (!canSubscribe || !isVisible || autoRefreshDisabled) {
			setLogScopeExit(
				scope,
				` \u2022 unsubscribed (subscription=${this.subscription != null}); canSubscribe=${canSubscribe}, viewVisible=${isVisible}, autoRefreshDisabled=${autoRefreshDisabled}`,
			);
			await this.unsubscribe();

			return;
		}

		// If we already have a subscription, just kick out
		if (this.subscription != null) return;

		setLogScopeExit(
			scope,
			` \u2022 subscribed; canSubscribe=${canSubscribe}, viewVisible=${isVisible}, autoRefreshDisabled=${autoRefreshDisabled}`,
		);

		this.subscription = Promise.resolve(this.subscribe());
		void (await this.subscription);
	}

	@gate()
	@debug()
	async resetSubscription(): Promise<void> {
		await this.unsubscribe();
		await this.ensureSubscription();
	}
}

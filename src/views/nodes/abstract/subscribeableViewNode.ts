import type { TreeViewVisibilityChangeEvent } from 'vscode';
import { Disposable } from 'vscode';
import type { TreeViewSubscribableNodeTypes } from '../../../constants.views.js';
import type { GitUri } from '../../../git/gitUri.js';
import { gate } from '../../../system/decorators/gate.js';
import { trace } from '../../../system/decorators/log.js';
import { weakEvent } from '../../../system/event.js';
import { getScopedLogger } from '../../../system/logger.scope.js';
import type { View } from '../../viewBase.js';
import { CacheableChildrenViewNode } from './cacheableChildrenViewNode.js';
import type { ViewNode } from './viewNode.js';
import { canAutoRefreshView } from './viewNode.js';

export abstract class SubscribeableViewNode<
	Type extends TreeViewSubscribableNodeTypes = TreeViewSubscribableNodeTypes,
	TView extends View = View,
	TChild extends ViewNode = ViewNode,
	State extends object = any,
> extends CacheableChildrenViewNode<Type, TView, TChild, State> {
	protected disposable: Disposable;
	protected subscription: Promise<Disposable | undefined> | undefined;

	protected loaded: boolean = false;
	/** Tracks when the node was last loaded to avoid duplicate refreshes on visibility changes */
	private _loadedAt: number = 0;

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
			this._loadedAt = Date.now();
			await this.ensureSubscription(true);
			return getTreeItem.apply(this);
		};

		const getChildren = this.getChildren;
		this.getChildren = async function (this: SubscribeableViewNode<Type, TView>) {
			this.loaded = true;
			this._loadedAt = Date.now();
			await this.ensureSubscription(true);
			return getChildren.apply(this);
		};

		this.disposable = Disposable.from(...disposables);
	}

	override dispose(): void {
		super.dispose();
		void this.unsubscribe();
		this.disposable?.dispose();
	}

	@trace()
	override async triggerChange(reset: boolean = false, force: boolean = false): Promise<void> {
		const scope = getScopedLogger();

		// If the node has been disposed, nothing to do
		if (this._disposed) {
			scope?.addExitInfo('ignored; disposed');
			return;
		}

		// If the node hasn't been loaded yet, don't trigger view refreshes now.
		// If this is a reset, record it so it will be applied when the node becomes loaded/visible.
		if (!this.loaded) {
			if (reset) {
				scope?.addExitInfo('ignored; pending reset');
				// If the view isn't visible, we'll persist the pending reset for application on visible.
				// If the view is visible but the node isn't loaded, it's still safer to record the reset
				// and let the normal load/visibility logic apply it rather than firing tree updates for
				// a node that doesn't exist yet in the tree.
				this._pendingReset = reset;
			} else {
				scope?.addExitInfo('ignored; not loaded');
			}
			return;
		}

		if (reset && !this.view.visible) {
			this._pendingReset = reset;
		}

		scope?.addExitInfo('refreshing view');
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

	@trace()
	protected async unsubscribe(): Promise<void> {
		this._etag = this.etag();

		if (this.subscription != null) {
			const subscriptionPromise = this.subscription;
			this.subscription = undefined;

			(await subscriptionPromise)?.dispose();
		}
	}

	@trace()
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
	@trace()
	protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent): void {
		const scope = getScopedLogger();

		// Pass the event's visibility to ensureSubscription to avoid race conditions
		// between the debounced event and the current view.visible state
		void this.ensureSubscription(false, e.visible);

		if (e.visible) {
			// Skip refresh if the node was just loaded (within 500ms) to avoid double refresh.
			// The visibility event is debounced by 250ms, so if getChildren/getTreeItem was called
			// after the tree became visible, the refresh would be redundant.
			const timeSinceLoad = Date.now() - this._loadedAt;
			if (timeSinceLoad > 500) {
				scope?.addExitInfo(`triggering refresh; timeSinceLoad=${timeSinceLoad}ms`);
				void this.triggerChange(this.requiresResetOnVisible);
			} else {
				scope?.addExitInfo(`skipped refresh; timeSinceLoad=${timeSinceLoad}ms`);
			}
		}
	}

	@gate(undefined, { timeout: 30000, rejectOnTimeout: false }) // 30 second timeout to prevent indefinite hangs
	@trace({ onlyExit: true })
	async ensureSubscription(force?: boolean, visible?: boolean): Promise<void> {
		const scope = getScopedLogger();

		// We only need to subscribe if we are visible and if auto-refresh isn't disabled
		// If force is true (node is being accessed), subscribe regardless of visibility
		// If visible is passed explicitly (from visibility event), use it to avoid race conditions
		// with the debounced event vs current tree.visible state
		const { canSubscribe } = this;
		const isVisible = visible ?? this.view.visible;
		const autoRefreshDisabled = canAutoRefreshView(this.view) && !this.view.autoRefresh;

		if (!canSubscribe || (!force && !isVisible) || autoRefreshDisabled) {
			scope?.addExitInfo(
				`unsubscribed (subscription=${this.subscription != null}); canSubscribe=${canSubscribe}, viewVisible=${isVisible}, force=${force}, autoRefreshDisabled=${autoRefreshDisabled}`,
			);
			await this.unsubscribe();

			return;
		}

		// If we already have a subscription, just kick out
		if (this.subscription != null) {
			scope?.addExitInfo('already subscribed');
			return;
		}

		scope?.addExitInfo(
			`subscribed; canSubscribe=${canSubscribe}, viewVisible=${isVisible}, force=${force}, autoRefreshDisabled=${autoRefreshDisabled}`,
		);

		this.subscription = Promise.resolve(this.subscribe());
		void (await this.subscription);
	}

	@gate()
	@trace()
	async resetSubscription(): Promise<void> {
		await this.unsubscribe();
		await this.ensureSubscription();
	}
}

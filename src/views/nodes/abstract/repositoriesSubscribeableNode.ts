import { Disposable } from 'vscode';
import type { RepositoriesChangeEvent } from '../../../git/gitProviderService.js';
import { unknownGitUri } from '../../../git/gitUri.js';
import type { SubscriptionChangeEvent } from '../../../plus/gk/subscriptionService.js';
import { trace } from '../../../system/decorators/log.js';
import { weakEvent } from '../../../system/event.js';
import { szudzikPairing } from '../../../system/function.js';
import type { View } from '../../viewBase.js';
import { SubscribeableViewNode } from './subscribeableViewNode.js';
import type { ViewNode } from './viewNode.js';

export abstract class RepositoriesSubscribeableNode<
	TView extends View = View,
	TChild extends ViewNode = ViewNode,
> extends SubscribeableViewNode<'repositories', TView, TChild> {
	constructor(view: TView) {
		super('repositories', unknownGitUri, view);
	}

	override async getSplattedChild(): Promise<TChild | undefined> {
		if (this.children == null) {
			await this.getChildren();
		}

		return this.children?.length === 1 ? this.children[0] : undefined;
	}

	protected override etag(): number {
		return szudzikPairing(this.view.container.git.etag, this.view.container.subscription.etag);
	}

	@trace()
	protected subscribe(): Disposable | Promise<Disposable> {
		return Disposable.from(
			weakEvent(this.view.container.git.onDidChangeRepositories, this.onRepositoriesChanged, this),
			weakEvent(this.view.container.subscription.onDidChange, this.onSubscriptionChanged, this),
			weakEvent(this.view.onDidChangeRepositoryFilter, this.onViewRepositoryFilterChanged, this),
		);
	}

	private onRepositoriesChanged(_e: RepositoriesChangeEvent) {
		void this.triggerChange(true);
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.current.plan !== e.previous.plan) {
			void this.triggerChange(true);
		}
	}

	private onViewRepositoryFilterChanged() {
		void this.triggerChange(true);
	}
}

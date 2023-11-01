import { Disposable } from 'vscode';
import type { RepositoriesChangeEvent } from '../../../git/gitProviderService';
import { unknownGitUri } from '../../../git/gitUri';
import type { SubscriptionChangeEvent } from '../../../plus/gk/account/subscriptionService';
import { debug } from '../../../system/decorators/log';
import { weakEvent } from '../../../system/event';
import { szudzikPairing } from '../../../system/function';
import type { View } from '../../viewBase';
import { SubscribeableViewNode } from './subscribeableViewNode';
import type { ViewNode } from './viewNode';

export abstract class RepositoriesSubscribeableNode<
	TView extends View = View,
	TChild extends ViewNode = ViewNode,
> extends SubscribeableViewNode<'repositories', TView, TChild> {
	protected override splatted = true;

	constructor(view: TView) {
		super('repositories', unknownGitUri, view);
	}

	override async getSplattedChild() {
		if (this.children == null) {
			await this.getChildren();
		}

		return this.children?.length === 1 ? this.children[0] : undefined;
	}

	protected override etag(): number {
		return szudzikPairing(this.view.container.git.etag, this.view.container.subscription.etag);
	}

	@debug()
	protected subscribe(): Disposable | Promise<Disposable> {
		return Disposable.from(
			weakEvent(this.view.container.git.onDidChangeRepositories, this.onRepositoriesChanged, this),
			weakEvent(this.view.container.subscription.onDidChange, this.onSubscriptionChanged, this),
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
}

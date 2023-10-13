import type { Disposable } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../../container';
import type { GitRemote } from '../../git/models/remote';
import type { RichRemoteProvider } from '../../git/remotes/richRemoteProvider';
import { isSubscriptionPaidPlan } from '../../subscription';
import { log } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { ServerConnection } from '../gk/serverConnection';

export interface FocusItem {
	type: EnrichedItemResponse['entityType'];
	id: string;
	remote: GitRemote<RichRemoteProvider>;
	url: string;
}

export type EnrichedItem = {
	id: string;
	userId?: string;
	type: EnrichedItemResponse['type'];

	provider: EnrichedItemResponse['provider'];
	entityType: EnrichedItemResponse['entityType'];
	entityId: string;
	entityUrl: string;

	createdAt: number;
	updatedAt: number;
};

type EnrichedItemRequest = {
	provider: EnrichedItemResponse['provider'];
	entityType: EnrichedItemResponse['entityType'];
	entityId: string;
	entityUrl: string;
};

type EnrichedItemResponse = {
	id: string;
	userId?: string;
	type: 'pin' | 'snooze';

	provider: 'azure' | 'bitbucket' | 'github' | 'gitlab' | 'gitkraken';
	entityType: 'issue' | 'pr';
	entityId: string;
	entityUrl: string;

	createdAt: number;
	updatedAt: number;
};

export class FocusService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	private async delete(id: string, context: 'unpin' | 'unsnooze'): Promise<void> {
		const scope = getLogScope();

		try {
			const rsp = await this.connection.fetchGkDevApi(`v1/enrich-items/${id}`, { method: 'DELETE' });

			if (!rsp.ok) throw new Error(`Unable to ${context} item '${id}':  (${rsp.status}) ${rsp.statusText}`);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	async get(type?: EnrichedItemResponse['type']): Promise<EnrichedItem[]> {
		const scope = getLogScope();

		try {
			type Result = { data: EnrichedItemResponse[] };

			const rsp = await this.connection.fetchGkDevApi('v1/enrich-items', { method: 'GET' });

			const result = (await rsp.json()) as Result;
			return type == null ? result.data : result.data.filter(i => i.type === type);
		} catch (ex) {
			if (ex instanceof Error && ex.message === 'Authentication required') return [];

			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	getPins(): Promise<EnrichedItem[]> {
		return this.get('pin');
	}

	@log()
	getSnoozed(): Promise<EnrichedItem[]> {
		return this.get('snooze');
	}

	@log<FocusService['pinItem']>({ args: { 0: i => `${i.id} (${i.remote.provider.name} ${i.type})` } })
	async pinItem(item: FocusItem): Promise<EnrichedItem> {
		const scope = getLogScope();

		try {
			if (!(await ensureAccount('Pinning requires an account', this.container))) {
				throw new Error('Unable to pin item: account required');
			}

			type Result = { data: EnrichedItemResponse };

			const rq: EnrichedItemRequest = {
				provider: item.remote.provider.id as EnrichedItemResponse['provider'],
				entityType: item.type,
				entityId: item.id,
				entityUrl: item.url,
			};

			const rsp = await this.connection.fetchGkDevApi('v1/enrich-items/pin', {
				method: 'POST',
				body: JSON.stringify(rq),
			});

			if (!rsp.ok) {
				throw new Error(
					`Unable to pin item '${rq.provider}|${rq.entityUrl}#${item.id}':  (${rsp.status}) ${rsp.statusText}`,
				);
			}

			const result = (await rsp.json()) as Result;
			return result.data;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	unpinItem(id: string): Promise<void> {
		return this.delete(id, 'unpin');
	}

	@log<FocusService['snoozeItem']>({ args: { 0: i => `${i.id} (${i.remote.provider.name} ${i.type})` } })
	async snoozeItem(item: FocusItem): Promise<EnrichedItem> {
		const scope = getLogScope();

		try {
			if (!(await ensurePaidPlan('Snoozing requires a trial or paid plan', this.container))) {
				throw new Error('Unable to snooze item: subscription required');
			}

			type Result = { data: EnrichedItemResponse };

			const rq: EnrichedItemRequest = {
				provider: item.remote.provider.id as EnrichedItemResponse['provider'],
				entityType: item.type,
				entityId: item.id,
				entityUrl: item.url,
			};

			const rsp = await this.connection.fetchGkDevApi('v1/enrich-items/snooze', {
				method: 'POST',
				body: JSON.stringify(rq),
			});

			if (!rsp.ok) {
				throw new Error(
					`Unable to snooze item '${rq.provider}|${rq.entityUrl}#${item.id}':  (${rsp.status}) ${rsp.statusText}`,
				);
			}

			const result = (await rsp.json()) as Result;
			return result.data;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	unsnoozeItem(id: string): Promise<void> {
		return this.delete(id, 'unsnooze');
	}
}

async function ensurePaidPlan(title: string, container: Container): Promise<boolean> {
	while (true) {
		const subscription = await container.subscription.getSubscription();
		if (subscription.account?.verified === false) {
			const resend = { title: 'Resend Verification' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nYou must verify your email before you can continue.`,
				{ modal: true },
				resend,
				cancel,
			);

			if (result === resend) {
				if (await container.subscription.resendVerification()) {
					continue;
				}
			}

			return false;
		}

		const plan = subscription.plan.effective.id;
		if (isSubscriptionPaidPlan(plan)) break;

		if (subscription.account == null) {
			const signIn = { title: 'Start Free GitKraken Trial' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nTry our developer productivity and collaboration services free for 7 days.`,
				{ modal: true },
				signIn,
				cancel,
			);

			if (result === signIn) {
				if (await container.subscription.loginOrSignUp()) {
					continue;
				}
			}
		} else {
			const upgrade = { title: 'Upgrade to Pro' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nContinue to use our developer productivity and collaboration services.`,
				{ modal: true },
				upgrade,
				cancel,
			);

			if (result === upgrade) {
				void container.subscription.purchase();
			}
		}

		return false;
	}

	return true;
}

async function ensureAccount(title: string, container: Container): Promise<boolean> {
	while (true) {
		const subscription = await container.subscription.getSubscription();
		if (subscription.account?.verified === false) {
			const resend = { title: 'Resend Verification' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nYou must verify your email before you can continue.`,
				{ modal: true },
				resend,
				cancel,
			);

			if (result === resend) {
				if (await container.subscription.resendVerification()) {
					continue;
				}
			}

			return false;
		}

		if (subscription.account != null) break;

		const signIn = { title: 'Sign In / Sign Up' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			`${title}\n\nGain access to our developer productivity and collaboration services.`,
			{ modal: true },
			signIn,
			cancel,
		);

		if (result === signIn) {
			if (await container.subscription.loginOrSignUp()) {
				continue;
			}
		}

		return false;
	}

	return true;
}

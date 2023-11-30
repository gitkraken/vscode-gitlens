import { Disposable, window } from 'vscode';
import type { Container } from '../../../container';
import { gate } from '../../../system/decorators/gate';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import type { ServerConnection } from '../serverConnection';
import type { Organization } from './organization';
import type { SubscriptionChangeEvent } from './subscriptionService';

const organizationsCacheExpiration = 24 * 60 * 60 * 1000; // 1 day

export class OrganizationService implements Disposable {
	private _disposable: Disposable;
	private _organizations: Organization[] | null | undefined;

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {
		this._disposable = Disposable.from(container.subscription.onDidChange(this.onSubscriptionChanged, this));
	}

	dispose(): void {
		this._disposable.dispose();
	}

	@gate()
	async getOrganizations(options?: { force?: boolean }): Promise<Organization[] | null | undefined> {
		const scope = getLogScope();
		if (this._organizations === undefined || options?.force) {
			if (!options?.force) {
				const storedOrganizations = await this.getStoredOrganizations();
				if (storedOrganizations != null) {
					this._organizations = storedOrganizations;
					return this._organizations;
				}
			}

			// TODO: Use organizations-light instead once available.
			const rsp = await this.connection.fetchApi('user/organizations', {
				method: 'GET',
			});

			if (!rsp.ok) {
				debugger;
				Logger.error('', scope, `Unable to get organizations; status=(${rsp.status}): ${rsp.statusText}`);

				void window.showErrorMessage(`Unable to get organizations; Status: ${rsp.statusText}`, 'OK');

				this._organizations = null;
			}

			const organizationsResponse = await rsp.json();
			const organizations = organizationsResponse.map((o: any) => ({
				id: o.id,
				name: o.name,
				role: o.role,
			}));

			await this.storeOrganizations(organizations);
			this._organizations = organizations;
		}

		return this._organizations;
	}

	@gate()
	async getStoredOrganizations(): Promise<Organization[] | undefined> {
		const userId = (await this.container.subscription.getSubscription(true))?.account?.id;
		if (userId == null) return undefined;
		const storedOrganizations = this.container.storage.get('gk:organizations');
		if (storedOrganizations == null) return undefined;
		const { timestamp, organizations, userId: storedUserId } = storedOrganizations;
		if (storedUserId !== userId || timestamp + organizationsCacheExpiration < Date.now()) {
			await this.clearStoredOrganizations();
			return undefined;
		}

		return organizations;
	}

	private async clearStoredOrganizations(): Promise<void> {
		return this.container.storage.delete('gk:organizations');
	}

	private async storeOrganizations(organizations: Organization[]): Promise<void> {
		const userId = (await this.container.subscription.getSubscription(true))?.account?.id;
		if (userId == null) return;
		return this.container.storage.store('gk:organizations', {
			timestamp: Date.now(),
			organizations: organizations,
			userId: userId,
		});
	}

	private async onSubscriptionChanged(e: SubscriptionChangeEvent): Promise<void> {
		if (e.current?.account?.id !== e.previous?.account?.id) {
			this._organizations = undefined;
			await this.clearStoredOrganizations();
		}
	}
}

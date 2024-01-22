import { Disposable, window } from 'vscode';
import type { Container } from '../../../container';
import { setContext } from '../../../system/context';
import { gate } from '../../../system/decorators/gate';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import type { ServerConnection } from '../serverConnection';
import type {
	FullOrganization,
	Organization,
	OrganizationMember,
	OrganizationSettings,
	OrganizationsResponse,
} from './organization';
import type { SubscriptionChangeEvent } from './subscriptionService';

const organizationsCacheExpiration = 24 * 60 * 60 * 1000; // 1 day

export class OrganizationService implements Disposable {
	private _disposable: Disposable;
	private _organizations: Organization[] | null | undefined;
	private _fullOrganizations: Map<FullOrganization['id'], FullOrganization> | undefined;
	private _organizationSettings: Map<FullOrganization['id'], OrganizationSettings> | undefined;

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
	async getOrganizations(options?: {
		force?: boolean;
		accessToken?: string;
		userId?: string;
	}): Promise<Organization[] | null | undefined> {
		const scope = getLogScope();
		const userId = options?.userId ?? (await this.container.subscription.getSubscription(true))?.account?.id;
		if (userId == null) {
			this.updateOrganizations(undefined);
			return this._organizations;
		}

		if (this._organizations === undefined || options?.force) {
			if (!options?.force) {
				this.loadStoredOrganizations(userId);
				if (this._organizations != null) return this._organizations;
			}

			let rsp;
			try {
				rsp = await this.connection.fetchApi(
					'user/organizations-light',
					{
						method: 'GET',
					},
					{ token: options?.accessToken },
				);
			} catch (ex) {
				debugger;
				Logger.error(ex, scope);

				void window.showErrorMessage(`Unable to get organizations due to error: ${ex}`, 'OK');
				this.updateOrganizations(undefined);
				return this._organizations;
			}

			if (!rsp.ok) {
				debugger;
				Logger.error('', scope, `Unable to get organizations; status=(${rsp.status}): ${rsp.statusText}`);

				void window.showErrorMessage(`Unable to get organizations; Status: ${rsp.statusText}`, 'OK');

				// Setting to null prevents hitting the API again until you reload
				this.updateOrganizations(null);
				return this._organizations;
			}

			const organizationsResponse = (await rsp.json()) as OrganizationsResponse;
			const organizations = organizationsResponse.map((o: any) => ({
				id: o.id,
				name: o.name,
				role: o.role,
			}));

			await this.storeOrganizations(organizations, userId);
			this.updateOrganizations(organizations);
		}

		return this._organizations;
	}

	@gate()
	private loadStoredOrganizations(userId: string): void {
		const storedOrganizations = this.container.storage.get(`gk:${userId}:organizations`);
		if (storedOrganizations == null) return;
		const { timestamp, data: organizations } = storedOrganizations;
		if (timestamp == null || Date.now() - timestamp > organizationsCacheExpiration) {
			return;
		}

		this.updateOrganizations(organizations);
	}

	private async storeOrganizations(organizations: Organization[], userId: string): Promise<void> {
		return this.container.storage.store(`gk:${userId}:organizations`, {
			v: 1,
			timestamp: Date.now(),
			data: organizations,
		});
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent): void {
		if (e.current?.account?.id == null) {
			this.updateOrganizations(undefined);
		}
		void this.updateOrganizationPermissions(e.current?.activeOrganization?.id);
	}

	private updateOrganizations(organizations: Organization[] | null | undefined): void {
		this._organizations = organizations;
		void setContext('gitlens:gk:hasOrganizations', (organizations ?? []).length > 1);
	}

	private async updateOrganizationPermissions(orgId: string | undefined): Promise<void> {
		const settings = orgId != null ? await this.getOrganizationSettings(orgId) : undefined;
		if (settings == null) {
			void setContext('gitlens:gk:organization:ai:disabled', false);
			void setContext('gitlens:gk:organization:drafts:disabled', false);
			return;
		}

		void setContext('gitlens:gk:organization:ai:disabled', settings.aiSettings.enabled === false);
		void setContext('gitlens:gk:organization:drafts:disabled', settings.draftSettings.enabled === false);
	}

	@gate()
	private async getFullOrganization(
		id: string,
		options?: { force?: boolean },
	): Promise<FullOrganization | undefined> {
		if (!this._fullOrganizations?.has(id) || options?.force === true) {
			const session = await this.container.subscription.getAuthenticationSession();

			const rsp = await this.connection.fetchApi(
				`organization/${id}`,
				{
					method: 'GET',
				},
				{ token: session?.accessToken },
			);

			if (!rsp.ok) {
				Logger.error(
					'',
					getLogScope(),
					`Unable to get organization; status=(${rsp.status}): ${rsp.statusText}`,
				);
				return undefined;
			}

			const organization = (await rsp.json()) as FullOrganization;
			if (this._fullOrganizations == null) {
				this._fullOrganizations = new Map();
			}
			organization.members.sort((a, b) => (a.name ?? a.username).localeCompare(b.name ?? b.username));
			this._fullOrganizations.set(id, organization);
		}
		return this._fullOrganizations.get(id);
	}

	@gate()
	async getOrganizationMembers(id: string, options?: { force?: boolean }): Promise<OrganizationMember[]> {
		const organization = await this.getFullOrganization(id, options);
		if (organization != null) {
			return organization.members;
		}

		return [];
	}

	@gate()
	async getOrganizationSettings(
		orgId: string | undefined,
		options?: { force?: boolean },
	): Promise<OrganizationSettings | undefined> {
		// TODO: maybe getSubscription(false) when force is true
		const id = orgId ?? (await this.container.subscription.getSubscription(true)).activeOrganization?.id;
		if (id == null) return undefined;

		if (!this._organizationSettings?.has(id) || options?.force === true) {
			const session = await this.container.subscription.getAuthenticationSession();

			const rsp = await this.connection.fetchApi(
				`v1/organization/settings`,
				{
					method: 'GET',
				},
				{ token: session?.accessToken },
			);

			if (!rsp.ok) {
				Logger.error(
					'',
					getLogScope(),
					`Unable to get organization settings; status=(${rsp.status}): ${rsp.statusText}`,
				);
				return undefined;
			}

			const organizationSettings = (await rsp.json()) as OrganizationSettings;
			if (this._organizationSettings == null) {
				this._organizationSettings = new Map();
			}
			this._organizationSettings.set(id, organizationSettings);
		}
		return this._organizationSettings.get(id);
	}
}

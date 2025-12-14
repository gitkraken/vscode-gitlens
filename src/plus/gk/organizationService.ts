import { Disposable, window } from 'vscode';
import type { Container } from '../../container';
import { setContext } from '../../system/-webview/context';
import { gate } from '../../system/decorators/gate';
import { log } from '../../system/decorators/log';
import { once } from '../../system/function';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type {
	Organization,
	OrganizationMember,
	OrganizationSettings,
	OrganizationsResponse,
} from './models/organization';
import { fromGKDevAIProviders } from './models/organization';
import type { ServerConnection } from './serverConnection';
import type { SubscriptionChangeEvent } from './subscriptionService';

const organizationsCacheExpiration = 24 * 60 * 60 * 1000; // 1 day

export class OrganizationService implements Disposable {
	private _disposable: Disposable;
	private _organizations: Organization[] | null | undefined;
	private _organizationSettings:
		| Map<Organization['id'], { data: OrganizationSettings; lastValidatedDate: Date }>
		| undefined;
	private _organizationMembers: Map<Organization['id'], OrganizationMember[]> | undefined;

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {
		this._disposable = Disposable.from(
			once(container.onReady)(async () => {
				const orgId = await this.getActiveOrganizationId();
				void this.updateOrganizationPermissions(orgId);
			}),
			container.subscription.onDidCheckIn(this.onUserCheckedIn, this),
			container.subscription.onDidChange(this.onSubscriptionChanged, this),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	@gate()
	@log<OrganizationService['getOrganizations']>({ args: { 0: o => `force=${o?.force}, userId=${o?.userId}` } })
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
				rsp = await this.connection.fetchGkApi(
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
				Logger.error(
					undefined,
					scope,
					`Unable to get organizations; status=(${rsp.status}): ${rsp.statusText}`,
				);

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

	private async onUserCheckedIn(): Promise<void> {
		const orgId = await this.getActiveOrganizationId();
		if (orgId == null) return;

		await this.updateOrganizationPermissions(orgId, { force: true });
	}

	private async onSubscriptionChanged(e: SubscriptionChangeEvent): Promise<void> {
		if (e.current?.account?.id == null) {
			this.updateOrganizations(undefined);
			this._organizationSettings = undefined;
			await this.clearAllStoredOrganizationsSettings();
		}
		await this.updateOrganizationPermissions(e.current?.activeOrganization?.id);
	}

	private updateOrganizations(organizations: Organization[] | null | undefined): void {
		this._organizations = organizations;
		void setContext('gitlens:gk:hasOrganizations', (organizations ?? []).length > 1);
	}

	private async updateOrganizationPermissions(
		orgId: string | undefined,
		options?: { force?: boolean },
	): Promise<void> {
		const settings = orgId != null ? await this.getOrganizationSettings(orgId, options) : undefined;
		let aiProviders;
		try {
			aiProviders = fromGKDevAIProviders(settings?.aiProviders);
		} catch {
			aiProviders = {};
			if (settings) {
				settings.enforceAiProviders = false;
			}
		}

		const enforceAiProviders = settings?.enforceAiProviders ?? false;
		const disabledByEnforcing = enforceAiProviders && !Object.values(aiProviders).some(p => p.enabled);

		void setContext(
			'gitlens:gk:organization:ai:enabled',
			(!disabledByEnforcing && settings?.aiSettings.enabled) ?? settings?.aiEnabled ?? true,
		);
		void setContext('gitlens:gk:organization:ai:enforceProviders', enforceAiProviders);
		void setContext('gitlens:gk:organization:ai:providers', aiProviders);
		void setContext('gitlens:gk:organization:drafts:byob', settings?.draftsSettings.bucket != null);
		void setContext('gitlens:gk:organization:drafts:enabled', settings?.draftsSettings.enabled ?? true);
	}

	@gate()
	@log()
	async getMembers(id?: string | undefined, options?: { force?: boolean }): Promise<OrganizationMember[]> {
		if (id == null) {
			id = await this.getActiveOrganizationId();
			if (id == null) return [];
		}

		if (!this._organizationMembers?.has(id) || options?.force === true) {
			type MemberResponse = {
				members: OrganizationMember[];
			};
			const rsp = await this.connection.fetchGkApi(`organization/${id}/members`, { method: 'GET' });
			if (!rsp.ok) {
				Logger.error(
					'',
					getLogScope(),
					`Unable to get organization members; status=(${rsp.status}): ${rsp.statusText}`,
				);
				return [];
			}

			const members: OrganizationMember[] = ((await rsp.json()) as MemberResponse).members;
			sortOrgMembers(members);

			this._organizationMembers ??= new Map();
			this._organizationMembers.set(id, members);
		}

		return this._organizationMembers.get(id) ?? [];
	}

	@log()
	async getMemberById(id: string, organizationId: string): Promise<OrganizationMember | undefined> {
		return (await this.getMembers(organizationId)).find(m => m.id === id);
	}

	@log()
	async getMembersByIds(ids: string[], organizationId: string): Promise<OrganizationMember[]> {
		return (await this.getMembers(organizationId)).filter(m => ids.includes(m.id));
	}

	private async getActiveOrganizationId(cached = true): Promise<string | undefined> {
		const subscription = await this.container.subscription.getSubscription(cached);
		return subscription?.activeOrganization?.id;
	}

	@gate()
	@log()
	async getOrganizationSettings(
		orgId: string | undefined,
		options?: { force?: boolean },
	): Promise<OrganizationSettings | undefined> {
		type OrganizationSettingsResponse = {
			data: OrganizationSettings;
			error: string | undefined;
		};
		// TODO: maybe getActiveOrganizationId(false) when force is true
		const id = orgId ?? (await this.getActiveOrganizationId());
		if (id == null) return undefined;

		if (!options?.force && !this._organizationSettings?.has(id)) {
			const cachedOrg = this.getStoredOrganizationSettings(id);
			if (cachedOrg) {
				this._organizationSettings ??= new Map();
				this._organizationSettings.set(id, cachedOrg);
			}
		}

		if (this._organizationSettings?.has(id)) {
			const org = this._organizationSettings.get(id);
			if (org && Date.now() - org.lastValidatedDate.getTime() > organizationsCacheExpiration) {
				this._organizationSettings.delete(id);
			}
		}

		if (!this._organizationSettings?.has(id) || options?.force === true) {
			await this.deleteStoredOrganizationSettings(id);
			const rsp = await this.connection.fetchGkApi(
				`v1/organizations/settings`,
				{ method: 'GET' },
				{ organizationId: id },
			);
			if (!rsp.ok) {
				Logger.error(
					'',
					getLogScope(),
					`Unable to get organization settings; status=(${rsp.status}): ${rsp.statusText}`,
				);
				return undefined;
			}

			const organizationResponse = (await rsp.json()) as OrganizationSettingsResponse;
			if (organizationResponse.error != null) {
				Logger.error(
					'',
					getLogScope(),
					`Unable to get organization settings; status=(${rsp.status}): ${organizationResponse.error}`,
				);
				return undefined;
			}

			if (this._organizationSettings == null) {
				this._organizationSettings = new Map();
			}
			this._organizationSettings.set(id, { data: organizationResponse.data, lastValidatedDate: new Date() });
			await this.storeOrganizationSettings(id, organizationResponse.data, new Date());
		}
		return this._organizationSettings.get(id)?.data;
	}

	private async clearAllStoredOrganizationsSettings(): Promise<void> {
		return this.container.storage.deleteWithPrefix(`plus:organization`);
	}

	private async deleteStoredOrganizationSettings(id: string): Promise<void> {
		return this.container.storage.delete(`plus:organization:${id}:settings`);
	}

	private getStoredOrganizationSettings(
		id: string,
	): { data: OrganizationSettings; lastValidatedDate: Date } | undefined {
		const result = this.container.storage.get(`plus:organization:${id}:settings`);
		if (!result?.data) return undefined;

		const { lastValidatedAt, ...organizationSettings } = result.data;

		return {
			data: organizationSettings,
			lastValidatedDate: new Date(lastValidatedAt),
		};
	}

	private async storeOrganizationSettings(
		id: string,
		settings: OrganizationSettings,
		lastValidatedDate: Date,
	): Promise<void> {
		return this.container.storage.store(`plus:organization:${id}:settings`, {
			v: 1,
			data: { ...settings, lastValidatedAt: lastValidatedDate.getTime() },
		});
	}
}

function sortOrgMembers(members: OrganizationMember[]): OrganizationMember[] {
	return members.sort((a, b) => (a.name ?? a.username).localeCompare(b.name ?? b.username));
}

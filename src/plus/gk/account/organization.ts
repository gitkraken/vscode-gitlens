export interface Organization {
	readonly id: string;
	readonly name: string;
	readonly role: OrganizationRole;
}

export type OrganizationRole = 'owner' | 'admin' | 'billing' | 'user';

export type OrganizationsResponse = Organization[];

export interface FullOrganization {
	readonly id: string;
	readonly name: string;
	readonly domain: string;
	readonly updatedToNewRoles: boolean;
	readonly memberCount: number;
	readonly members: OrganizationMember[];
	readonly connections: OrganizationConnection[];
	readonly type: OrganizationType;
	readonly isOnChargebee: boolean;
}

export enum OrganizationType {
	Enterprise = 'ENTERPRISE',
	Individual = 'INDIVIDUAL',
	Pro = 'PRO',
	Teams = 'TEAMS',
}

export type OrganizationConnection = Record<string, unknown>;

export interface OrganizationMember {
	readonly id: string;
	readonly email: string;
	readonly name: string;
	readonly username: string;
	readonly role: OrganizationRole;
	readonly licenseConsumption: Record<string, boolean>;
}

export interface OrganizationSettings {
	aiSettings: OrganizationSetting;
	draftsSettings: OrganizationDraftsSettings;
}

export interface OrganizationSetting {
	readonly enabled: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface OrganizationDraftsSettings extends OrganizationSetting {
	readonly bucket:
		| {
				readonly name: string;
				readonly region: string;
				readonly provider: string;
		  }
		| undefined;
}

export interface Organization {
	readonly id: string;
	readonly name: string;
	readonly role: OrganizationRole;
}

export type OrganizationRole = 'owner' | 'admin' | 'billing' | 'user';

export type OrganizationsResponse = Organization[];

export type OrganizationMemberStatus = 'activated' | 'pending';

export interface OrganizationMember {
	readonly id: string;
	readonly email: string;
	readonly name: string;
	readonly username: string;
	readonly role: OrganizationRole;
	readonly status: OrganizationMemberStatus;
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

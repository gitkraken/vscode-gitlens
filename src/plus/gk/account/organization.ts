export interface Organization {
	readonly id: string;
	readonly name: string;
	readonly role: OrganizationRole;
}

export type OrganizationRole = 'owner' | 'admin' | 'billing' | 'user';

export type OrganizationsResponse = Organization[];

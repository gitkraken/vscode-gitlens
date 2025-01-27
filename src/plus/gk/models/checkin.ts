export type GKLicenses = Partial<Record<GKLicenseType, GKLicense>>;

export interface GKCheckInResponse {
	readonly user: GKUser;
	readonly licenses: {
		readonly paidLicenses: GKLicenses;
		readonly effectiveLicenses: GKLicenses;
	};
	readonly nextOptInDate?: string;
}

export interface GKUser {
	readonly id: string;
	readonly name: string;
	readonly email: string;
	readonly status: 'activated' | 'pending';
	readonly createdDate: string;
	readonly firstGitLensCheckIn?: string;
}

export interface GKLicense {
	readonly latestStatus: 'active' | 'canceled' | 'cancelled' | 'expired' | 'in_trial' | 'non_renewing' | 'trial';
	readonly latestStartDate: string;
	readonly latestEndDate: string;
	readonly organizationId: string | undefined;
	readonly reactivationCount?: number;
	readonly nextOptInDate?: string;
}

export type GKLicenseType =
	| 'gitlens-pro'
	| 'gitlens-teams'
	| 'gitlens-hosted-enterprise'
	| 'gitlens-self-hosted-enterprise'
	| 'gitlens-standalone-enterprise'
	| 'bundle-pro'
	| 'bundle-teams'
	| 'bundle-hosted-enterprise'
	| 'bundle-self-hosted-enterprise'
	| 'bundle-standalone-enterprise'
	| 'gitkraken_v1-pro'
	| 'gitkraken_v1-teams'
	| 'gitkraken_v1-hosted-enterprise'
	| 'gitkraken_v1-self-hosted-enterprise'
	| 'gitkraken_v1-standalone-enterprise'
	| 'gitkraken-v1-pro'
	| 'gitkraken-v1-teams'
	| 'gitkraken-v1-hosted-enterprise'
	| 'gitkraken-v1-self-hosted-enterprise'
	| 'gitkraken-v1-standalone-enterprise';

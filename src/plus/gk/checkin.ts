import type { Subscription } from './account/subscription';
import { getSubscriptionPlan, getSubscriptionPlanPriority, SubscriptionPlanId } from './account/subscription';

export interface GKCheckInResponse {
	readonly user: GKUser;
	readonly licenses: {
		readonly paidLicenses: Record<GKLicenseType, GKLicense>;
		readonly effectiveLicenses: Record<GKLicenseType, GKLicense>;
	};
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
	| 'gitkraken_v1-standalone-enterprise';

export function getSubscriptionFromCheckIn(data: GKCheckInResponse): Partial<Subscription> {
	const account: Subscription['account'] = {
		id: data.user.id,
		name: data.user.name,
		email: data.user.email,
		verified: data.user.status === 'activated',
		createdOn: data.user.createdDate,
	};

	const effectiveLicenses = Object.entries(data.licenses.effectiveLicenses) as [GKLicenseType, GKLicense][];
	const paidLicenses = Object.entries(data.licenses.paidLicenses) as [GKLicenseType, GKLicense][];

	let actual: Subscription['plan']['actual'] | undefined;
	if (paidLicenses.length > 0) {
		if (paidLicenses.length > 1) {
			paidLicenses.sort(
				(a, b) =>
					getSubscriptionPlanPriority(convertLicenseTypeToPlanId(b[0])) +
					licenseStatusPriority(b[1].latestStatus) -
					(getSubscriptionPlanPriority(convertLicenseTypeToPlanId(a[0])) +
						licenseStatusPriority(a[1].latestStatus)),
			);
		}

		const [licenseType, license] = paidLicenses[0];
		actual = getSubscriptionPlan(
			convertLicenseTypeToPlanId(licenseType),
			isBundleLicenseType(licenseType),
			license.reactivationCount ?? 0,
			license.organizationId,
			new Date(license.latestStartDate),
			new Date(license.latestEndDate),
			license.latestStatus === 'cancelled',
		);
	}

	if (actual == null) {
		actual = getSubscriptionPlan(
			SubscriptionPlanId.FreePlus,
			false,
			0,
			undefined,
			data.user.firstGitLensCheckIn != null
				? new Date(data.user.firstGitLensCheckIn)
				: data.user.createdDate != null
				  ? new Date(data.user.createdDate)
				  : undefined,
		);
	}

	let effective: Subscription['plan']['effective'] | undefined;
	if (effectiveLicenses.length > 0) {
		if (effectiveLicenses.length > 1) {
			effectiveLicenses.sort(
				(a, b) =>
					getSubscriptionPlanPriority(convertLicenseTypeToPlanId(b[0])) +
					licenseStatusPriority(b[1].latestStatus) -
					(getSubscriptionPlanPriority(convertLicenseTypeToPlanId(a[0])) +
						licenseStatusPriority(a[1].latestStatus)),
			);
		}

		const [licenseType, license] = effectiveLicenses[0];
		effective = getSubscriptionPlan(
			convertLicenseTypeToPlanId(licenseType),
			isBundleLicenseType(licenseType),
			license.reactivationCount ?? 0,
			license.organizationId,
			new Date(license.latestStartDate),
			new Date(license.latestEndDate),
			license.latestStatus === 'cancelled',
		);
	}

	if (effective == null || getSubscriptionPlanPriority(actual.id) >= getSubscriptionPlanPriority(effective.id)) {
		effective = { ...actual };
	}

	return {
		plan: {
			actual: actual,
			effective: effective,
		},
		account: account,
	};
}

function convertLicenseTypeToPlanId(licenseType: GKLicenseType): SubscriptionPlanId {
	switch (licenseType) {
		case 'gitlens-pro':
		case 'bundle-pro':
		case 'gitkraken_v1-pro':
			return SubscriptionPlanId.Pro;
		case 'gitlens-teams':
		case 'bundle-teams':
		case 'gitkraken_v1-teams':
			return SubscriptionPlanId.Teams;
		case 'gitlens-hosted-enterprise':
		case 'gitlens-self-hosted-enterprise':
		case 'gitlens-standalone-enterprise':
		case 'bundle-hosted-enterprise':
		case 'bundle-self-hosted-enterprise':
		case 'bundle-standalone-enterprise':
		case 'gitkraken_v1-hosted-enterprise':
		case 'gitkraken_v1-self-hosted-enterprise':
		case 'gitkraken_v1-standalone-enterprise':
			return SubscriptionPlanId.Enterprise;
		default:
			return SubscriptionPlanId.FreePlus;
	}
}

function isBundleLicenseType(licenseType: GKLicenseType): boolean {
	switch (licenseType) {
		case 'bundle-pro':
		case 'bundle-teams':
		case 'bundle-hosted-enterprise':
		case 'bundle-self-hosted-enterprise':
		case 'bundle-standalone-enterprise':
			return true;
		default:
			return false;
	}
}

function licenseStatusPriority(status: GKLicense['latestStatus']): number {
	switch (status) {
		case 'active':
			return 100;
		case 'expired':
		case 'cancelled':
			return -100;
		case 'in_trial':
		case 'trial':
			return 1;
		case 'canceled':
		case 'non_renewing':
			return 0;
		default:
			return -200;
	}
}

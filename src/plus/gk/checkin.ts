import { SubscriptionPlanId } from '../../constants.subscription';
import type { Organization } from './account/organization';
import type { Subscription } from './account/subscription';
import { getSubscriptionPlan, getSubscriptionPlanPriority } from './account/subscription';

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

export function getSubscriptionFromCheckIn(
	data: GKCheckInResponse,
	organizations: Organization[],
	organizationId?: string,
): Omit<Subscription, 'state' | 'lastValidatedAt'> {
	const account: Subscription['account'] = {
		id: data.user.id,
		name: data.user.name,
		email: data.user.email,
		verified: data.user.status === 'activated',
		createdOn: data.user.createdDate,
	};

	let effectiveLicenses = Object.entries(data.licenses.effectiveLicenses) as [GKLicenseType, GKLicense][];
	let paidLicenses = Object.entries(data.licenses.paidLicenses) as [GKLicenseType, GKLicense][];
	paidLicenses = paidLicenses.filter(
		license => license[1].latestStatus !== 'expired' && license[1].latestStatus !== 'cancelled',
	);
	if (paidLicenses.length > 1) {
		paidLicenses.sort(
			(a, b) =>
				getSubscriptionPlanPriority(convertLicenseTypeToPlanId(b[0])) +
				licenseStatusPriority(b[1].latestStatus) -
				(getSubscriptionPlanPriority(convertLicenseTypeToPlanId(a[0])) +
					licenseStatusPriority(a[1].latestStatus)),
		);
	}
	if (effectiveLicenses.length > 1) {
		effectiveLicenses.sort(
			(a, b) =>
				getSubscriptionPlanPriority(convertLicenseTypeToPlanId(b[0])) +
				licenseStatusPriority(b[1].latestStatus) -
				(getSubscriptionPlanPriority(convertLicenseTypeToPlanId(a[0])) +
					licenseStatusPriority(a[1].latestStatus)),
		);
	}

	const effectiveLicensesByOrganizationId = new Map<string, [GKLicenseType, GKLicense]>();
	const paidLicensesByOrganizationId = new Map<string, [GKLicenseType, GKLicense]>();
	for (const licenseData of effectiveLicenses) {
		const [, license] = licenseData;
		if (license.organizationId == null) continue;
		const existingLicense = effectiveLicensesByOrganizationId.get(license.organizationId);
		if (existingLicense == null) {
			effectiveLicensesByOrganizationId.set(license.organizationId, licenseData);
		}
	}

	for (const licenseData of paidLicenses) {
		const [, license] = licenseData;
		if (license.organizationId == null) continue;
		const existingLicense = paidLicensesByOrganizationId.get(license.organizationId);
		if (existingLicense == null) {
			paidLicensesByOrganizationId.set(license.organizationId, licenseData);
		}
	}

	const organizationsWithNoLicense = organizations.filter(
		organization =>
			!paidLicensesByOrganizationId.has(organization.id) &&
			!effectiveLicensesByOrganizationId.has(organization.id),
	);

	if (organizationId != null) {
		paidLicenses = paidLicenses.filter(
			([, license]) => license.organizationId === organizationId || license.organizationId == null,
		);
		effectiveLicenses = effectiveLicenses.filter(
			([, license]) => license.organizationId === organizationId || license.organizationId == null,
		);
	}

	let actual: Subscription['plan']['actual'] | undefined;
	const bestPaidLicense = paidLicenses.length > 0 ? paidLicenses[0] : undefined;
	const bestEffectiveLicense = effectiveLicenses.length > 0 ? effectiveLicenses[0] : undefined;
	const chosenPaidLicense =
		organizationId != null ? paidLicensesByOrganizationId.get(organizationId) ?? bestPaidLicense : bestPaidLicense;
	if (chosenPaidLicense != null) {
		const [licenseType, license] = chosenPaidLicense;
		actual = getSubscriptionPlan(
			convertLicenseTypeToPlanId(licenseType),
			isBundleLicenseType(licenseType),
			license.reactivationCount ?? 0,
			license.organizationId,
			new Date(license.latestStartDate),
			new Date(license.latestEndDate),
		);
	}

	if (actual == null) {
		actual = getSubscriptionPlan(
			SubscriptionPlanId.CommunityWithAccount,
			false,
			0,
			undefined,
			data.user.firstGitLensCheckIn != null
				? new Date(data.user.firstGitLensCheckIn)
				: data.user.createdDate != null
				  ? new Date(data.user.createdDate)
				  : undefined,
			undefined,
			undefined,
			data.nextOptInDate,
		);
	}

	let effective: Subscription['plan']['effective'] | undefined;
	const chosenEffectiveLicense =
		organizationId != null
			? effectiveLicensesByOrganizationId.get(organizationId) ?? bestEffectiveLicense
			: bestEffectiveLicense;
	if (chosenEffectiveLicense != null) {
		const [licenseType, license] = chosenEffectiveLicense;
		effective = getSubscriptionPlan(
			convertLicenseTypeToPlanId(licenseType),
			isBundleLicenseType(licenseType),
			license.reactivationCount ?? 0,
			license.organizationId,
			new Date(license.latestStartDate),
			new Date(license.latestEndDate),
			license.latestStatus === 'cancelled',
			license.nextOptInDate ?? data.nextOptInDate,
		);
	}

	if (effective == null || getSubscriptionPlanPriority(actual.id) >= getSubscriptionPlanPriority(effective.id)) {
		effective = { ...actual };
	}

	let activeOrganization: Organization | undefined;
	if (organizationId != null) {
		activeOrganization = organizations.find(organization => organization.id === organizationId);
	} else if (effective?.organizationId != null) {
		activeOrganization = organizations.find(organization => organization.id === effective.organizationId);
	} else if (organizationsWithNoLicense.length > 0) {
		activeOrganization = organizationsWithNoLicense[0];
	}

	return {
		plan: {
			actual: actual,
			effective: effective,
		},
		account: account,
		activeOrganization: activeOrganization,
	};
}

function convertLicenseTypeToPlanId(licenseType: GKLicenseType): SubscriptionPlanId {
	switch (licenseType) {
		case 'gitlens-pro':
		case 'bundle-pro':
		case 'gitkraken_v1-pro':
		case 'gitkraken-v1-pro':
			return SubscriptionPlanId.Pro;
		case 'gitlens-teams':
		case 'bundle-teams':
		case 'gitkraken_v1-teams':
		case 'gitkraken-v1-teams':
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
		case 'gitkraken-v1-hosted-enterprise':
		case 'gitkraken-v1-self-hosted-enterprise':
		case 'gitkraken-v1-standalone-enterprise':
			return SubscriptionPlanId.Enterprise;
		default:
			return SubscriptionPlanId.CommunityWithAccount;
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

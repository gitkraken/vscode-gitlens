import { window } from 'vscode';
import { Commands } from '../../../constants.commands';
import { SubscriptionPlanId, SubscriptionState } from '../../../constants.subscription';
import type { Container } from '../../../container';
import { registerCommand } from '../../../system/vscode/command';
import { configuration } from '../../../system/vscode/configuration';
import type { GKCheckInResponse, GKLicenses, GKLicenseType, GKUser } from '../checkin';
import { getSubscriptionFromCheckIn } from '../checkin';
import { getPreviewTrialAndDays } from '../utils';
import { getSubscriptionPlan } from './subscription';
import type { SubscriptionService } from './subscriptionService';

class AccountDebug {
	constructor(
		private readonly container: Container,
		private readonly subscriptionStub: {
			getSession: () => SubscriptionService['_session'];
			getSubscription: () => SubscriptionService['_subscription'];
			onDidCheckIn: SubscriptionService['_onDidCheckIn'];
			changeSubscription: SubscriptionService['changeSubscription'];
			getStoredSubscription: SubscriptionService['getStoredSubscription'];
		},
	) {
		this.container.context.subscriptions.push(
			registerCommand(Commands.PlusSimulateSubscriptionState, () => this.simulateSubscriptionState()),
			registerCommand(Commands.PlusRestoreSubscriptionState, () => this.restoreSubscriptionState()),
		);
	}

	private async simulateSubscriptionState() {
		if (
			!this.container.debugging ||
			this.subscriptionStub.getSession() == null ||
			this.subscriptionStub.getSubscription() == null
		) {
			return;
		}

		// Show a quickpick to select a subscription state to simulate
		const picks: { label: string; state: SubscriptionState; reactivatedTrial?: boolean; expiredPaid?: boolean }[] =
			[
				{ label: 'Free', state: SubscriptionState.Free },
				{ label: 'Free In Preview Trial', state: SubscriptionState.FreeInPreviewTrial },
				{ label: 'Free Preview Trial Expired', state: SubscriptionState.FreePreviewTrialExpired },
				{ label: 'Free+ In Trial', state: SubscriptionState.FreePlusInTrial },
				{
					label: 'Free+ In Trial (Reactivated)',
					state: SubscriptionState.FreePlusInTrial,
					reactivatedTrial: true,
				},
				{ label: 'Free+ Trial Expired', state: SubscriptionState.FreePlusTrialExpired },
				{
					label: 'Free+ Trial Reactivation Eligible',
					state: SubscriptionState.FreePlusTrialReactivationEligible,
				},
				{ label: 'Paid', state: SubscriptionState.Paid },
				// TODO: Update this subscription state once we have a "paid expired" state availale
				{ label: 'Paid Expired', state: SubscriptionState.Paid, expiredPaid: true },
				{ label: 'Verification Required', state: SubscriptionState.VerificationRequired },
			];

		const pick = await window.showQuickPick(picks, {
			title: 'Simulate Subscription State',
			placeHolder: 'Select the subscription state to simulate',
		});
		if (pick == null) return;
		const { state: subscriptionState, reactivatedTrial, expiredPaid } = pick;

		const organizations = (await this.container.organizations.getOrganizations()) ?? [];
		let activeOrganizationId = configuration.get('gitKraken.activeOrganizationId') ?? undefined;
		if (activeOrganizationId === '' || (activeOrganizationId == null && organizations.length === 1)) {
			activeOrganizationId = organizations[0].id;
		}

		const simulatedCheckInData: GKCheckInResponse = getSimulatedCheckInResponse(
			{
				id: this.subscriptionStub.getSubscription()?.account?.id ?? '',
				name: '',
				email: '',
				status: subscriptionState === SubscriptionState.VerificationRequired ? 'pending' : 'activated',
				createdDate: new Date().toISOString(),
			},
			subscriptionState,
			'gitkraken_v1-pro',
			{
				organizationId: activeOrganizationId,
				trial: { reactivatedTrial: reactivatedTrial },
				expiredPaid: expiredPaid,
			},
		);
		this.subscriptionStub.onDidCheckIn.fire();
		let simulatedSubscription = getSubscriptionFromCheckIn(
			simulatedCheckInData,
			organizations,
			activeOrganizationId,
		);

		if (
			subscriptionState === SubscriptionState.FreeInPreviewTrial ||
			subscriptionState === SubscriptionState.FreePreviewTrialExpired
		) {
			simulatedSubscription = {
				...simulatedSubscription,
				plan: {
					...simulatedSubscription.plan,
					actual: getSubscriptionPlan(
						SubscriptionPlanId.Free,
						false,
						0,
						undefined,
						new Date(simulatedSubscription.plan.actual.startedOn),
					),
					effective: getSubscriptionPlan(
						SubscriptionPlanId.Free,
						false,
						0,
						undefined,
						new Date(simulatedSubscription.plan.effective.startedOn),
					),
				},
			};
			const { previewTrial: simulatedPreviewTrial } = getPreviewTrialAndDays();
			if (subscriptionState === SubscriptionState.FreePreviewTrialExpired) {
				simulatedPreviewTrial.startedOn = new Date(Date.now() - 2000).toISOString();
				simulatedPreviewTrial.expiresOn = new Date(Date.now() - 1000).toISOString();
			}

			simulatedSubscription.previewTrial = simulatedPreviewTrial;
		}

		this.subscriptionStub.changeSubscription(
			{
				...this.subscriptionStub.getSubscription(),
				...simulatedSubscription,
			},
			{ store: false },
		);
	}

	private restoreSubscriptionState() {
		if (!this.container.debugging || this.subscriptionStub.getSession() == null) return;
		this.subscriptionStub.changeSubscription(this.subscriptionStub.getStoredSubscription(), { store: false });
	}
}

function getSimulatedPaidLicenseResponse(
	organizationId?: string | undefined,
	type: GKLicenseType = 'gitkraken_v1-pro',
	status: 'active' | 'cancelled' | 'non-renewing' = 'active',
): GKLicenses {
	const oneYear = 365 * 24 * 60 * 60 * 1000;
	const tenSeconds = 10 * 1000;
	// start 10 seconds ago
	let start = new Date(Date.now() - tenSeconds);
	// end in 1 year
	let end = new Date(start.getTime() + oneYear);
	if (status === 'cancelled') {
		// set start and end back 1 year
		start = new Date(start.getTime() - oneYear);
		end = new Date(end.getTime() - oneYear);
	}

	return {
		[type satisfies GKLicenseType]: {
			latestStatus: status,
			latestStartDate: start.toISOString(),
			latestEndDate: end.toISOString(),
			organizationId: organizationId,
			reactivationCount: undefined,
			nextOptInDate: undefined,
		},
	};
}

function getSimulatedTrialLicenseResponse(
	organizationId?: string,
	type: GKLicenseType = 'gitkraken_v1-pro',
	status: 'active-new' | 'active-reactivated' | 'expired' | 'expired-reactivatable' = 'active-new',
	durationDays: number = 7,
): GKLicenses {
	const tenSeconds = 10 * 1000;
	const oneDay = 24 * 60 * 60 * 1000;
	const duration = durationDays * oneDay;
	const tenSecondsAgo = new Date(Date.now() - tenSeconds);
	// start 10 seconds ago
	let start = tenSecondsAgo;
	// end using durationDays
	let end = new Date(start.getTime() + duration);
	if (status === 'expired' || status === 'expired-reactivatable') {
		// set start and end back durationDays
		start = new Date(start.getTime() - duration);
		end = new Date(end.getTime() - duration);
	}

	return {
		[type satisfies GKLicenseType]: {
			latestStatus: status,
			latestStartDate: start.toISOString(),
			latestEndDate: end.toISOString(),
			organizationId: organizationId,
			reactivationCount: status === 'active-reactivated' ? 1 : 0,
			nextOptInDate: status === 'expired-reactivatable' ? tenSecondsAgo.toISOString() : undefined,
		},
	};
}

function getSimulatedCheckInResponse(
	user: GKUser,
	targetSubscriptionState: SubscriptionState,
	targetSubscriptionType: GKLicenseType = 'gitkraken_v1-pro',
	// TODO: Remove 'expiredPaid' option and replace logic with targetSubscriptionState once we support a Paid Expired state
	options?: {
		organizationId?: string;
		trial?: { reactivatedTrial?: boolean; durationDays?: number };
		expiredPaid?: boolean;
	},
): GKCheckInResponse {
	const tenSecondsAgo = new Date(Date.now() - 10 * 1000);
	const paidLicenseData =
		targetSubscriptionState === SubscriptionState.Paid
			? // TODO: Update this line once we support a Paid Expired state
			  getSimulatedPaidLicenseResponse(
					options?.organizationId,
					targetSubscriptionType,
					options?.expiredPaid ? 'cancelled' : 'active',
			  )
			: {};
	let trialLicenseStatus: 'active-new' | 'active-reactivated' | 'expired' | 'expired-reactivatable' = 'active-new';
	switch (targetSubscriptionState) {
		case SubscriptionState.FreePlusTrialExpired:
			trialLicenseStatus = 'expired';
			break;
		case SubscriptionState.FreePlusTrialReactivationEligible:
			trialLicenseStatus = 'expired-reactivatable';
			break;
		case SubscriptionState.FreePlusInTrial:
			trialLicenseStatus = options?.trial?.reactivatedTrial ? 'active-reactivated' : 'active-new';
			break;
	}
	const trialLicenseData =
		targetSubscriptionState === SubscriptionState.FreePlusInTrial ||
		targetSubscriptionState === SubscriptionState.FreePlusTrialExpired ||
		targetSubscriptionState === SubscriptionState.FreePlusTrialReactivationEligible
			? getSimulatedTrialLicenseResponse(
					options?.organizationId,
					targetSubscriptionType,
					trialLicenseStatus,
					options?.trial?.durationDays,
			  )
			: {};
	return {
		user: user,
		licenses: {
			paidLicenses: paidLicenseData,
			effectiveLicenses: trialLicenseData,
		},
		nextOptInDate:
			targetSubscriptionState === SubscriptionState.FreePlusTrialReactivationEligible
				? tenSecondsAgo.toISOString()
				: undefined,
	};
}

export function registerAccountDebug(
	container: Container,
	subscriptionStub: {
		getSession: () => SubscriptionService['_session'];
		getSubscription: () => SubscriptionService['_subscription'];
		onDidCheckIn: SubscriptionService['_onDidCheckIn'];
		changeSubscription: SubscriptionService['changeSubscription'];
		getStoredSubscription: SubscriptionService['getStoredSubscription'];
	},
): void {
	if (!container.debugging) return;

	new AccountDebug(container, subscriptionStub);
}

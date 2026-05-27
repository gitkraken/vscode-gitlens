import type { Disposable, QuickInputButton } from 'vscode';
import { QuickInputButtonLocation, ThemeIcon, window } from 'vscode';
import type { RepositoryVisibility } from '@gitlens/git/providers/types.js';
import { proFeaturePreviewUsages, proTrialLengthInDays, SubscriptionState } from '../../constants.subscription.js';
import type { Container } from '../../container.js';
import { setSimulatedRepoVisibility } from '../../git/__debug__visibilityDebug.js';
import type { QuickPickItemOfT } from '../../quickpicks/items/common.js';
import { createQuickPickSeparator } from '../../quickpicks/items/common.js';
import { registerCommand } from '../../system/-webview/command.js';
import { supportedInVSCodeVersion } from '../../system/-webview/vscode.js';
import type { OnboardingSnapshot } from '../__debug__onboardingHelper.js';
import { dismissAllOnboarding, restoreOnboarding } from '../__debug__onboardingHelper.js';
import type { GKCheckInResponse, GKLicenses, GKLicenseType, GKUser } from './models/checkin.js';
import type { Organization } from './models/organization.js';
import type { PaidSubscriptionPlanIds, SubscriptionPlanIds } from './models/subscription.js';
import type { SubscriptionService } from './subscriptionService.js';
import { getConfiguredActiveOrganizationId } from './utils/-webview/subscription.utils.js';
import { getSubscriptionFromCheckIn } from './utils/checkin.utils.js';

const SimulatedAccountId = '0000000000000-0000-0000-000000000000';
const SimulatedOrganizationId = '000000000000000000000000';

type SubscriptionServiceFacade = {
	getSubscription: () => SubscriptionService['_subscription'];
	overrideFeaturePreviews: (featurePreviews: SimulatedFeaturePreviews) => void;
	overrideSession: (session: SubscriptionService['_session']) => void;
	restoreFeaturePreviews: () => void;
	restoreSession: () => void;
	onDidCheckIn: SubscriptionService['_onDidCheckIn'];
	changeSubscription: SubscriptionService['changeSubscription'];
	getStoredSubscription: SubscriptionService['getStoredSubscription'];
	/** Re-fires the subscription change event with the current value to nudge access consumers. */
	refireSubscriptionChange: () => void;
};

export function registerAccountDebug(container: Container, service: SubscriptionServiceFacade): void {
	new AccountDebug(container, service);
}

interface SimulatedFeaturePreviews {
	day: number;
	durationSeconds: number;
}

export type SimulationState =
	| {
			state: null;
			reactivatedTrial?: never;
			expiredPaid?: never;
			planId?: never;
			featurePreviews?: never;
			dismissOnboarding?: never;
	  }
	| {
			state: SubscriptionState.Community;
			reactivatedTrial?: never;
			expiredPaid?: never;
			planId?: never;
			featurePreviews?: SimulatedFeaturePreviews;
			dismissOnboarding?: boolean;
	  }
	| {
			state: Exclude<SubscriptionState, SubscriptionState.Trial | SubscriptionState.Paid>;
			reactivatedTrial?: never;
			expiredPaid?: never;
			planId?: never;
			featurePreviews?: never;
			dismissOnboarding?: boolean;
	  }
	| {
			state: SubscriptionState.Trial;
			reactivatedTrial?: boolean;
			expiredPaid?: never;
			planId?: Extract<'advanced' | 'student', SubscriptionPlanIds>;
			featurePreviews?: never;
			dismissOnboarding?: boolean;
	  }
	| {
			state: SubscriptionState.Paid;
			reactivatedTrial?: never;
			expiredPaid?: boolean;
			planId?: PaidSubscriptionPlanIds;
			featurePreviews?: never;
			dismissOnboarding?: boolean;
	  };

type SimulateQuickPickItem = QuickPickItemOfT<SimulationState>;

function getVisibilityButton(visibility: RepositoryVisibility | undefined): QuickInputButton {
	const inline = supportedInVSCodeVersion('quickpick-button-location') ? QuickInputButtonLocation.Inline : undefined;
	switch (visibility) {
		case 'public':
			return { iconPath: new ThemeIcon('globe'), tooltip: 'Simulating Public Repos', location: inline };
		case 'private':
			return { iconPath: new ThemeIcon('lock'), tooltip: 'Simulating Private Repos', location: inline };
		default:
			return { iconPath: new ThemeIcon('eye'), tooltip: 'Simulate Repo Visibility', location: inline };
	}
}

function nextSimulatedVisibility(current: RepositoryVisibility | undefined): RepositoryVisibility | undefined {
	switch (current) {
		case undefined:
			return 'private';
		case 'private':
			return 'public';
		default:
			return undefined;
	}
}

class AccountDebug {
	private simulatingPick: SimulateQuickPickItem | undefined;
	private simulatedVisibility: RepositoryVisibility | undefined;
	private onboardingSnapshot: OnboardingSnapshot | undefined;

	constructor(
		private readonly container: Container,
		private readonly service: SubscriptionServiceFacade,
	) {
		this.container.context.subscriptions.push(
			registerCommand(
				'gitlens.plus.simulate.subscription',
				(state?: SimulationState) => this.simulateSubscription(state),
				undefined,
				{ returnResult: true },
			),
		);
	}

	// Simulate a subscription state. If state is provided, directly sets it; otherwise shows the UI picker.
	private simulateSubscription(state?: SimulationState): Promise<boolean | void> {
		// Direct simulation without UI
		if (state != null) {
			return this.startSimulation(state);
		}

		// Show interactive picker
		void this.showSimulator();
		return Promise.resolve();
	}

	// Show a quickpick to select a subscription state to simulate
	private async showSimulator() {
		function getItemsAndPicked(
			pick: SimulateQuickPickItem | undefined,
		): [SimulateQuickPickItem[], SimulateQuickPickItem | undefined] {
			const items: SimulateQuickPickItem[] = [
				{
					label: 'Community',
					description: 'Community, no account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Community, featurePreviews: { day: 0, durationSeconds: 30 } },
				},
				{
					label: 'Community: Feature Previews (Start Day 2)',
					description: 'Community, no account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Community, featurePreviews: { day: 1, durationSeconds: 30 } },
				},
				{
					label: 'Community: Feature Previews (Start Day 3)',
					description: 'Community, no account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Community, featurePreviews: { day: 2, durationSeconds: 30 } },
				},
				{
					label: 'Community: Feature Previews (Expired)',
					description: 'Community, no account',
					iconPath: new ThemeIcon('blank'),
					item: {
						state: SubscriptionState.Community,
						featurePreviews: { day: proFeaturePreviewUsages, durationSeconds: 30 },
					},
				},
				// createQuickPickSeparator('Preview'),
				// {
				// 	label: 'Pro Preview',
				// 	description: 'Pro, no account',
				// 	iconPath: new ThemeIcon('blank'),
				// 	item: { state: SubscriptionState.ProPreview },
				// },
				// {
				// 	label: 'Pro Preview (Expired)',
				// 	description: 'Community, no account',
				// 	iconPath: new ThemeIcon('blank'),
				// 	item: { state: SubscriptionState.ProPreviewExpired },
				// },
				createQuickPickSeparator('Account'),
				{
					label: 'Verification Required',
					description: 'Community, account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.VerificationRequired },
				},
				createQuickPickSeparator('Trial'),
				{
					label: 'Pro Trial',
					description: 'Pro trial (pro plan), account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Trial },
				},
				{
					label: 'Pro Trial (Reactivated)',
					description: 'Pro trial (pro plan), account',
					iconPath: new ThemeIcon('blank'),
					item: {
						state: SubscriptionState.Trial,
						reactivatedTrial: true,
					},
				},
				{
					label: 'Pro Trial (Advanced)',
					description: 'Pro trial (advanced plan), account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Trial, planId: 'advanced' },
				},
				{
					label: 'Pro Trial (Advanced, Reactivated)',
					description: 'Pro trial (advanced plan), account',
					iconPath: new ThemeIcon('blank'),
					item: {
						state: SubscriptionState.Trial,
						planId: 'advanced',
						reactivatedTrial: true,
					},
				},
				{
					label: 'Pro Trial (Student)',
					description: 'Student trial (student plan), account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Trial, planId: 'student' },
				},
				{
					label: 'Pro Trial (Expired)',
					description: 'Community, account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.TrialExpired },
				},
				{
					label: 'Pro Trial (Reactivation Eligible)',
					description: 'Community, account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.TrialReactivationEligible },
				},
				createQuickPickSeparator('Paid'),
				{
					label: 'Student',
					description: 'Student plan, account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Paid, planId: 'student' },
				},
				{
					label: 'Pro',
					description: 'Pro, account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Paid, planId: 'pro' },
				},
				{
					label: 'Advanced',
					description: 'Advanced plan, account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Paid, planId: 'advanced' },
				},
				{
					label: 'Business',
					description: 'Business plan, account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Paid, planId: 'teams' },
				},
				{
					label: 'Enterprise',
					description: 'Enterprise plan, account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Paid, planId: 'enterprise' },
				},
				// TODO: Update this subscription state once we have a "paid expired" state available
				{
					label: 'Paid (Expired)',
					description: 'Community, account',
					iconPath: new ThemeIcon('blank'),
					item: { state: SubscriptionState.Paid, expiredPaid: true },
				},
			];

			let picked;
			if (pick != null) {
				picked = items.find(i => i.label === pick?.label);
				if (picked != null) {
					picked.iconPath = new ThemeIcon('check');
				}

				items.splice(
					0,
					0,
					{
						label: 'End Simulation',
						description: 'Restores stored subscription',
						iconPath: new ThemeIcon('beaker-stop'),
						item: { state: null },
					},
					createQuickPickSeparator(),
				);
			}

			return [items, picked];
		}

		const quickpick = window.createQuickPick<SimulateQuickPickItem>();
		quickpick.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		try {
			await new Promise<void>(resolve => {
				disposables.push(
					quickpick.onDidHide(() => resolve()),
					quickpick.onDidAccept(async () => {
						const [item] = quickpick.activeItems;

						const started = await this.startSimulation(item?.item);
						if (!started) {
							resolve();

							return;
						}

						this.simulatingPick = item;

						const [items, picked] = getItemsAndPicked(this.simulatingPick);
						quickpick.items = items;
						quickpick.activeItems = picked ? [picked] : [];
					}),
					quickpick.onDidTriggerButton(() => {
						this.simulatedVisibility = nextSimulatedVisibility(this.simulatedVisibility);
						setSimulatedRepoVisibility(this.simulatedVisibility);
						this.service.refireSubscriptionChange();
						quickpick.buttons = [getVisibilityButton(this.simulatedVisibility)];
					}),
				);

				quickpick.title = 'Subscription Simulator';
				quickpick.placeholder = 'Choose the subscription state to simulate';
				quickpick.buttons = [getVisibilityButton(this.simulatedVisibility)];

				const [items, picked] = getItemsAndPicked(this.simulatingPick);
				quickpick.items = items;
				quickpick.activeItems = picked ? [picked] : [];

				quickpick.show();
			});
		} finally {
			quickpick.dispose();
			disposables.forEach(d => void d.dispose());
		}
	}

	private endSimulation() {
		this.simulatingPick = undefined;
		this.simulatedVisibility = undefined;
		setSimulatedRepoVisibility(undefined);

		this.service.restoreFeaturePreviews();
		this.service.restoreSession();
		this.service.changeSubscription(this.service.getStoredSubscription(), undefined, { store: false });

		if (this.onboardingSnapshot != null) {
			const snapshot = this.onboardingSnapshot;
			this.onboardingSnapshot = undefined;
			void restoreOnboarding(this.container, snapshot);
		}
	}

	private async startSimulation(simulatedState: SimulationState | undefined): Promise<boolean> {
		if (simulatedState?.state == null) {
			this.endSimulation();
			return false;
		}

		// Snapshot + dismiss onboarding only on first start that requests it; subsequent
		// starts don't re-snapshot (preserves the original "what was undismissed" record).
		if (simulatedState.dismissOnboarding && this.onboardingSnapshot == null) {
			this.onboardingSnapshot = await dismissAllOnboarding(this.container);
		}

		const { state, reactivatedTrial, expiredPaid, planId, featurePreviews } = simulatedState;

		switch (state) {
			case SubscriptionState.Community:
				this.service.overrideSession(null);
				if (featurePreviews != null) {
					this.service.overrideFeaturePreviews(featurePreviews);
				} else {
					this.service.restoreFeaturePreviews();
				}

				this.service.changeSubscription(undefined, undefined, { store: false });

				return true;
		}

		this.service.restoreFeaturePreviews();
		this.service.restoreSession();

		const subscription = this.service.getStoredSubscription();

		let accountId: string;
		let organizations: Organization[] = [];
		let activeOrganizationId: string | undefined;

		if (subscription?.account != null) {
			accountId = subscription.account.id;
			organizations = (await this.container.organizations.getOrganizations({ userId: accountId })) ?? [];

			activeOrganizationId = getConfiguredActiveOrganizationId();
			if (activeOrganizationId === '' || (activeOrganizationId == null && organizations.length === 1)) {
				activeOrganizationId = organizations[0]?.id;
			}
		} else {
			accountId = SimulatedAccountId;
			activeOrganizationId = SimulatedOrganizationId;
		}

		const simulatedCheckInData: GKCheckInResponse = getSimulatedCheckInResponse(
			{
				id: accountId,
				name: 'Simulated User',
				email: 'simulated@user.com',
				status: state === SubscriptionState.VerificationRequired ? 'pending' : 'activated',
				createdDate: new Date().toISOString(),
			},
			state,
			planId === 'enterprise'
				? 'gitkraken_v1-hosted-enterprise'
				: planId === 'teams'
					? 'gitkraken_v1-teams'
					: planId === 'advanced'
						? 'gitkraken_v1-advanced'
						: planId === 'student'
							? 'gitkraken_v1-edu'
							: 'gitkraken_v1-pro',
			{
				organizationId: activeOrganizationId,
				trial: { reactivatedTrial: reactivatedTrial },
				expiredPaid: expiredPaid,
			},
		);

		this.service.onDidCheckIn.fire();
		const simulatedSubscription = getSubscriptionFromCheckIn(
			simulatedCheckInData,
			organizations,
			activeOrganizationId,
		);

		this.service.changeSubscription({ ...subscription, ...simulatedSubscription }, undefined, { store: false });

		return true;
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
	durationDays: number = proTrialLengthInDays,
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
		case SubscriptionState.TrialExpired:
			trialLicenseStatus = 'expired';
			break;
		case SubscriptionState.TrialReactivationEligible:
			trialLicenseStatus = 'expired-reactivatable';
			break;
		case SubscriptionState.Trial:
			trialLicenseStatus = options?.trial?.reactivatedTrial ? 'active-reactivated' : 'active-new';
			break;
	}
	const trialLicenseData =
		targetSubscriptionState === SubscriptionState.Trial ||
		targetSubscriptionState === SubscriptionState.TrialExpired ||
		targetSubscriptionState === SubscriptionState.TrialReactivationEligible
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
			targetSubscriptionState === SubscriptionState.TrialReactivationEligible
				? tenSecondsAgo.toISOString()
				: undefined,
	};
}

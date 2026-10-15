/* oxlint-disable no-template-curly-in-string -- fixture bullets contain the literal `${aiCredits}` placeholder token */

import * as assert from 'assert';
import { SubscriptionState } from '../../../../constants.subscription.js';
import type { PlansContent } from '../../models/plans.js';
import { defaultPlansContent } from '../../models/plans.js';
import type { Subscription, SubscriptionPlanIds } from '../../models/subscription.js';
import {
	computeSubscriptionState,
	getSubscriptionPlan,
	getSubscriptionPlanAiCredits,
	getSubscriptionPlanFeatures,
	getSubscriptionPlanUpgradeFeatures,
	omitRefusedTrialReactivation,
} from '../subscription.utils.js';

suite('Subscription Utils Test Suite', () => {
	suite('getSubscriptionPlanAiCredits', () => {
		test('a non-trial returns the plan’s own aiCredits figure', () => {
			assert.strictEqual(getSubscriptionPlanAiCredits(defaultPlansContent, 'pro', false), '1M');
			assert.strictEqual(getSubscriptionPlanAiCredits(defaultPlansContent, 'teams', false), '3M');
		});

		test('a trial of a plan with no specific trialAiCredits entry falls back to default', () => {
			assert.strictEqual(getSubscriptionPlanAiCredits(defaultPlansContent, 'pro', true), '250K');
			assert.strictEqual(getSubscriptionPlanAiCredits(defaultPlansContent, 'advanced', true), '250K');
			assert.strictEqual(getSubscriptionPlanAiCredits(defaultPlansContent, 'student', true), '250K');
		});

		test('a teams trial returns the 500K Business Trial grant, not the 250K default (regression: was 2x understated)', () => {
			assert.strictEqual(getSubscriptionPlanAiCredits(defaultPlansContent, 'teams', true), '500K');
		});
	});

	suite('getSubscriptionPlanFeatures', () => {
		const plans: PlansContent = {
			aiCredits: {
				student: '500K',
				pro: '1M',
				advanced: '2M',
				teams: '3M',
				enterprise: '4M',
			},
			trialAiCredits: {
				default: '250K',
				teams: '500K',
			},
			features: {
				default: ['Bullet one — ${aiCredits} credits/week', 'Bullet two'],
				teams: ['Business bullet — ${aiCredits} credits/week'],
			},
			upgradeFeatures: {
				pro: ['Upgrade to Pro — ${aiCredits} credits/week'],
				advanced: ['Upgrade to Advanced — ${aiCredits} credits/week'],
			},
		};

		test('substitutes ${aiCredits} in every bullet of the resolved list', () => {
			const features = getSubscriptionPlanFeatures(plans, 'pro', false);

			assert.deepStrictEqual(features, ['Bullet one — 1M credits/week', 'Bullet two']);
		});

		test('falls back to features.default for a plan with no list of its own', () => {
			const features = getSubscriptionPlanFeatures(plans, 'student', false);

			assert.deepStrictEqual(features, ['Bullet one — 500K credits/week', 'Bullet two']);
		});

		test('an unpaid id (community) resolves Pro’s figure rather than throwing', () => {
			const features = getSubscriptionPlanFeatures(plans, 'community', false);

			assert.deepStrictEqual(features, ['Bullet one — 1M credits/week', 'Bullet two']);
		});

		test('a trialling teams user gets the Business bullets with the 500K figure', () => {
			const features = getSubscriptionPlanFeatures(defaultPlansContent, 'teams', true);

			for (const feature of features) {
				assert.ok(!feature.includes('250K'), `unexpected 250K in: ${feature}`);
			}
			assert.ok(
				features.some(feature => feature.includes('500K')),
				'expected the 500K Business Trial figure in at least one bullet',
			);
		});
	});

	suite('getSubscriptionPlanUpgradeFeatures', () => {
		const plans: PlansContent = {
			aiCredits: {
				student: '500K',
				pro: '1M',
				advanced: '2M',
				teams: '3M',
				enterprise: '4M',
			},
			trialAiCredits: {
				default: '250K',
			},
			features: {
				default: [],
			},
			upgradeFeatures: {
				pro: ['Pro pitch — ${aiCredits} credits/week'],
				advanced: ['Advanced pitch — ${aiCredits} credits/week'],
			},
		};

		test('resolves the figure against the list’s own plan, not the viewer’s', () => {
			assert.deepStrictEqual(getSubscriptionPlanUpgradeFeatures(plans, 'pro'), ['Pro pitch — 1M credits/week']);
			assert.deepStrictEqual(getSubscriptionPlanUpgradeFeatures(plans, 'advanced'), [
				'Advanced pitch — 2M credits/week',
			]);
		});
	});

	suite('omitRefusedTrialReactivation', () => {
		const optInDate = '2026-01-01T00:00:00.000Z';

		function createSubscription(effectiveId: SubscriptionPlanIds): Omit<Subscription, 'state'> {
			const actual = getSubscriptionPlan('community-with-account', false, 0, undefined);
			return {
				account: { id: 'acct', name: 'Test', email: undefined, verified: true, createdOn: optInDate },
				plan: {
					actual: actual,
					effective:
						effectiveId === 'community-with-account'
							? getSubscriptionPlan(
									effectiveId,
									false,
									0,
									undefined,
									undefined,
									undefined,
									false,
									optInDate,
								)
							: getSubscriptionPlan(
									effectiveId,
									false,
									0,
									undefined,
									new Date(),
									new Date(Date.now() + 86_400_000),
									false,
									optInDate,
								),
				},
			};
		}

		test('drops the refused opt-in date so the state computes to trial-expired', () => {
			const subscription = createSubscription('community-with-account');
			assert.strictEqual(computeSubscriptionState(subscription), SubscriptionState.TrialReactivationEligible);

			const result = omitRefusedTrialReactivation(subscription, optInDate);
			assert.strictEqual(result.plan.effective.nextTrialOptInDate, undefined);
			assert.strictEqual(computeSubscriptionState(result), SubscriptionState.TrialExpired);
		});

		test('keeps the offer when the refusal was for another opt-in window', () => {
			const subscription = createSubscription('community-with-account');
			const result = omitRefusedTrialReactivation(subscription, '2025-01-01T00:00:00.000Z');
			assert.strictEqual(result, subscription);
			assert.strictEqual(computeSubscriptionState(result), SubscriptionState.TrialReactivationEligible);
		});

		test('keeps the offer when nothing was refused', () => {
			const subscription = createSubscription('community-with-account');
			assert.strictEqual(omitRefusedTrialReactivation(subscription, undefined), subscription);
		});

		test('leaves a trial plan alone even when it carries the refused date', () => {
			const subscription = createSubscription('pro');
			const result = omitRefusedTrialReactivation(subscription, optInDate);
			assert.strictEqual(result, subscription);
			assert.strictEqual(computeSubscriptionState(result), SubscriptionState.Trial);
		});
	});
});

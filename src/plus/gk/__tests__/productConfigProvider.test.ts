/* oxlint-disable no-template-curly-in-string -- fixture/authored bullets contain the literal `${aiCredits}` placeholder token */

import * as assert from 'assert';
import { Container } from '../../../container.js';
import type { PlansContent } from '../models/plans.js';
import { defaultPlansContent } from '../models/plans.js';
import type { Config } from '../productConfigProvider.js';
import { parseProductConfig } from '../productConfigProvider.js';

/**
 * DO NOT REMOVE — this reference is what keeps the import above from being elided, and the import is
 * load-BEARING, not decorative. `productConfigProvider.ts` reaches `system/-webview/vscode.ts` →
 * `system/-webview/command.ts`, whose module init calls into `container.ts` before it has finished
 * assigning its own `registrableCommands` array; `container.ts`'s tree then reaches a `@command()`-
 * decorated class that calls back into `command.ts` mid-init and reads that array while it is still
 * undefined. Loading `container.ts` first breaks the cycle. Without this, Mocha fails at FILE LOAD and
 * the whole suite reports zero tests — a failure that looks nothing like its cause.
 */
void Container;

suite('ProductConfigProvider Test Suite', () => {
	suite('parseProductConfig — plans', () => {
		test('a malformed plans block does not drop the rest of the config', () => {
			const config: Config | undefined = parseProductConfig({
				promosV2: [{ v: 2, key: 'test-promo', plan: 'pro' }],
				plans: { aiCredits: 'not-an-object', features: 42, upgradeFeatures: [] },
			});

			assert.notStrictEqual(config, undefined);
			assert.strictEqual(config!.promos.length, 1);
			assert.strictEqual(config!.promos[0].key, 'test-promo');
			assert.deepStrictEqual(config!.plans, defaultPlansContent);
		});

		test('plans of an outright wrong type still does not drop the config', () => {
			// The companion to the case above, and the reason the top-level validator waves `plans`
			// through entirely rather than checking it is an object: that validator is all-or-nothing, so
			// any rejection there — even of a value this tolerant — would take the promos with it.
			const config = parseProductConfig({
				promosV2: [{ v: 2, key: 'test-promo', plan: 'pro' }],
				plans: 'nope',
			});

			assert.notStrictEqual(config, undefined);
			assert.strictEqual(config!.promos.length, 1);
			assert.deepStrictEqual(config!.plans, defaultPlansContent);
		});

		test('absent plans resolves to the built-in default', () => {
			const config = parseProductConfig({});

			assert.notStrictEqual(config, undefined);
			assert.deepStrictEqual(config!.plans, defaultPlansContent);
		});

		test('an authored aiCredits naming one key overrides only that key', () => {
			const config = parseProductConfig({ plans: { aiCredits: { pro: '10M' } } });

			assert.deepStrictEqual(config!.plans.aiCredits, { ...defaultPlansContent.aiCredits, pro: '10M' });
			assert.deepStrictEqual(config!.plans.trialAiCredits, defaultPlansContent.trialAiCredits);
			assert.deepStrictEqual(config!.plans.features, defaultPlansContent.features);
			assert.deepStrictEqual(config!.plans.upgradeFeatures, defaultPlansContent.upgradeFeatures);
		});

		test('an authored trialAiCredits naming one key overrides only that key', () => {
			const config = parseProductConfig({ plans: { trialAiCredits: { teams: '750K' } } });

			assert.deepStrictEqual(config!.plans.trialAiCredits, {
				...defaultPlansContent.trialAiCredits,
				teams: '750K',
			});
			assert.deepStrictEqual(config!.plans.aiCredits, defaultPlansContent.aiCredits);
			assert.deepStrictEqual(config!.plans.features, defaultPlansContent.features);
			assert.deepStrictEqual(config!.plans.upgradeFeatures, defaultPlansContent.upgradeFeatures);
		});

		test('an authored features naming one key overrides only that key', () => {
			const config = parseProductConfig({ plans: { features: { default: ['Only bullet'] } } });

			assert.deepStrictEqual(config!.plans.features, {
				...defaultPlansContent.features,
				default: ['Only bullet'],
			});
			assert.deepStrictEqual(config!.plans.aiCredits, defaultPlansContent.aiCredits);
			assert.deepStrictEqual(config!.plans.upgradeFeatures, defaultPlansContent.upgradeFeatures);
		});

		test('an authored upgradeFeatures naming one key overrides only that key', () => {
			const config = parseProductConfig({ plans: { upgradeFeatures: { pro: ['Only bullet'] } } });

			assert.deepStrictEqual(config!.plans.upgradeFeatures, {
				...defaultPlansContent.upgradeFeatures,
				pro: ['Only bullet'],
			});
			assert.deepStrictEqual(config!.plans.aiCredits, defaultPlansContent.aiCredits);
			assert.deepStrictEqual(config!.plans.features, defaultPlansContent.features);
		});

		test('drops an unrecognized plan id in aiCredits, keeping the default', () => {
			const config = parseProductConfig({ plans: { aiCredits: { bogusPlan: '1M' } } });

			assert.deepStrictEqual(config!.plans.aiCredits, defaultPlansContent.aiCredits);
		});

		test('drops a non-string aiCredits value, keeping the default for that key', () => {
			const config = parseProductConfig({ plans: { aiCredits: { pro: 42, student: '999K' } } });

			assert.deepStrictEqual(config!.plans.aiCredits, { ...defaultPlansContent.aiCredits, student: '999K' });
		});

		test('drops an unrecognized plan id in trialAiCredits, keeping the default', () => {
			const config = parseProductConfig({ plans: { trialAiCredits: { bogusPlan: '1M' } } });

			assert.deepStrictEqual(config!.plans.trialAiCredits, defaultPlansContent.trialAiCredits);
		});

		test('drops a non-string trialAiCredits value, keeping the default for that key', () => {
			const config = parseProductConfig({ plans: { trialAiCredits: { teams: 42, default: '300K' } } });

			assert.deepStrictEqual(config!.plans.trialAiCredits, {
				...defaultPlansContent.trialAiCredits,
				default: '300K',
			});
		});

		test('drops a features entry that is a string rather than a string array, keeping the default', () => {
			const config = parseProductConfig({ plans: { features: { default: 'not an array' } } });

			assert.deepStrictEqual(config!.plans.features, defaultPlansContent.features);
		});

		test('drops a features array containing a non-string element, keeping the default', () => {
			const config = parseProductConfig({ plans: { features: { default: ['ok', 42] } } });

			assert.deepStrictEqual(config!.plans.features, defaultPlansContent.features);
		});

		test('an explicitly authored empty array is honored, not treated as "use the default"', () => {
			const config = parseProductConfig({
				plans: { features: { default: [] }, upgradeFeatures: { pro: [] } },
			});

			assert.deepStrictEqual(config!.plans.features.default, []);
			assert.deepStrictEqual(config!.plans.features.advanced, defaultPlansContent.features.advanced);
			assert.deepStrictEqual(config!.plans.upgradeFeatures.pro, []);
			assert.deepStrictEqual(
				config!.plans.upgradeFeatures.advanced,
				defaultPlansContent.upgradeFeatures.advanced,
			);
		});

		test('the published product.json plans block still resolves to the client defaults', () => {
			// Mirrors the "plans" block currently published in vscode-gitlens-private/product.json.
			// If this fails, the published copy and `defaultPlansContent` have drifted from each other —
			// which is exactly the drift this test exists to catch.
			const publishedPlans: PlansContent = {
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
					default: [
						'Commit Graph & Visual File History on private repos',
						'Issue tracker integrations — Jira, Linear & more',
						'Launchpad, Worktrees & Code Suggest on private repos',
						'AI features — ${aiCredits} credits/week',
					],
					advanced: [
						'Everything in Pro',
						'Self-hosted Git integrations',
						'Pull request automations & Team Launchpad',
						'Single domain SSO & AI security controls',
						'AI features — ${aiCredits} credits/week',
					],
					teams: [
						'Everything in Advanced',
						'Multi-domain SSO',
						'Org-level AI controls & bring-your-own-key',
						'GitKraken Insights & Git training',
						'AI features — ${aiCredits} credits/week',
					],
					enterprise: [
						'Everything in Business',
						'Security audit logs',
						'Custom terms, contracting & security review',
						'Dedicated CSM & SLA-backed support',
						'AI features — ${aiCredits} credits/week',
					],
				},
				upgradeFeatures: {
					pro: [
						'Unlimited cloud integrations',
						'Smart AI features — ${aiCredits} credits/week',
						'Powerful tools — Commit Graph, Visual History, & Git Worktrees for private repos',
						'Streamlined workflows — start work from issues, pull request reviews',
					],
					advanced: ['Self-hosted integrations', 'Advanced AI features — ${aiCredits} credits/week'],
				},
			};

			const config = parseProductConfig({ plans: publishedPlans });

			assert.deepStrictEqual(config!.plans, defaultPlansContent);
		});
	});
});

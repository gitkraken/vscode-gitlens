import type { Lazy } from '@gitlens/utils/lazy.js';
import { lazy } from '@gitlens/utils/lazy.js';
import { getLoggableName } from '@gitlens/utils/logger.js';
import { maybeStartScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Validator } from '@gitlens/utils/validation.js';
import { createValidator, Is } from '@gitlens/utils/validation.js';
import type { GlExtensionCommands } from '../../constants.commands.js';
import { SubscriptionState } from '../../constants.subscription.js';
import type { Container } from '../../container.js';
import { deviceCohortGroup } from '../../system/-webview/vscode.js';
import type { PlansContent } from './models/plans.js';
import { defaultPlansContent } from './models/plans.js';
import type { Promo, PromoLocation, PromoLocationV2, PromoPlans } from './models/promo.js';
import type { PaidSubscriptionPlanIds, SubscriptionPlanIds } from './models/subscription.js';
import type { ServerConnection } from './serverConnection.js';

export type Config = {
	promos: Promo[];
	cli: {
		minimumCoreVersion: string;
		minimumProxyVersion: string;
	};
	plans: PlansContent;
};

type ConfigJson = {
	/** @deprecated this doesn't provide value, but we need to keep it for old clients */
	v?: number;
	promos?: PromoJson[];
	promosV2?: PromoV2Json[];
	promosV2plus?: PromoV2PlusJson[];
	cli?: {
		minimumCoreVersion: string;
		minimumProxyVersion: string;
	};
	/** Deliberately untyped here — validated field-by-field in `resolvePlans`, NOT by the top-level
	 * validator; see the note on the `plans` entry in {@link createConfigValidator}. */
	plans?: unknown;
};
type PromoJson = Replace<Promo, 'plan' | 'expiresOn' | 'startsOn', string | undefined> & {
	v?: number;
	plan?: PromoPlans;
};
type PromoV2Json = Replace<Promo, 'expiresOn' | 'startsOn', string | undefined> & { v: number | undefined };

/** promo with v=3 is tolerant to adding a new location without bumping a version.
 * The new location won't break a client that does not support it, the unknown location just gets ignored */
type PromoV3Json = Replace<PromoV2Json, 'locations', string[] | undefined>;
type PromoFutureJson = { v: number };
type PromoV2PlusJson = PromoV2Json | PromoV3Json | PromoFutureJson;

const maxKnownPromoVersion = 3;

const fallbackConfig: Config = {
	promos: [
		{
			key: 'pro50',
			plan: 'pro',
			states: [
				SubscriptionState.Community,
				SubscriptionState.Trial,
				SubscriptionState.TrialExpired,
				SubscriptionState.TrialReactivationEligible,
			],
			locations: ['home', 'account', 'badge', 'gate'],
			content: {
				modal: { detail: 'Save up to 50% on GitLens Pro' },
				quickpick: { detail: '$(star-full) Save up to 50% on GitLens Pro' },
				webview: {
					info: { html: '<b>Save up to 50%</b> on GitLens Pro' },
					link: {
						html: '<b>Save up to 50%</b> on GitLens Pro',
						title: 'Upgrade now and Save up to 50% on GitLens Pro',
					},
				},
			},
		} satisfies Promo,
	],
	cli: {
		minimumCoreVersion: '3.1.63',
		minimumProxyVersion: '3.1.53',
	},
	plans: defaultPlansContent,
} as const;

export class ProductConfigProvider {
	private readonly _lazyConfig: Lazy<Promise<Config>>;

	constructor(container: Container, connection: ServerConnection) {
		this._lazyConfig = lazy(async () => {
			using scope = maybeStartScopedLogger(`${getLoggableName(this)}.load`);

			let data;
			const failed = {
				validation: false,
				exception: undefined as Error | undefined,
				statusCode: undefined as number | undefined,
			};

			if (DEBUG) {
				try {
					const data =
						// prettier-ignore
						(
							// oxlint-disable-next-line typescript/ban-ts-comment -- using @ts-ignore instead of @ts-expect-error because if `product.json` is found then @ts-expect-error will complain because its not an error anymore
							// @ts-ignore
							await import(/* webpackChunkName: "product-config" */ '../../../product.json', {
								with: { type: 'json' },
							})
						).default;
					if (data != null && Object.keys(data).length > 0) {
						const config = parseProductConfig(data);
						if (config != null) return config;

						debugger;
					}
				} catch {}
			}

			try {
				const rsp = await connection.fetchGkConfig('product.json');
				if (rsp.ok) {
					data = await rsp.json();

					const config = parseProductConfig(data);
					if (config != null) return config;

					failed.validation = true;
				} else {
					failed.statusCode = rsp.status;
				}
			} catch (ex) {
				failed.exception = ex;
				scope?.error(ex);
				debugger;
			}

			container.telemetry.sendEvent('productConfig/failed', {
				reason: failed.validation ? 'validation' : 'fetch',
				json: JSON.stringify(data),
				exception: failed.exception != null ? String(failed.exception) : undefined,
				statusCode: failed.statusCode,
			});

			const stored = container.storage.get('product:config');
			if (stored?.data != null) {
				return {
					...fallbackConfig,
					...stored.data,
					promos: stored.data.promos.map(p => ({ ...p, plan: p.plan ?? 'pro' }) satisfies Promo),
				} satisfies Config;
			}

			// If all else fails, return a default set of promos
			return fallbackConfig;
		});
	}

	async getApplicablePromo(
		state: SubscriptionState | undefined,
		plan: PromoPlans,
		location?: PromoLocation,
		expiringOnly?: boolean,
	): Promise<Promo | undefined> {
		if (state == null) return undefined;

		const promos = await this.getPromos();
		return getApplicablePromo(promos, state, plan, location, expiringOnly);
	}

	async getCliMinimumVersions(): Promise<{ core: string; proxy: string }> {
		const cli = (await this.getConfig()).cli;
		return {
			core: cli.minimumCoreVersion,
			proxy: cli.minimumProxyVersion,
		};
	}

	async getPlans(): Promise<PlansContent> {
		return (await this.getConfig()).plans;
	}

	private getConfig(): Promise<Config> {
		return this._lazyConfig.value;
	}

	private async getPromos(): Promise<Promo[]> {
		return (await this.getConfig()).promos;
	}
}

function createConfigValidator(): Validator<ConfigJson> {
	const isLocationV2 = Is.Enum<PromoLocationV2>('account', 'badge', 'gate', 'home');
	const isState = Is.Enum<SubscriptionState>(
		SubscriptionState.VerificationRequired,
		SubscriptionState.Community,
		// oxlint-disable-next-line typescript/no-deprecated -- allow deprecated states since we will just ignore them
		SubscriptionState.DeprecatedPreview,
		// oxlint-disable-next-line typescript/no-deprecated -- allow deprecated states since we will just ignore them
		SubscriptionState.DeprecatedPreviewExpired,
		SubscriptionState.Trial,
		SubscriptionState.TrialExpired,
		SubscriptionState.TrialReactivationEligible,
		SubscriptionState.Paid,
	);

	const isModal = createValidator({
		detail: Is.String,
	});

	const isQuickPick = createValidator({
		detail: Is.String,
	});

	const isWebviewInfo = createValidator({
		html: Is.Optional(Is.String),
	});

	const isCommandPattern = (value: unknown): value is GlExtensionCommands =>
		typeof value === 'string' && value.startsWith('gitlens.');

	const isWebviewLink = createValidator({
		html: Is.String,
		compactHtml: Is.Optional(Is.String),
		title: Is.String,
		command: Is.Optional((value): value is GlExtensionCommands => isCommandPattern(value)),
	});

	const isWebview = createValidator({
		info: Is.Optional(isWebviewInfo),
		link: Is.Optional(isWebviewLink),
	});

	const isContent = createValidator({
		modal: Is.Optional(isModal),
		quickpick: isQuickPick,
		webview: Is.Optional(isWebview),
	});

	const isContentV2 = createValidator({
		modal: isModal,
		quickpick: isQuickPick,
		webview: Is.Optional(isWebview),
	});

	const promoValidator = createValidator<PromoJson>({
		v: Is.Optional(Is.Number),
		plan: Is.Optional(Is.Enum<PromoPlans>('pro', 'advanced', 'teams', 'enterprise')),
		key: Is.String,
		code: Is.Optional(Is.String),
		states: Is.Optional(Is.Array(isState)),
		expiresOn: Is.Optional(Is.String),
		startsOn: Is.Optional(Is.String),
		locations: Is.Optional(Is.Array(isLocationV2)),
		content: Is.Optional(isContent),
		percentile: Is.Optional(Is.Number),
	});

	const promoV2Validator = createValidator<PromoV2Json>({
		v: Is.Number,
		key: Is.String,
		code: Is.Optional(Is.String),
		plan: Is.Enum<PromoPlans>('pro', 'advanced', 'teams', 'enterprise'),
		states: Is.Optional(Is.Array(isState)),
		expiresOn: Is.Optional(Is.String),
		startsOn: Is.Optional(Is.String),
		locations: Is.Optional(Is.Array(isLocationV2)),
		content: Is.Optional(isContentV2),
		percentile: Is.Optional(Is.Number),
	});

	// V3 differs from V2 in exactly one place: `locations` takes any string,
	// so unknown locations do not break the validation, they are filtered later.
	const promoV3Validator = createValidator<PromoV3Json>({
		v: Is.Number,
		key: Is.String,
		code: Is.Optional(Is.String),
		plan: Is.Enum<PromoPlans>('pro', 'advanced', 'teams', 'enterprise'),
		states: Is.Optional(Is.Array(isState)),
		expiresOn: Is.Optional(Is.String),
		startsOn: Is.Optional(Is.String),
		locations: Is.Optional(Is.Array(Is.String)),
		content: Is.Optional(isContentV2),
		percentile: Is.Optional(Is.Number),
	});

	const promoV2PlusValidator = (data: unknown): data is PromoV2PlusJson => {
		if (!Is.Object(data)) return false;

		const { v } = data as { v?: unknown };
		if (!Is.Number(v)) return false;
		if (v > maxKnownPromoVersion) return true;

		return v === 2 ? promoV2Validator(data) : v === 3 ? promoV3Validator(data) : false;
	};

	const cliValidator = createValidator({
		minimumCoreVersion: Is.String,
		minimumProxyVersion: Is.String,
	});

	return createValidator<ConfigJson>({
		cli: Is.Optional(cliValidator),
		// oxlint-disable-next-line typescript/no-deprecated
		v: Is.Optional(Is.Number),
		promos: Is.Optional(Is.Array(promoValidator)),
		promosV2: Is.Optional(Is.Array(promoV2Validator)),
		promosV2plus: Is.Optional(Is.Array(promoV2PlusValidator)),
		// Not checked here AT ALL, on purpose — this validator is all-or-nothing, so anything it rejects
		// drops the ENTIRE config and takes the live promo campaigns down with it. Marketing copy must
		// never be able to do that, so every `plans` value (including an outright wrong type) is waved
		// through to `resolvePlans`, which validates field-by-field and degrades whatever is malformed to
		// that key's default on its own.
		plans: (_value: unknown): _value is unknown => true,
	});
}

function getApplicablePromo(
	promos: Promo[],
	state: SubscriptionState | undefined,
	plan: PromoPlans,
	location?: PromoLocation,
	expiringOnly?: boolean,
): Promo | undefined {
	if (state == null) return undefined;

	// Each location resolves to the first applicable promo that SERVES it — a location miss is not
	// terminal (this used to `break`). With location-scoped campaigns now a first-class shape (`graph`
	// exists only on `v: 3` entries), a terminal miss would let a graph-only campaign blank every other
	// placement — or, ordered the other way, let any concurrent campaign blank the graph. Verified
	// equivalent on every historical config, where campaigns all carry the same location set.
	for (const promo of promos) {
		if (!isPromoApplicable(promo, state, plan, expiringOnly)) continue;

		// An empty `locations` targets nowhere — either authored as `[]`, or every value was
		// unrecognized by this client and dropped in `getConfig`. Such a promo must be fully
		// transparent, even to location-less lookups.
		if (promo.locations?.length === 0) continue;

		if (location == null || promo.locations == null || promo.locations.includes(location)) {
			return promo;
		}
	}

	return undefined;
}

type KnownPromoJson = PromoJson | PromoV2Json | PromoV3Json;
const isKnownVersion = (d: PromoJson | PromoV2PlusJson): d is KnownPromoJson =>
	d.v == null || d.v <= maxKnownPromoVersion;
const isPromoLocation = Is.Enum<PromoLocation>('account', 'badge', 'gate', 'home', 'graph');
function filterLocations(locations: string[] | undefined): PromoLocation[] | undefined {
	return locations?.filter(isPromoLocation);
}

const plansAiCreditsKeys: readonly PaidSubscriptionPlanIds[] = ['student', 'pro', 'advanced', 'teams', 'enterprise'];
const plansTrialAiCreditsKeys: readonly (PaidSubscriptionPlanIds | 'default')[] = [
	'default',
	'student',
	'pro',
	'advanced',
	'teams',
	'enterprise',
];
const plansFeaturesKeys: readonly (SubscriptionPlanIds | 'default')[] = [
	'default',
	'community',
	'community-with-account',
	'student',
	'pro',
	'advanced',
	'teams',
	'enterprise',
];
const plansUpgradeFeaturesKeys: readonly ('pro' | 'advanced')[] = ['pro', 'advanced'];
const isStringArray = Is.Array(Is.String);

/**
 * Layers an authored map over its defaults KEY BY KEY. A wholesale replace (a plain spread) would let a
 * partially-authored map blank every key it didn't mention, so only recognized keys carrying a well-formed
 * value win; unknown keys and wrong-typed values are dropped and keep their default. An explicitly authored
 * empty array is honored — that's authoring intent, the same way an empty `locations` means "targets
 * nowhere" above.
 */
function mergeAuthoredOverDefaults<T extends object, V>(
	defaults: T,
	authored: unknown,
	keys: readonly (keyof T & string)[],
	isValue: Validator<V>,
): T {
	if (!Is.Object(authored)) return defaults;

	const source = authored as Record<string, unknown>;

	const overrides: Record<string, V> = {};
	let overridden = false;
	for (const key of keys) {
		const value = source[key];
		if (!isValue(value)) continue;

		overrides[key] = value;
		overridden = true;
	}

	return overridden ? { ...defaults, ...overrides } : defaults;
}

function resolvePlans(authored: unknown): PlansContent {
	if (!Is.Object(authored)) return defaultPlansContent;

	const plans = authored as {
		aiCredits?: unknown;
		trialAiCredits?: unknown;
		features?: unknown;
		upgradeFeatures?: unknown;
	};
	return {
		aiCredits: mergeAuthoredOverDefaults(
			defaultPlansContent.aiCredits,
			plans.aiCredits,
			plansAiCreditsKeys,
			Is.String,
		),
		trialAiCredits: mergeAuthoredOverDefaults(
			defaultPlansContent.trialAiCredits,
			plans.trialAiCredits,
			plansTrialAiCreditsKeys,
			Is.String,
		),
		features: mergeAuthoredOverDefaults(
			defaultPlansContent.features,
			plans.features,
			plansFeaturesKeys,
			isStringArray,
		),
		upgradeFeatures: mergeAuthoredOverDefaults(
			defaultPlansContent.upgradeFeatures,
			plans.upgradeFeatures,
			plansUpgradeFeaturesKeys,
			isStringArray,
		),
	};
}

export function parseProductConfig(data: unknown): Config | undefined {
	const validator = createConfigValidator();
	if (!validator(data)) return undefined;

	const { promosV2, promosV2plus, promos: promosV1, plans: plansJson, ...rest } = data;

	// `promosV2plus` layers onto `promosV2` and onto nothing else; `promos` is the V1 legacy island.
	// The list is REVERSED here and reversed back after the dedupe below, so that when one key appears in
	// both lists the surviving entry keeps the `promosV2` slot (order is priority — an override must not
	// jump the queue), while keys that exist only in `promosV2plus` end up in front. The two reverses must
	// stay paired for EVERY path, or single-list configs come out in reverse priority order.
	const given: (PromoJson | PromoV2PlusJson)[] = (
		promosV2plus && promosV2 ? [...promosV2plus, ...promosV2] : [...(promosV2plus ?? promosV2 ?? promosV1 ?? [])]
	).reverse();
	// Drop promos from a version whose rules we don't have
	const known: KnownPromoJson[] = given.filter(isKnownVersion);
	const deduped: KnownPromoJson[] = [];
	for (const d of known) {
		const i = deduped.findIndex(x => x.key === d.key);
		if (i === -1) {
			deduped.push(d);
		} else if ((d.v ?? 0) > (deduped[i].v ?? 0)) {
			deduped[i] = d;
		}
	}

	const promos = deduped.reverse().map(
		d =>
			({
				key: d.key,
				code: d.code,
				plan: d.plan ?? 'pro',
				states: d.states,
				expiresOn: d.expiresOn == null ? undefined : new Date(d.expiresOn).getTime(),
				startsOn: d.startsOn == null ? undefined : new Date(d.startsOn).getTime(),
				locations: filterLocations(d.locations),
				content: d.content,
				percentile: d.percentile,
			}) satisfies Promo,
	);

	const config: Config = {
		...fallbackConfig,
		...rest,
		promos: promos,
		// Must come AFTER the `...rest` spread so a raw authored `plans` can't clobber the resolved one
		plans: resolvePlans(plansJson),
	};
	return config;
}

function isPromoApplicable(promo: Promo, state: SubscriptionState, plan: PromoPlans, expiringOnly?: boolean): boolean {
	const now = Date.now();

	return (
		(!expiringOnly || promo.expiresOn != null) &&
		(promo.plan == null || promo.plan === plan) &&
		(promo.states == null || promo.states.includes(state)) &&
		(promo.expiresOn == null || promo.expiresOn > now) &&
		(promo.startsOn == null || promo.startsOn < now) &&
		(promo.percentile == null || deviceCohortGroup <= promo.percentile)
	);
}

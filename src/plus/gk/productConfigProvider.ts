import type { GlCommands } from '../../constants.commands';
import { SubscriptionState } from '../../constants.subscription';
import type { Container } from '../../container';
import { deviceCohortGroup } from '../../system/-webview/vscode';
import type { Lazy } from '../../system/lazy';
import { lazy } from '../../system/lazy';
import { getLoggableName, Logger } from '../../system/logger';
import { startLogScope } from '../../system/logger.scope';
import type { Validator } from '../../system/validation';
import { createValidator, Is } from '../../system/validation';
import type { Promo, PromoLocation, PromoPlans } from './models/promo';
import type { ServerConnection } from './serverConnection';

type Config = {
	promos: Promo[];
};

type ConfigJson = {
	/** @deprecated this doesn't provide value, but we need to keep it for old clients */
	v?: number;
	promos?: PromoJson[];
	promosV2?: PromoV2Json[];
};
type PromoJson = Replace<Promo, 'plan' | 'expiresOn' | 'startsOn', string | undefined> & {
	v?: number;
	plan?: PromoPlans;
};
type PromoV2Json = Replace<Promo, 'expiresOn' | 'startsOn', string | undefined> & { v: number | undefined };

const maxKnownPromoVersion = 2;

export class ProductConfigProvider {
	private readonly _lazyConfig: Lazy<Promise<Config>>;

	constructor(container: Container, connection: ServerConnection) {
		this._lazyConfig = lazy(async () => {
			using scope = startLogScope(`${getLoggableName(this)}.load`, false);

			let data;
			const failed = {
				validation: false,
				exception: undefined as Error | undefined,
				statusCode: undefined as number | undefined,
			};

			if (DEBUG) {
				try {
					// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- using @ts-ignore instead of @ts-expect-error because if `product.json` is found then @ts-expect-error will complain because its not an error anymore
					// @ts-ignore
					const data = (await import('../../../product.json', { with: { type: 'json' } })).default;
					if (data != null && Object.keys(data).length > 0) {
						const config = getConfig(data);
						if (config != null) return config;

						debugger;
					}
				} catch {}
			}

			try {
				const rsp = await connection.fetchGkConfig('product.json');
				if (rsp.ok) {
					data = await rsp.json();

					const config = getConfig(data);
					if (config != null) return config;

					failed.validation = true;
				} else {
					failed.statusCode = rsp.status;
				}
			} catch (ex) {
				failed.exception = ex;
				Logger.error(ex, scope);
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
					...stored.data,
					promos: stored.data.promos.map(p => ({ ...p, plan: p.plan ?? 'pro' }) satisfies Promo),
				} satisfies Config;
			}

			// If all else fails, return a default set of promos
			return {
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
			};
		});
	}

	async getApplicablePromo(
		state: SubscriptionState | undefined,
		plan: PromoPlans,
		location?: PromoLocation,
	): Promise<Promo | undefined> {
		if (state == null) return undefined;

		const promos = await this.getPromos();
		return getApplicablePromo(promos, state, plan, location);
	}

	private getConfig(): Promise<Config> {
		return this._lazyConfig.value;
	}

	private async getPromos(): Promise<Promo[]> {
		return (await this.getConfig()).promos;
	}
}

function createConfigValidator(): Validator<ConfigJson> {
	const isLocation = Is.Enum<PromoLocation>('account', 'badge', 'gate', 'home');
	const isState = Is.Enum<SubscriptionState>(
		SubscriptionState.VerificationRequired,
		SubscriptionState.Community,
		// eslint-disable-next-line @typescript-eslint/no-deprecated -- allow deprecated states since we will just ignore them
		SubscriptionState.DeprecatedPreview,
		// eslint-disable-next-line @typescript-eslint/no-deprecated -- allow deprecated states since we will just ignore them
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

	const isCommandPattern = (value: unknown): value is GlCommands =>
		typeof value === 'string' && value.startsWith('gitlens.');

	const isWebviewLink = createValidator({
		html: Is.String,
		title: Is.String,
		command: Is.Optional((value): value is GlCommands => isCommandPattern(value)),
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
		locations: Is.Optional(Is.Array(isLocation)),
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
		locations: Is.Optional(Is.Array(isLocation)),
		content: Is.Optional(isContentV2),
		percentile: Is.Optional(Is.Number),
	});

	return createValidator<ConfigJson>({
		v: Is.Optional(Is.Number),
		promos: Is.Optional(Is.Array(promoValidator)),
		promosV2: Is.Optional(Is.Array(promoV2Validator)),
	});
}

function getApplicablePromo(
	promos: Promo[],
	state: SubscriptionState | undefined,
	plan: PromoPlans,
	location?: PromoLocation,
): Promo | undefined {
	if (state == null) return undefined;

	for (const promo of promos) {
		if (isPromoApplicable(promo, state, plan)) {
			if (location == null || promo.locations == null || promo.locations.includes(location)) {
				return promo;
			}
			break;
		}
	}

	return undefined;
}

function getConfig(data: unknown): Config | undefined {
	const validator = createConfigValidator();
	if (!validator(data)) return undefined;

	const promos = (data.promosV2 ?? data.promos ?? [])
		// Filter out promos that we don't know how to handle
		.filter(d => d.v == null || d.v <= maxKnownPromoVersion)
		.map(
			d =>
				({
					key: d.key,
					code: d.code,
					plan: d.plan ?? 'pro',
					states: d.states,
					expiresOn: d.expiresOn == null ? undefined : new Date(d.expiresOn).getTime(),
					startsOn: d.startsOn == null ? undefined : new Date(d.startsOn).getTime(),
					locations: d.locations,
					content: d.content,
					percentile: d.percentile,
				}) satisfies Promo,
		);

	const config: Config = { promos: promos };
	return config;
}

function isPromoApplicable(promo: Promo, state: SubscriptionState, plan: PromoPlans): boolean {
	const now = Date.now();

	return (
		(promo.plan == null || promo.plan === plan) &&
		(promo.states == null || promo.states.includes(state)) &&
		(promo.expiresOn == null || promo.expiresOn > now) &&
		(promo.startsOn == null || promo.startsOn < now) &&
		(promo.percentile == null || deviceCohortGroup <= promo.percentile)
	);
}

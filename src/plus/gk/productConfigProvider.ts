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
import type { Promo, PromoLocation } from './models/promo';
import type { ServerConnection } from './serverConnection';

type Config = {
	promos: Promo[];
};

type ConfigJson = {
	v: number;
	promos: PromoJson[];
};
type PromoJson = Replace<Promo, 'expiresOn' | 'startsOn', string | undefined>;

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

			try {
				const rsp = await connection.fetchGkConfig('product.json');
				if (rsp.ok) {
					data = await rsp.json();

					const validator = createConfigValidator();
					if (validator(data)) {
						const promos = data.promos.map(
							d =>
								({
									key: d.key,
									code: d.code,
									states: d.states,
									expiresOn: d.expiresOn == null ? undefined : new Date(d.expiresOn).getTime(),
									startsOn: d.startsOn == null ? undefined : new Date(d.startsOn).getTime(),
									locations: d.locations,
									content: d.content,
									percentile: d.percentile,
								}) satisfies Promo,
						);

						const config: Config = { promos: promos };
						await container.storage.store('product:config', { data: config, v: 1, timestamp: Date.now() });

						return config;
					}

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
			if (stored?.data != null) return stored.data;

			// If all else fails, return a default set of promos
			return {
				promos: [
					{
						key: 'pro50',
						states: [
							SubscriptionState.Community,
							SubscriptionState.ProPreview,
							SubscriptionState.ProPreviewExpired,
							SubscriptionState.ProTrial,
							SubscriptionState.ProTrialExpired,
							SubscriptionState.ProTrialReactivationEligible,
						],
						locations: ['home', 'account', 'badge', 'gate'],
						content: {
							quickpick: {
								detail: '$(star-full) Save 50% on GitLens Pro',
							},
							webview: {
								info: {
									html: '<b>Save 50%</b> on GitLens Pro',
								},
								link: {
									html: '<b>Save 50%</b> on GitLens Pro',
									title: 'Upgrade now and Save 50% on GitLens Pro',
								},
							},
						},
					} satisfies Promo,
				],
			};
		});
	}

	async getApplicablePromo(state: number | undefined, location?: PromoLocation): Promise<Promo | undefined> {
		if (state == null) return undefined;

		const promos = await this.getPromos();
		return getApplicablePromo(promos, state, location);
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
		SubscriptionState.ProPreview,
		SubscriptionState.ProPreviewExpired,
		SubscriptionState.ProTrial,
		SubscriptionState.ProTrialExpired,
		SubscriptionState.ProTrialReactivationEligible,
		SubscriptionState.Paid,
	);

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
		quickpick: isQuickPick,
		webview: Is.Optional(isWebview),
	});

	const promoValidator = createValidator<PromoJson>({
		key: Is.String,
		code: Is.Optional(Is.String),
		states: Is.Optional(Is.Array(isState)),
		expiresOn: Is.Optional(Is.String),
		startsOn: Is.Optional(Is.String),
		locations: Is.Optional(Is.Array(isLocation)),
		content: Is.Optional(isContent),
		percentile: Is.Optional(Is.Number),
	});

	return createValidator<ConfigJson>({
		v: Is.Number,
		promos: Is.Array(promoValidator),
	});
}

function getApplicablePromo(promos: Promo[], state: number | undefined, location?: PromoLocation): Promo | undefined {
	if (state == null) return undefined;

	for (const promo of promos) {
		if (isPromoApplicable(promo, state)) {
			if (location == null || promo.locations == null || promo.locations.includes(location)) {
				return promo;
			}
			break;
		}
	}

	return undefined;
}

function isPromoApplicable(promo: Promo, state: number): boolean {
	const now = Date.now();

	return (
		(promo.states == null || promo.states.includes(state)) &&
		(promo.expiresOn == null || promo.expiresOn > now) &&
		(promo.startsOn == null || promo.startsOn < now) &&
		(promo.percentile == null || deviceCohortGroup <= promo.percentile)
	);
}

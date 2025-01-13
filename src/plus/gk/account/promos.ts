import fetch from 'node-fetch';
import type { PromoKeys } from '../../../constants.subscription';
import { SubscriptionState } from '../../../constants.subscription';
import { wait } from '../../../system/promise';
import { pickApplicablePromo } from './promosTools';

export type PromoLocation = 'account' | 'badge' | 'gate' | 'home';

export interface Promo {
	readonly key: PromoKeys;
	readonly code?: string;
	readonly states?: SubscriptionState[];
	readonly expiresOn?: number;
	readonly startsOn?: number;

	readonly command?: {
		command?: `command:${string}`;
		tooltip: string;
	};
	readonly locations?: PromoLocation[];
	readonly quickpick: { detail: string };
}

function isValidDate(d: Date) {
	// @ts-expect-error isNaN expects number, but works with Date instance
	return d instanceof Date && !isNaN(d);
}

type Modify<T, R> = Omit<T, keyof R> & R;
type SerializedPromo = Modify<
	Promo,
	{
		startsOn?: string;
		expiresOn?: string;
		states?: string[];
	}
>;

function deserializePromo(input: object): Promo[] {
	try {
		const object = input as Array<SerializedPromo>;
		const validPromos: Array<Promo> = [];
		if (typeof object !== 'object' || !Array.isArray(object)) {
			throw new Error('deserializePromo: input is not array');
		}
		const allowedPromoKeys: Record<PromoKeys, boolean> = { gkholiday: true, pro50: true };
		for (const promoItem of object) {
			let states: SubscriptionState[] | undefined = undefined;
			let locations: PromoLocation[] | undefined = undefined;
			if (!promoItem.key || !allowedPromoKeys[promoItem.key]) {
				console.warn('deserializePromo: promo item with no id detected and skipped');
				continue;
			}
			if (!promoItem.quickpick?.detail) {
				console.warn(
					`deserializePromo: no detail provided for promo with key ${promoItem.key} detected and skipped`,
				);
				continue;
			}
			if (promoItem.states && !Array.isArray(promoItem.states)) {
				console.warn(
					`deserializePromo: promo with key ${promoItem.key} is skipped because of incorrect states value`,
				);
				continue;
			}
			if (promoItem.states) {
				states = [];
				for (const state of promoItem.states) {
					// @ts-expect-error unsafe work with enum object
					if (Object.hasOwn(SubscriptionState, state)) {
						// @ts-expect-error unsafe work with enum object
						states.push(SubscriptionState[state]);
					} else {
						console.warn(
							`deserializePromo: invalid state value "${state}" detected and skipped at promo with key ${promoItem.key}`,
						);
					}
				}
			}
			if (promoItem.locations && !Array.isArray(promoItem.locations)) {
				console.warn(
					`deserializePromo: promo with key ${promoItem.key} is skipped because of incorrect locations value`,
				);
				continue;
			}
			if (promoItem.locations) {
				locations = [];
				const allowedLocations: Record<PromoLocation, true> = {
					account: true,
					badge: true,
					gate: true,
					home: true,
				};
				for (const location of promoItem.locations) {
					if (allowedLocations[location]) {
						locations.push(location);
					} else {
						console.warn(
							`deserializePromo: invalid location value "${location}" detected and skipped at promo with key ${promoItem.key}`,
						);
					}
				}
			}
			if (promoItem.code && typeof promoItem.code !== 'string') {
				console.warn(
					`deserializePromo: promo with key ${promoItem.key} is skipped because of incorrect code value`,
				);
				continue;
			}
			if (
				promoItem.command &&
				(typeof promoItem.command.tooltip !== 'string' ||
					(promoItem.command.command && typeof promoItem.command.command !== 'string'))
			) {
				console.warn(
					`deserializePromo: promo with key ${promoItem.key} is skipped because of incorrect code value`,
				);
				continue;
			}
			if (
				promoItem.expiresOn &&
				(typeof promoItem.expiresOn !== 'string' || !isValidDate(new Date(promoItem.expiresOn)))
			) {
				console.warn(
					`deserializePromo: promo with key ${promoItem.key} is skipped because of incorrect expiresOn value: ISO date string is expected`,
				);
				continue;
			}
			if (
				promoItem.startsOn &&
				(typeof promoItem.startsOn !== 'string' || !isValidDate(new Date(promoItem.startsOn)))
			) {
				console.warn(
					`deserializePromo: promo with key ${promoItem.key} is skipped because of incorrect startsOn value: ISO date string is expected`,
				);
				continue;
			}
			validPromos.push({
				...promoItem,
				expiresOn: promoItem.expiresOn ? new Date(promoItem.expiresOn).getTime() : undefined,
				startsOn: promoItem.startsOn ? new Date(promoItem.startsOn).getTime() : undefined,
				states: states,
				locations: locations,
			});
		}
		return validPromos;
	} catch (e) {
		throw new Error(`deserializePromo: Could not deserialize promo: ${e.message ?? e}`);
	}
}

export class PromoProvider {
	private _isInitialized: boolean = false;
	private _initPromise: Promise<void> | undefined;
	private _promo: Array<Promo> | undefined;
	constructor() {
		void this.waitForFirstRefreshInitialized();
	}

	private async waitForFirstRefreshInitialized() {
		if (this._isInitialized) {
			return;
		}
		if (!this._initPromise) {
			this._initPromise = this.initialize().then(() => {
				this._isInitialized = true;
			});
		}
		await this._initPromise;
	}

	async initialize() {
		await wait(1000);
		if (this._isInitialized) {
			return;
		}
		try {
			console.log('PromoProvider GL_PROMO_URI', GL_PROMO_URI);
			if (!GL_PROMO_URI) {
				throw new Error('No GL_PROMO_URI env variable provided');
			}
			const jsonBody = JSON.parse(await fetch(GL_PROMO_URI).then(x => x.text()));
			this._promo = deserializePromo(jsonBody);
		} catch (e) {
			console.error('PromoProvider error', e);
		}
	}

	async getPromoList() {
		try {
			await this.waitForFirstRefreshInitialized();
			return this._promo!;
		} catch {
			return undefined;
		}
	}

	async getApplicablePromo(state: number | undefined, location?: PromoLocation, key?: PromoKeys) {
		try {
			await this.waitForFirstRefreshInitialized();
			return pickApplicablePromo(this._promo, state, location, key);
		} catch {
			return undefined;
		}
	}
}

export const promoProvider = new PromoProvider();

export const getApplicablePromo = promoProvider.getApplicablePromo.bind(promoProvider);

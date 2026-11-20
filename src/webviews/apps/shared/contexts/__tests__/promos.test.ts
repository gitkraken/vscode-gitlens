import * as assert from 'node:assert';
import type { MessagePort } from 'node:worker_threads';
import { MessageChannel } from 'node:worker_threads';
import type { Endpoint } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import { defaultPlansContent } from '../../../../../plus/gk/models/plans.js';
import type { Promo } from '../../../../../plus/gk/models/promo.js';
import type { ApplicablePromoParams } from '../../../../rpc/promosService.js';
import { PromosContext } from '../promos.js';

function asEndpoint(port: MessagePort): Endpoint {
	return port as unknown as Endpoint;
}

const graphPromo: Promo = { key: 'test', plan: 'pro', locations: ['graph'] };

function createFakeHost(promo: Promo | undefined) {
	const requests: ApplicablePromoParams[] = [];
	const state = { promo: promo };

	const services = {
		promos: {
			getApplicablePromo: (params: ApplicablePromoParams) => {
				requests.push(params);
				return Promise.resolve({ promo: state.promo });
			},
			getPlans: () => Promise.resolve(defaultPlansContent),
		},
		subscription: {
			onSubscriptionChanged: (_handler: unknown) => Promise.resolve(() => {}),
		},
	};

	return { services: services, requests: requests, state: state };
}

function createConnectionPair(): { host: Connection; client: Connection; close: () => void } {
	const { port1, port2 } = new MessageChannel();
	const host = new Connection(asEndpoint(port1), { nestedProxies: true });
	const client = new Connection(asEndpoint(port2), { nestedProxies: true });

	return {
		host: host,
		client: client,
		close: () => {
			host.close();
			client.close();
			port1.close();
			port2.close();
		},
	};
}

const tick = (ms = 25) => new Promise<void>(resolve => setTimeout(resolve, ms));

suite('PromosContext Test Suite', () => {
	test('a promo requested before connect() resolves once the connection is ready', async () => {
		const { services, requests } = createFakeHost(graphPromo);
		const { host, client, close } = createConnectionPair();

		const promos = new PromosContext();
		const requested = promos.getApplicablePromo(undefined, 'graph', true);

		promos.connect(client);
		host.expose(services);
		void client.waitForReady();

		const promo = await requested;
		assert.deepStrictEqual(promo, graphPromo);
		assert.strictEqual(requests.length, 1);
		assert.deepStrictEqual(await promos.getApplicablePromo(undefined, 'graph', true), graphPromo);
		assert.strictEqual(requests.length, 1, 'the answer is cached');

		promos.dispose();
		close();
	});

	test('a promo requested before connect() resolves when the connection was already ready', async () => {
		const { services, requests } = createFakeHost(graphPromo);
		const { host, client, close } = createConnectionPair();
		host.expose(services);

		const promos = new PromosContext();
		const requested = promos.getApplicablePromo(undefined, 'graph', true);

		await client.waitForReady();
		promos.connect(client);

		assert.deepStrictEqual(await requested, graphPromo);
		assert.strictEqual(requests.length, 1);

		promos.dispose();
		close();
	});

	test('a promo requested before connect() survives a switch to another connection', async () => {
		const { services, requests } = createFakeHost(graphPromo);
		const first = createConnectionPair();
		const second = createConnectionPair();

		const promos = new PromosContext();
		promos.connect(first.client);
		const requested = promos.getApplicablePromo(undefined, 'graph', true);

		promos.connect(second.client);
		second.host.expose(services);
		void second.client.waitForReady();

		assert.deepStrictEqual(await requested, graphPromo);
		assert.strictEqual(requests.length, 1);

		promos.dispose();
		first.close();
		second.close();
	});

	test('a promo requested after connect() is fetched immediately', async () => {
		const { services, requests } = createFakeHost(graphPromo);
		const { host, client, close } = createConnectionPair();
		host.expose(services);

		const promos = new PromosContext();
		promos.connect(client);
		void client.waitForReady();
		await tick();

		assert.deepStrictEqual(await promos.getApplicablePromo(undefined, 'graph', true), graphPromo);
		assert.strictEqual(requests.length, 1);

		promos.dispose();
		close();
	});

	test('dispose() settles a promo request that never got a connection', async () => {
		const promos = new PromosContext();
		const requested = promos.getApplicablePromo(undefined, 'graph', true);

		promos.dispose();

		assert.strictEqual(await requested, undefined);
	});
});

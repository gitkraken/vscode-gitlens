import * as assert from 'assert';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { SubscriptionState } from '../../../constants.subscription.js';
import type { Container } from '../../../container.js';
import { RequestsAreBlockedTemporarilyError } from '../../../errors.js';
import type { Subscription } from '../models/subscription.js';
import type { ServerConnection } from '../serverConnection.js';
import type { TrialResetHost } from '../trialAutoReset.js';
import { autoResetTrialIfEligible, clearTrialResetSessionAttempts } from '../trialAutoReset.js';

suite('Trial Auto Reset Test Suite', () => {
	suite('autoResetTrialIfEligible', () => {
		setup(() => clearTrialResetSessionAttempts());

		function fakeSubscription(accountId: string, state: SubscriptionState, planId = 'community-with-account') {
			return {
				account: { id: accountId, name: 'Test', email: 'test@test', verified: true },
				plan: { actual: { id: planId }, effective: { id: planId } },
				state: state,
			} as unknown as Subscription;
		}

		type Call = { path: string; method: string | undefined };

		function createWorld(options: {
			subscription: Subscription;
			responses?: Record<string, { status: number; body?: unknown } | Error>;
			session?: null;
			/** Simulates an account switch between the subscription read and the session resolve */
			sessionAccountId?: string;
			/** What the subscription becomes after `refreshSubscription` */
			refreshedSubscription?: Subscription;
		}) {
			const world = {
				subscription: options.subscription,
				calls: [] as Call[],
				events: [] as unknown[],
				log: [] as string[],
				stored: new Map<string, unknown>(),
			};

			const container = {
				storage: {
					get: (key: string, defaultValue?: unknown) => world.stored.get(key) ?? defaultValue,
					store: (key: string, value: unknown) => {
						world.stored.set(key, value);
						world.log.push('store');
						return Promise.resolve();
					},
				},
				telemetry: {
					enabled: true,
					sendEvent: (_name: string, data: unknown) => world.events.push(data),
				},
			} as unknown as Container;

			const connection = {
				fetchGkApi: (path: string, init?: { method?: string }) => {
					world.calls.push({ path: path, method: init?.method });
					world.log.push(`fetch:${path}`);
					const rsp = options.responses?.[path];
					if (rsp == null) throw new Error(`Unexpected request: ${path}`);
					if (rsp instanceof Error) throw rsp;
					return Promise.resolve({
						ok: rsp.status >= 200 && rsp.status < 300,
						status: rsp.status,
						statusText: String(rsp.status),
						json: () => Promise.resolve(rsp.body ?? {}),
					} as Response);
				},
			} as unknown as ServerConnection;

			const host: TrialResetHost = {
				getSubscription: () => Promise.resolve(world.subscription),
				ensureSession: () =>
					options.session === null
						? Promise.resolve(undefined)
						: Promise.resolve({
								account: { id: options.sessionAccountId ?? options.subscription.account?.id },
							} as never),
				refreshSubscription: () => {
					world.log.push('refresh');
					if (options.refreshedSubscription != null) {
						world.subscription = options.refreshedSubscription;
					}
					return Promise.resolve();
				},
				notifyReset: () => {
					world.log.push('notify');
				},
			};

			return {
				world: world,
				run: () => autoResetTrialIfEligible(container, connection, host, { source: 'graph' }),
			};
		}

		const eligible = { status: 200, body: { canResetTrial: true } };
		const notEligible = { status: 200, body: { canResetTrial: false } };

		test('skips everything when the account already settled its attempt', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('settled-1', SubscriptionState.TrialExpired),
			});
			world.stored.set('plus:trialReset:settled-1:attempted', true);

			await run();
			assert.deepStrictEqual(world.calls, []);
			assert.deepStrictEqual(world.events, []);
		});

		test('settles paid accounts without any requests', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('paid-1', SubscriptionState.Paid, 'pro'),
			});

			await run();
			assert.deepStrictEqual(world.calls, []);
			assert.deepStrictEqual(world.events, []);
			assert.strictEqual(world.stored.get('plus:trialReset:paid-1:attempted'), true);
		});

		test('waits out an active trial, then resets once it lapses', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('waiter-1', SubscriptionState.Trial),
				responses: {
					'user/trial-eligibility': eligible,
					'user/reactivate-trial': { status: 200 },
				},
			});

			// Active trial: no requests, nothing settled — the attempt stays open
			await run();
			assert.strictEqual(world.calls.length, 0);
			assert.strictEqual(world.stored.size, 0);

			// Trial lapsed: eligibility → reset → settle BEFORE the refresh (a failed check-in must not
			// leave the attempt open after a successful server-side reset)
			world.subscription = fakeSubscription('waiter-1', SubscriptionState.TrialExpired);
			await run();
			assert.deepStrictEqual(
				world.calls.map(c => c.path),
				['user/trial-eligibility', 'user/reactivate-trial'],
			);
			assert.strictEqual(world.stored.get('plus:trialReset:waiter-1:attempted'), true);
			assert.ok(world.log.indexOf('store') < world.log.indexOf('refresh'));
			assert.deepStrictEqual(world.events, [{ action: 'auto-reset-trial', outcome: 'reset' }]);
		});

		test('notifies the user once the refreshed subscription shows the new trial', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('toast-1', SubscriptionState.TrialExpired),
				refreshedSubscription: fakeSubscription('toast-1', SubscriptionState.Trial),
				responses: {
					'user/trial-eligibility': eligible,
					'user/reactivate-trial': { status: 200 },
				},
			});

			await run();
			assert.ok(world.log.includes('notify'));
		});

		test('skips the notification when the post-reset refresh does not land, but still settles', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('toast-2', SubscriptionState.TrialExpired),
				responses: {
					'user/trial-eligibility': eligible,
					'user/reactivate-trial': { status: 200 },
				},
			});

			await run();
			assert.ok(!world.log.includes('notify'));
			assert.strictEqual(world.stored.get('plus:trialReset:toast-2:attempted'), true);
			assert.deepStrictEqual(world.events, [{ action: 'auto-reset-trial', outcome: 'reset' }]);
		});

		test('settles when the server says the account may not reset', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('declined-1', SubscriptionState.TrialExpired),
				responses: { 'user/trial-eligibility': notEligible },
			});

			await run();
			assert.strictEqual(world.stored.get('plus:trialReset:declined-1:attempted'), true);
			assert.deepStrictEqual(world.events, [{ action: 'auto-reset-trial', outcome: 'not-eligible' }]);
		});

		test('settles a 409 refusal without refreshing the subscription', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('refused-1', SubscriptionState.TrialExpired),
				responses: {
					'user/trial-eligibility': eligible,
					'user/reactivate-trial': { status: 409 },
				},
			});

			await run();
			assert.strictEqual(world.stored.get('plus:trialReset:refused-1:attempted'), true);
			assert.ok(!world.log.includes('refresh'));
			assert.deepStrictEqual(world.events, [{ action: 'auto-reset-trial', outcome: 'refused' }]);
		});

		test('does not settle when the reset itself fails with a server error', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('reset-500', SubscriptionState.TrialExpired),
				responses: {
					'user/trial-eligibility': eligible,
					'user/reactivate-trial': { status: 500 },
				},
			});

			await run();
			assert.strictEqual(world.stored.size, 0);
			assert.deepStrictEqual(world.events, [{ action: 'auto-reset-trial', outcome: 'failed' }]);
		});

		test('does not settle on a server error and backs off before retrying', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('flaky-1', SubscriptionState.TrialExpired),
				responses: { 'user/trial-eligibility': { status: 500 } },
			});

			await run();
			assert.strictEqual(world.stored.size, 0);
			assert.deepStrictEqual(world.events, [{ action: 'auto-reset-trial', outcome: 'failed' }]);

			// Within the cooldown the guard stops repeated requests (every state rebuild calls this,
			// and 5 failed GK requests trip the global request blocker)
			await run();
			assert.strictEqual(world.calls.length, 1);
			assert.strictEqual(world.events.length, 1);
		});

		test('refreshes instead of settling when the server sees a trial the client does not', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('stale-1', SubscriptionState.TrialExpired),
				responses: {
					'user/trial-eligibility': {
						status: 200,
						body: {
							canResetTrial: false,
							trialEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
						},
					},
				},
			});

			await run();
			assert.ok(world.log.includes('refresh'));
			assert.strictEqual(world.stored.size, 0);
			assert.deepStrictEqual(world.events, []);
		});

		test('fails open on an unrecognized eligibility payload instead of settling', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('reshaped-1', SubscriptionState.TrialExpired),
				responses: { 'user/trial-eligibility': { status: 200, body: { data: { canResetTrial: false } } } },
			});

			await run();
			assert.strictEqual(world.stored.size, 0);
			assert.deepStrictEqual(world.events, [{ action: 'auto-reset-trial', outcome: 'failed-shape' }]);
		});

		test('fails open on an unparseable trialEnd instead of settling', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('reshaped-2', SubscriptionState.TrialExpired),
				responses: {
					'user/trial-eligibility': { status: 200, body: { canResetTrial: false, trialEnd: 'whenever' } },
				},
			});

			await run();
			assert.strictEqual(world.stored.size, 0);
			assert.deepStrictEqual(world.events, [{ action: 'auto-reset-trial', outcome: 'failed-shape' }]);
		});

		test('skips unverified accounts without requests or settling', async () => {
			const subscription = fakeSubscription('unverified-1', SubscriptionState.TrialExpired);
			(subscription.account as { verified: boolean }).verified = false;
			const { world, run } = createWorld({ subscription: subscription });

			await run();
			assert.strictEqual(world.calls.length, 0);
			assert.strictEqual(world.stored.size, 0);
			assert.deepStrictEqual(world.events, []);
		});

		test('bails when the session belongs to another account', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('switched-from', SubscriptionState.TrialExpired),
				sessionAccountId: 'switched-to',
				responses: {
					'user/trial-eligibility': eligible,
					'user/reactivate-trial': { status: 200 },
				},
			});

			await run();
			assert.strictEqual(world.calls.length, 0);
			assert.strictEqual(world.stored.size, 0);
			assert.deepStrictEqual(world.events, []);
		});

		test('stays quiet when no session is available', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('signed-out-1', SubscriptionState.TrialExpired),
				session: null,
			});

			await run();
			assert.strictEqual(world.calls.length, 0);
			assert.strictEqual(world.stored.size, 0);
			assert.deepStrictEqual(world.events, []);
		});

		test('stays quiet when GK requests are blocked', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('blocked-1', SubscriptionState.TrialExpired),
				responses: { 'user/trial-eligibility': new RequestsAreBlockedTemporarilyError() },
			});

			await run();
			assert.strictEqual(world.stored.size, 0);
			assert.deepStrictEqual(world.events, []);
		});

		test('stays quiet when the eligibility request times out', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('cancelled-1', SubscriptionState.TrialExpired),
				responses: { 'user/trial-eligibility': new CancellationError(new Error('timeout')) },
			});

			await run();
			assert.strictEqual(world.stored.size, 0);
			assert.deepStrictEqual(world.events, []);
		});

		test('keeps each account on its own attempt budget', async () => {
			const failing = { 'user/trial-eligibility': { status: 500 } };
			const a = createWorld({
				subscription: fakeSubscription('acct-a', SubscriptionState.TrialExpired),
				responses: failing,
			});
			await a.run();
			assert.strictEqual(a.world.calls.length, 1);

			// Within A's cooldown, B must still get its own check
			const b = createWorld({
				subscription: fakeSubscription('acct-b', SubscriptionState.TrialExpired),
				responses: failing,
			});
			await b.run();
			assert.strictEqual(b.world.calls.length, 1);
		});

		test('stays quiet when the reset request itself is blocked', async () => {
			const { world, run } = createWorld({
				subscription: fakeSubscription('blocked-2', SubscriptionState.TrialExpired),
				responses: {
					'user/trial-eligibility': eligible,
					'user/reactivate-trial': new RequestsAreBlockedTemporarilyError(),
				},
			});

			await run();
			assert.strictEqual(world.stored.size, 0);
			assert.deepStrictEqual(world.events, []);
		});
	});
});

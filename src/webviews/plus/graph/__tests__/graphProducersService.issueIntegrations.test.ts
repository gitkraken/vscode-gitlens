import * as assert from 'assert';
import { IssuesSelfManagedHostIntegrationId } from '@gitlens/integrations/constants.js';
// Side-effect only: see the note in `graphProducersService.upstreamMetadata.test.ts` — loading
// container.ts first avoids the module-ordering landmine its dependency chain otherwise trips.
import '../../../../container.js';
import { GraphProducersService } from '../graphProducersService.js';

/**
 * `checkIssueIntegrations` decides whether the Graph enriches rows with issues at all, and it asks ONE
 * question per provider id. That is wrong for a self-managed tracker: `jira-server` is one id spanning a
 * connection per configured host, and a domainless `get()` resolves whichever instance was cached first — so
 * disconnecting that one reported "no issue integration" and silently turned off enrichment while another
 * host was still connected (#5864).
 *
 * Same call-through-the-prototype approach as the sibling suites, for the same reason: a real instance needs
 * a live `Container`. Only `container.integrations` and the connection-state field are consulted here.
 */

type FakeConnection = { domain: string | undefined; connected: boolean };

type FakeThis = {
	_issueIntegrationConnectionState: 'connected' | 'not-connected' | 'not-checked';
};

function createFakeThis(connections: FakeConnection[]): FakeThis {
	const fakeThis = Object.create(GraphProducersService.prototype) as FakeThis;

	Object.defineProperty(fakeThis, 'container', {
		configurable: true,
		value: {
			integrations: {
				getConfigured: (id: string) =>
					id === IssuesSelfManagedHostIntegrationId.JiraServer
						? connections.map(c => ({ domain: c.domain }))
						: [],
				// Every cloud tracker is absent, so only the Jira Server expansion decides the outcome.
				get: (id: string, domain?: string) => {
					if (id !== IssuesSelfManagedHostIntegrationId.JiraServer) return Promise.resolve(undefined);

					const connection = connections.find(c => c.domain === domain);
					return Promise.resolve(connection != null ? { maybeConnected: connection.connected } : undefined);
				},
			},
		},
	});

	fakeThis._issueIntegrationConnectionState = 'not-checked';
	return fakeThis;
}

function invoke(fakeThis: FakeThis): Promise<boolean> {
	const fn = (GraphProducersService.prototype as unknown as { checkIssueIntegrations: () => Promise<boolean> })
		.checkIssueIntegrations;
	return fn.call(fakeThis);
}

suite('GraphProducersService.checkIssueIntegrations — multi-host trackers Test Suite', () => {
	test('stays connected when a later configured host is connected and the first is not', async () => {
		// The regression: host A resolves first, so asking the id once answered "not connected" and disabled
		// issue enrichment even though host B was live.
		const fakeThis = createFakeThis([
			{ domain: 'jira-a.example.com', connected: false },
			{ domain: 'jira-b.example.com', connected: true },
		]);

		assert.strictEqual(await invoke(fakeThis), true);
		assert.strictEqual(fakeThis._issueIntegrationConnectionState, 'connected');
	});

	test('stays connected when the first configured host is the connected one', async () => {
		const fakeThis = createFakeThis([
			{ domain: 'jira-a.example.com', connected: true },
			{ domain: 'jira-b.example.com', connected: false },
		]);

		assert.strictEqual(await invoke(fakeThis), true);
	});

	test('reports not-connected only when every configured host is disconnected', async () => {
		const fakeThis = createFakeThis([
			{ domain: 'jira-a.example.com', connected: false },
			{ domain: 'jira-b.example.com', connected: false },
		]);

		assert.strictEqual(await invoke(fakeThis), false);
		assert.strictEqual(fakeThis._issueIntegrationConnectionState, 'not-connected');
	});

	test('reports not-connected when the tracker has no configured host at all', async () => {
		const fakeThis = createFakeThis([]);

		assert.strictEqual(await invoke(fakeThis), false);
	});
});

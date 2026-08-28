import * as assert from 'node:assert';
import { agentCapabilities } from '@gitlens/agents/agentCapabilities.js';
import { getAgentProviderIcon } from '../agentIcon.js';

suite('getAgentProviderIcon', () => {
	test('marks every agent the capability table describes, in either id namespace', () => {
		for (const capabilities of agentCapabilities) {
			assert.strictEqual(
				getAgentProviderIcon(capabilities.providerId),
				capabilities.icon,
				capabilities.providerId,
			);
			assert.strictEqual(
				getAgentProviderIcon(capabilities.hookClientId),
				capabilities.icon,
				capabilities.hookClientId,
			);
		}
	});

	test('falls back to robot for a provider id with no descriptor', () => {
		assert.strictEqual(getAgentProviderIcon('cursor'), 'robot');
	});

	test('falls back to robot for undefined', () => {
		assert.strictEqual(getAgentProviderIcon(undefined), 'robot');
	});

	test('falls back to robot for an empty string', () => {
		assert.strictEqual(getAgentProviderIcon(''), 'robot');
	});
});

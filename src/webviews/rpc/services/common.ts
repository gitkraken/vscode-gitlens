/**
 * Common webview services — convenience type and factory.
 *
 * Webviews that use all common services can extend `CommonWebviewServices` and
 * call `createCommonServices()`. Complex webviews that override most
 * sub-services should import individual classes directly instead.
 */

import { proxy } from '@eamodio/supertalk';
import type { Container } from '../../../container.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { WebviewAIService } from './ai.js';
import { WebviewCommandsService } from './commands.js';
import { WebviewConfigService } from './config.js';
import { WebviewGitService } from './git.js';
import { WebviewIntegrationsService } from './integrations.js';
import { WebviewStorageService } from './storage.js';
import { WebviewSubscriptionService } from './subscription.js';
import { WebviewTelemetryService } from './telemetry.js';
import type { RpcServiceHost } from './types.js';

// ============================================================
// Convenience Type
// ============================================================

/**
 * Common webview services interface.
 *
 * This is a convenience type for webviews that use all common services.
 * Complex webviews should define their own services type, importing only
 * the sub-service classes they need.
 */
export interface CommonWebviewServices {
	readonly git: WebviewGitService;
	readonly config: WebviewConfigService;
	readonly storage: WebviewStorageService;
	readonly subscription: WebviewSubscriptionService;
	readonly integrations: WebviewIntegrationsService;
	readonly ai: WebviewAIService;
	readonly commands: WebviewCommandsService;
	readonly telemetry: WebviewTelemetryService;
}

// ============================================================
// Convenience Factory
// ============================================================

/**
 * Create all common webview services from Container.
 *
 * Use this for simple webviews that need all common services without overrides.
 * Complex webviews should instantiate individual service classes directly.
 *
 * @param container - The GitLens Container
 * @param host - The webview host
 * @param updateTelemetryContext - Callback to update the provider's telemetry context
 * @param buffer - Optional event visibility buffer
 * @returns CommonWebviewServices ready to be exposed via RPC
 */
export function createCommonServices(
	container: Container,
	host: RpcServiceHost,
	updateTelemetryContext: (context: Record<string, string | number | boolean | undefined>) => void,
	buffer?: EventVisibilityBuffer,
	tracker?: SubscriptionTracker,
): CommonWebviewServices {
	return {
		git: new WebviewGitService(container, buffer, tracker),
		config: new WebviewConfigService(buffer, tracker),
		storage: new WebviewStorageService(container),
		subscription: new WebviewSubscriptionService(container, buffer, tracker),
		integrations: new WebviewIntegrationsService(container, buffer, tracker),
		ai: new WebviewAIService(container, buffer, tracker),
		commands: new WebviewCommandsService(container, host),
		telemetry: new WebviewTelemetryService(host, updateTelemetryContext),
	};
}

/**
 * Wraps all object-valued properties with Supertalk's `proxy()` marker.
 *
 * Call this on the final services object returned from `getRpcServices()`.
 * Sub-service objects and class instances become remote proxies;
 * functions and primitives pass through unchanged.
 */
export function proxyServices<T extends Record<string, unknown>>(services: T): T {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(services)) {
		result[key] = value != null && typeof value === 'object' ? proxy(value) : value;
	}
	return result as T;
}

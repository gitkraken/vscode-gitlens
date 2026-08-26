/**
 * Shared webview services — convenience type and factory.
 *
 * Webviews that use all shared services can extend `SharedWebviewServices` and
 * call `createSharedServices()`. Complex webviews that override most
 * sub-services should import individual classes directly instead.
 *
 */

import type { Container } from '../../../container.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { PromosService } from '../promosService.js';
import type { ApplicablePromoService } from '../promosService.js';
import type { WebviewViewServiceHost } from '../webviewViewService.js';
import { WebviewViewService } from '../webviewViewService.js';
import { AgentsService } from './agents.js';
import { AIService } from './ai.js';
import { AutolinksService } from './autolinks.js';
import { BranchesService } from './branches.js';
import { CommandsService } from './commands.js';
import { ConfigService } from './config.js';
import { DraftsService } from './drafts.js';
import { FilesService } from './files.js';
import { IntegrationsService } from './integrations.js';
import { OnboardingRpcService } from './onboarding.js';
import { PullRequestsService } from './pullRequests.js';
import { RepositoriesService } from './repositories.js';
import { RepositoryService } from './repository.js';
import { StorageService } from './storage.js';
import { SubscriptionService } from './subscription.js';
import { TelemetryService } from './telemetry.js';
import type { RpcServiceHost } from './types.js';

// ============================================================
// Convenience Type
// ============================================================

/**
 * Shared webview services interface.
 *
 * This is a convenience type for webviews that use all shared services.
 * Complex webviews should define their own services type, importing only
 * the sub-service classes they need.
 */
export interface SharedWebviewServices {
	readonly repositories: RepositoriesService;
	readonly repository: RepositoryService;
	readonly config: ConfigService;
	readonly storage: StorageService;
	readonly subscription: SubscriptionService;
	readonly promos: ApplicablePromoService;
	readonly integrations: IntegrationsService;
	readonly onboarding: OnboardingRpcService;
	readonly agents: AgentsService;
	readonly ai: AIService;
	readonly autolinks: AutolinksService;
	readonly branches: BranchesService;
	readonly commands: CommandsService;
	readonly telemetry: TelemetryService;
	readonly files: FilesService;
	readonly pullRequests: PullRequestsService;
	readonly drafts: DraftsService;
	readonly webview: WebviewViewService;
}

// ============================================================
// Convenience Factory
// ============================================================

/**
 * Create all shared webview services from Container.
 *
 * Use this for simple webviews that need all shared services without overrides.
 * Complex webviews should instantiate individual service classes directly.
 *
 * @param container - The GitLens Container
 * @param host - The webview host
 * @param buffer - Optional event visibility buffer
 * @param updateTelemetryContext - Callback to update the provider's telemetry context; defaults to a
 * no-op for providers that don't track one
 * @returns SharedWebviewServices ready to be exposed via RPC
 */
export function createSharedServices(
	container: Container,
	host: RpcServiceHost & WebviewViewServiceHost,
	buffer?: EventVisibilityBuffer,
	tracker?: SubscriptionTracker,
	updateTelemetryContext: (context: Record<string, string | number | boolean | undefined>) => void = () => {},
): SharedWebviewServices {
	return {
		repositories: new RepositoriesService(container, buffer, tracker),
		repository: new RepositoryService(container, buffer, tracker),
		config: new ConfigService(buffer, tracker),
		storage: new StorageService(container),
		subscription: new SubscriptionService(container, buffer, tracker),
		promos: new PromosService(container),
		integrations: new IntegrationsService(container, buffer, tracker),
		onboarding: new OnboardingRpcService(container, buffer, tracker),
		agents: new AgentsService(container, buffer, tracker),
		ai: new AIService(container, buffer, tracker),
		autolinks: new AutolinksService(container),
		branches: new BranchesService(container),
		commands: new CommandsService(container, host),
		telemetry: new TelemetryService(host, updateTelemetryContext, container.usage, buffer, tracker),
		files: new FilesService(container),
		pullRequests: new PullRequestsService(container),
		drafts: new DraftsService(container, host),
		webview: new WebviewViewService(host, buffer, tracker),
	};
}

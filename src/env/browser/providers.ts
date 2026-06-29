import type { Cache } from '@gitlens/git/cache.js';
import type { GitProvider } from '@gitlens/git/providers/provider.js';
import type { GitResult, GitRunOptions } from '@gitlens/git/run.types.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { AgentSessionProvider } from '../../agents/provider.js';
import type { Container } from '../../container.js';
// Force import of GitHub since dynamic imports are not supported in the WebWorker ExtensionHost
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GlGitProvider } from '../../git/gitProvider.js';
import type { RepositoryLocationProvider } from '../../git/location/repositorylocationProvider.js';
import { GlGitHubGitProvider } from '../../plus/integrations/host/providers/githubGitProvider.js';
import type { SharedGkStorageLocationProvider } from '../../plus/repos/sharedGkStorageLocationProvider.js';
import type { GkWorkspacesSharedStorageProvider } from '../../plus/workspaces/workspacesSharedStorageProvider.js';
import type { TelemetryService } from '../../telemetry/telemetry.js';

export function git(
	_container: Container,
	_options: GitRunOptions,
	..._args: any[]
): Promise<GitResult<string | Buffer>> {
	return Promise.resolve({ stdout: '', exitCode: 0 });
}

export function getSupportedGitProviders(
	container: Container,
	cache: Cache,
	register: (provider: GitProvider, canHandle: (repoPath: string) => boolean) => UnifiedDisposable,
): Promise<GlGitProvider[]> {
	return Promise.resolve([new GlGitHubGitProvider(container, cache, register)]);
}

export function getSharedGKStorageLocationProvider(_container: Container): SharedGkStorageLocationProvider | undefined {
	return undefined;
}

export function getSupportedRepositoryLocationProvider(
	_container: Container,
	_sharedStorage: SharedGkStorageLocationProvider | undefined,
): RepositoryLocationProvider | undefined {
	return undefined;
}

export function getSupportedWorkspacesStorageProvider(
	_container: Container,
	_sharedStorage: SharedGkStorageLocationProvider | undefined,
): GkWorkspacesSharedStorageProvider | undefined {
	return undefined;
}

// Type stubs so cross-env consumers (e.g. `container.ts`, shared webview code) can reference the
// Node-only services in type positions without the browser bundle pulling in Node modules — neither is
// constructed in browser builds (the getters below return undefined). `GkCliService` is never
// property-accessed by shared code, so a bare `never` suffices. `GkMcpService` re-exports the
// `GkMcpRegistrar` interface (which the real Node service `implements`), letting shared code read
// `container.gkMcp?.isRegistration*` in both builds while TS keeps the stub from drifting from the service.
export type GkCliService = never;
export type { GkMcpRegistrar as GkMcpService } from '../../plus/gk/utils/-webview/mcp.utils.js';

export function getGkCliService(_container: Container): undefined {
	return undefined;
}

export function getGkMcpService(_container: Container, _gkCli: GkCliService): undefined {
	return undefined;
}

export function getAgentSessionProviders(_container: Container): AgentSessionProvider[] {
	return [];
}

let _telemetryService: TelemetryService | undefined;
export function getTelementryService(): TelemetryService | undefined {
	return _telemetryService;
}

export function setTelemetryService(service: TelemetryService): void {
	_telemetryService = service;
}

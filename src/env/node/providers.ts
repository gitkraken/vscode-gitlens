import type { Disposable, McpServerDefinitionProvider } from 'vscode';
import type { Container } from '../../container.js';
import type { GitExecOptions, GitResult } from '../../git/execTypes.js';
import type { GitProvider } from '../../git/gitProvider.js';
import type { RepositoryLocationProvider } from '../../git/location/repositorylocationProvider.js';
import { mcpExtensionRegistrationAllowed } from '../../plus/gk/utils/-webview/mcp.utils.js';
import type { SharedGkStorageLocationProvider } from '../../plus/repos/sharedGkStorageLocationProvider.js';
import type { GkWorkspacesSharedStorageProvider } from '../../plus/workspaces/workspacesSharedStorageProvider.js';
import { configuration } from '../../system/-webview/configuration.js';
// import { GitHubGitProvider } from '../../plus/github/githubGitProvider';
import type { TelemetryService } from '../../telemetry/telemetry.js';
import { Git } from './git/git.js';
import { LocalGitProvider } from './git/localGitProvider.js';
import { VslsGit, VslsGitProvider } from './git/vslsGitProvider.js';
import { GkCliIntegrationProvider } from './gk/cli/integration.js';
import { LocalRepositoryLocationProvider } from './gk/localRepositoryLocationProvider.js';
import { LocalSharedGkStorageLocationProvider } from './gk/localSharedGkStorageLocationProvider.js';
import { LocalGkWorkspacesSharedStorageProvider } from './gk/localWorkspacesSharedStorageProvider.js';

let gitInstance: Git | undefined;
function ensureGit(container: Container) {
	gitInstance ??= new Git(container);
	return gitInstance;
}

export function git(
	container: Container,
	options: GitExecOptions,
	...args: any[]
): Promise<GitResult<string | Buffer>> {
	return ensureGit(container).exec(options, ...args);
}

export async function getSupportedGitProviders(container: Container): Promise<GitProvider[]> {
	const git = ensureGit(container);

	const providers: GitProvider[] = [
		new LocalGitProvider(container, git),
		new VslsGitProvider(container, new VslsGit(container, git)),
	];

	if (configuration.get('virtualRepositories.enabled')) {
		providers.push(
			new (
				await import(
					/* webpackChunkName: "integrations" */ '../../plus/integrations/providers/github/githubGitProvider.js'
				)
			).GitHubGitProvider(container),
		);
	}

	return providers;
}

export function getSharedGKStorageLocationProvider(container: Container): SharedGkStorageLocationProvider {
	return new LocalSharedGkStorageLocationProvider(container);
}

export function getSupportedRepositoryLocationProvider(
	container: Container,
	sharedStorage: SharedGkStorageLocationProvider,
): RepositoryLocationProvider {
	return new LocalRepositoryLocationProvider(container, sharedStorage);
}

export function getSupportedWorkspacesStorageProvider(
	container: Container,
	sharedStorage: SharedGkStorageLocationProvider,
): GkWorkspacesSharedStorageProvider {
	return new LocalGkWorkspacesSharedStorageProvider(container, sharedStorage);
}

export function getGkCliIntegrationProvider(container: Container): GkCliIntegrationProvider {
	return new GkCliIntegrationProvider(container);
}

export async function getMcpProviders(
	container: Container,
): Promise<(McpServerDefinitionProvider & Disposable)[] | undefined> {
	if (!mcpExtensionRegistrationAllowed(container)) return undefined;

	// Older versions of VS Code do not support the classes used in the MCP integration, so we need to dynamically import
	const mcpModule = await import(/* webpackChunkName: "mcp" */ './gk/mcp/integration.js');

	return [new mcpModule.GkMcpProvider(container)];
}

let _telemetryService: TelemetryService | undefined;
export function getTelementryService(): TelemetryService | undefined {
	return _telemetryService;
}

export function setTelemetryService(service: TelemetryService): void {
	_telemetryService = service;
}

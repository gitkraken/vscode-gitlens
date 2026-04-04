import { Uri as VscodeUri, workspace } from 'vscode';
import type { CachedGitTypes } from '@gitlens/git/cache.js';
import type { GitServiceConfig, GitServiceContext } from '@gitlens/git/context.js';
import type { SigningErrorReason } from '@gitlens/git/errors.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { mixinDisposable } from '@gitlens/utils/disposable.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { configuration } from '../system/-webview/configuration.js';
import { buildRemoteProviderConfigs } from './remotes/remoteProviderConfigs.js';
import { getIntegrationRepositoryInfo, sortRemotes } from './utils/-webview/remote.utils.js';

/**
 * Creates a {@link GitServiceContext} — config, hooks, workspace resolution,
 * and integrations.
 *
 * All hooks fire directly to the extension event bus or telemetry service.
 * Providers pass the context through unchanged (no augmentation needed).
 */
export function createGitProviderContext(container: Container): GitServiceContext {
	const config: GitServiceConfig = {
		get commits() {
			return {
				includeFileDetails: !configuration.get('advanced.commits.delayLoadingFileDetails'),
				ordering: configuration.get('advanced.commitOrdering'),
				similarityThreshold: configuration.get('advanced.similarityThreshold'),
				maxItems: configuration.get('advanced.maxListItems'),
			};
		},
		get fileHistory() {
			return {
				showAllBranches: configuration.get('advanced.fileHistoryShowAllBranches'),
				showMergeCommits: configuration.get('advanced.fileHistoryShowMergeCommits'),
				followRenames: configuration.get('advanced.fileHistoryFollowsRenames'),
			};
		},
		get search() {
			return {
				maxItems: configuration.get('advanced.maxSearchItems'),
			};
		},
		get graph() {
			return {
				commitOrdering: configuration.get('graph.commitOrdering'),
				onlyFollowFirstParent: configuration.get('graph.onlyFollowFirstParent'),
				avatars: configuration.get('graph.avatars'),
				maxSearchItems: configuration.get('graph.searchItemLimit'),
			};
		},
	};

	return {
		config: config,

		hooks: {
			cache: {
				onReset: (repoPath: string, ...types: CachedGitTypes[]) =>
					container.events.fire('git:cache:reset', {
						repoPath: getRepositoryKey(repoPath),
						types: types.length ? types : undefined,
					}),
			},
			repository: {
				onChanged: (repoPath: string, changes: RepositoryChange[]) =>
					container.events.fire('git:repo:change', {
						repoPath: getRepositoryKey(repoPath),
						changes: changes,
					}),
			},
			commits: {
				onSigned: (format, source) =>
					container.telemetry.sendEvent('commit/signed', { format: format }, source as Source),
				onSigningFailed: (reason: SigningErrorReason, format, source) =>
					container.telemetry.sendEvent(
						'commit/signing/failed',
						{ reason: reason, format: format },
						source as Source,
					),
			},
			operations: {
				onConflicted: command => container.telemetry.sendEvent('gitCommand/conflict', { command: command }),
				onGitDirResolveFailed: (repoPath, gitDir, errorMessage) =>
					container.telemetry.sendEvent('op/git/gitDirResolve/failed', {
						'repository.path': repoPath,
						'git.dir': gitDir,
						'error.message': errorMessage,
					}),
			},
		},

		fs: {
			readDirectory: async (uri: Uri) => workspace.fs.readDirectory(uri as VscodeUri),
			readFile: async (uri: Uri) => workspace.fs.readFile(uri as VscodeUri),
			stat: async (uri: Uri) => {
				try {
					return await workspace.fs.stat(uri as VscodeUri);
				} catch {
					return undefined;
				}
			},
		},

		remotes: {
			getCustomProviders: async (repoPath: string) => {
				const repo = container.git.getRepository(repoPath);
				const configuredRemotes = configuration.get('remotes', repo?.folder?.uri ?? null);
				const configuredIntegrations = await container.integrations.getConfigured();
				return buildRemoteProviderConfigs(configuredRemotes, configuredIntegrations);
			},

			getRepositoryInfo: (providerId, targetDesc) =>
				getIntegrationRepositoryInfo(container, providerId, targetDesc),

			sort: (remotes, cancellation) => sortRemotes(container, remotes, cancellation),
		},

		searchQuery: {
			preprocessQuery: async (search, source) => {
				const { processNaturalLanguageToSearchQuery } = await import(
					/* webpackChunkName: "ai" */ './search.naturalLanguage.js'
				);
				return processNaturalLanguageToSearchQuery(container, search, source as Source);
			},
		},

		workspace: {
			// workspace.onDidGrantWorkspaceTrust is one-way (untrusted → trusted), but the
			// event is generic boolean for future-proofing
			onDidChangeTrust: (listener, thisArgs, disposables) => {
				const d = mixinDisposable(
					workspace.onDidGrantWorkspaceTrust(() => {
						listener.call(thisArgs, true);
					}),
				);
				if (disposables) {
					disposables.push(d);
				}
				return d;
			},

			getFolder: (repoPath: string) => {
				const folder = workspace.getWorkspaceFolder(VscodeUri.file(repoPath));
				if (folder == null) return undefined;
				return { path: folder.uri.fsPath };
			},

			get isTrusted() {
				return workspace.isTrusted;
			},
		},
	};
}

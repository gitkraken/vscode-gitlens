import type { Disposable } from 'vscode';
import { Uri, workspace } from 'vscode';
import type { GitExecOptions, GitResult, GitSpawnOptions } from '@gitlens/git/exec.types.js';
import type { GitProviderDescriptor } from '@gitlens/git/providers/types.js';
import type { CliGitProvider, CliGitProviderOptions } from '@gitlens/git-cli/cliGitProvider.js';
import type { GitOptions } from '@gitlens/git-cli/exec/git.js';
import { Git } from '@gitlens/git-cli/exec/git.js';
import type { GitLocation } from '@gitlens/git-cli/exec/locator.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getScheme } from '@gitlens/utils/path.js';
import { Schemes } from '../../../constants.js';
import { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { isFolderUri } from '../../../system/-webview/path.js';
import { addVslsPrefixIfNeeded } from '../../../system/-webview/path.vsls.js';
import { gate } from '../../../system/decorators/gate.js';
import { GlCliGitProvider } from './cliGitProvider.js';

export class VslsGit extends Git {
	private readonly localGit: Git;

	constructor(locator: () => Promise<GitLocation>, options?: GitOptions) {
		super(locator, options);

		this.localGit = new Git(locator, { isTrusted: () => workspace.isTrusted });
	}

	override async exec<T extends string | Buffer>(options: GitExecOptions, ...args: any[]): Promise<GitResult<T>> {
		if (options.runLocally) {
			// Since we will have a live share path here, just blank it out
			options.cwd = '';
			return this.localGit.exec<T>(options, ...args);
		}

		const guest = await Container.instance.vsls.guest();
		if (guest == null) {
			debugger;
			throw new Error('No guest');
		}

		return guest.git<T>(options, ...args);
	}

	override async *stream(options: GitSpawnOptions, ...args: readonly (string | undefined)[]): AsyncGenerator<string> {
		const guest = await Container.instance.vsls.guest();
		if (guest == null) {
			debugger;
			throw new Error('No guest');
		}

		// TOTAL HACK for now -- makes it looks like a stream
		const result = await guest.git<string>(options, ...args);
		yield result.stdout;
	}
}

export class VslsGitProvider extends GlCliGitProvider {
	override readonly descriptor: GitProviderDescriptor = {
		id: 'vsls',
		name: 'Live Share',
		virtual: false,
	};
	override readonly supportedSchemes = new Set<string>([Schemes.Vsls, Schemes.VslsScc]);

	private _vslsRegistration: Disposable | undefined;

	protected override getProviderOptions(): CliGitProviderOptions {
		const options = super.getProviderOptions();
		return {
			...options,
			git: new VslsGit(options.locator, { isTrusted: () => workspace.isTrusted }),
		};
	}

	override dispose(): void {
		this._vslsRegistration?.dispose();
		super.dispose();
	}

	protected override ensureProvider(): CliGitProvider {
		const p = super.ensureProvider();
		this._vslsRegistration ??= this.register(p, repoPath => {
			const scheme = getScheme(repoPath);
			return scheme === Schemes.Vsls || scheme === Schemes.VslsScc;
		});
		return p;
	}

	@trace({ exit: true })
	override async discoverRepositories(uri: Uri): Promise<GlRepository[]> {
		if (!this.supportedSchemes.has(uri.scheme)) return [];

		const scope = getScopedLogger();

		try {
			const guest = await this.container.vsls.guest();
			const repositories = await guest?.getRepositoriesForUri(uri);
			if (!repositories?.length) return [];

			const result: GlRepository[] = [];
			for (const r of repositories) {
				const repoUri = Uri.parse(r.folderUri, true);

				const gitDir = await this.provider.config.getGitDir?.(repoUri.fsPath);
				if (gitDir == null) {
					scope?.warn(`Unable to get gitDir for '${repoUri.toString(true)}'`);
					continue;
				}

				result.push(...this.openRepository(undefined, repoUri, gitDir, r.root, r.closed));
			}
			return result;
		} catch (ex) {
			scope?.error(ex);
			debugger;

			return [];
		}
	}

	override canHandlePathOrUri(scheme: string, pathOrUri: string | Uri): string | undefined {
		// TODO@eamodio To support virtual repositories, we need to verify that the path is local here (by converting the shared path to a local path)
		const path = super.canHandlePathOrUri(scheme, pathOrUri);
		return path != null ? `${scheme}:${path}` : undefined;
	}

	override getAbsoluteUri(pathOrUri: string | Uri, base: string | Uri): Uri {
		pathOrUri = addVslsPrefixIfNeeded(pathOrUri);

		const scheme =
			(typeof base !== 'string' ? base.scheme : undefined) ??
			(typeof pathOrUri !== 'string' ? pathOrUri.scheme : undefined) ??
			Schemes.Vsls;

		return super.getAbsoluteUri(pathOrUri, base).with({ scheme: scheme });
	}

	@gate()
	@trace({ exit: true })
	override async findRepositoryUri(uri: Uri, isDirectory?: boolean): Promise<Uri | undefined> {
		const scope = getScopedLogger();

		let repoPath: string | undefined;
		try {
			isDirectory ??= await isFolderUri(uri);

			// If the uri isn't a directory, go up one level
			if (!isDirectory) {
				uri = Uri.joinPath(uri, '..');
			}

			let safe;
			[safe, repoPath] = await this.provider.git.rev_parse__show_toplevel(uri.fsPath);
			if (safe) {
				this.unsafePaths.delete(uri.fsPath);
			} else {
				this.unsafePaths.add(uri.fsPath);
			}
			if (!repoPath) return undefined;

			return repoPath ? Uri.parse(repoPath, true) : undefined;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	override getLastFetchedTimestamp(_repoPath: string): Promise<number | undefined> {
		return Promise.resolve(undefined);
	}
}

import { Uri } from 'vscode';
import { Schemes } from '../../../constants.js';
import { Container } from '../../../container.js';
import type { GitExecOptions, GitResult, GitSpawnOptions } from '../../../git/execTypes.js';
import type { GitProviderDescriptor } from '../../../git/gitProvider.js';
import type { Repository } from '../../../git/models/repository.js';
import { isFolderUri } from '../../../system/-webview/path.js';
import { addVslsPrefixIfNeeded } from '../../../system/-webview/path.vsls.js';
import { gate } from '../../../system/decorators/gate.js';
import { trace } from '../../../system/decorators/log.js';
import { getScopedLogger } from '../../../system/logger.scope.js';
import { Git } from './git.js';
import { LocalGitProvider } from './localGitProvider.js';

export class VslsGit extends Git {
	constructor(
		container: Container,
		private readonly localGit: Git,
	) {
		super(container);
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

export class VslsGitProvider extends LocalGitProvider {
	override readonly descriptor: GitProviderDescriptor = {
		id: 'vsls',
		name: 'Live Share',
		virtual: false,
	};
	override readonly supportedSchemes = new Set<string>([Schemes.Vsls, Schemes.VslsScc]);

	@trace({ exit: true })
	override async discoverRepositories(uri: Uri): Promise<Repository[]> {
		if (!this.supportedSchemes.has(uri.scheme)) return [];

		const scope = getScopedLogger();

		try {
			const guest = await this.container.vsls.guest();
			const repositories = await guest?.getRepositoriesForUri(uri);
			if (!repositories?.length) return [];

			const result: Repository[] = [];
			for (const r of repositories) {
				const repoUri = Uri.parse(r.folderUri, true);

				const gitDir = await this.config.getGitDir(repoUri.fsPath);
				if (gitDir == null) {
					scope?.warn(`Unable to get gitDir for '${repoUri.toString(true)}'`);
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
			[safe, repoPath] = await this.git.rev_parse__show_toplevel(uri.fsPath);
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

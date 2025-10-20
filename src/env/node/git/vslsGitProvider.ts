import { Uri } from 'vscode';
import { Schemes } from '../../../constants';
import { Container } from '../../../container';
import type { GitCommandOptions, GitSpawnOptions } from '../../../git/commandOptions';
import type { GitProviderDescriptor } from '../../../git/gitProvider';
import type { Repository } from '../../../git/models/repository';
import { isFolderUri } from '../../../system/-webview/path';
import { addVslsPrefixIfNeeded } from '../../../system/-webview/path.vsls';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import type { GitResult } from './git';
import { Git } from './git';
import { LocalGitProvider } from './localGitProvider';

export class VslsGit extends Git {
	constructor(
		container: Container,
		private readonly localGit: Git,
	) {
		super(container);
	}

	override async exec<T extends string | Buffer>(options: GitCommandOptions, ...args: any[]): Promise<GitResult<T>> {
		if (options.local) {
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

	override async discoverRepositories(uri: Uri): Promise<Repository[]> {
		if (!this.supportedSchemes.has(uri.scheme)) return [];

		const scope = getLogScope();

		try {
			const guest = await this.container.vsls.guest();
			const repositories = await guest?.getRepositoriesForUri(uri);
			if (repositories == null || repositories.length === 0) return [];

			return repositories.flatMap(r =>
				this.openRepository(undefined, Uri.parse(r.folderUri, true), r.root, r.closed),
			);
		} catch (ex) {
			Logger.error(ex, scope);
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

	override async findRepositoryUri(uri: Uri, isDirectory?: boolean): Promise<Uri | undefined> {
		const scope = getLogScope();

		let repoPath: string | undefined;
		try {
			if (isDirectory == null) {
				isDirectory = await isFolderUri(uri);
			}

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
			Logger.error(ex, scope);
			return undefined;
		}
	}

	override getLastFetchedTimestamp(_repoPath: string): Promise<number | undefined> {
		return Promise.resolve(undefined);
	}
}

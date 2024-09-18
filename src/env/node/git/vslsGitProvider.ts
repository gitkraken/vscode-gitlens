import type { ChildProcess } from 'child_process';
import { FileType, Uri, workspace } from 'vscode';
import { Schemes } from '../../../constants';
import { Container } from '../../../container';
import type { GitCommandOptions, GitSpawnOptions } from '../../../git/commandOptions';
import type { GitProviderDescriptor } from '../../../git/gitProvider';
import type { Repository } from '../../../git/models/repository';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import { addVslsPrefixIfNeeded } from '../../../system/vscode/path';
import { Git } from './git';
import { LocalGitProvider } from './localGitProvider';

export class VslsGit extends Git {
	constructor(private readonly localGit: Git) {
		super();
	}

	override async git<TOut extends string | Buffer>(options: GitCommandOptions, ...args: any[]): Promise<TOut> {
		if (options.local) {
			// Since we will have a live share path here, just blank it out
			options.cwd = '';
			return this.localGit.git<TOut>(options, ...args);
		}

		const guest = await Container.instance.vsls.guest();
		if (guest == null) {
			debugger;
			throw new Error('No guest');
		}

		return guest.git<TOut>(options, ...args);
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	override async gitSpawn(_options: GitSpawnOptions, ..._args: any[]): Promise<ChildProcess> {
		debugger;
		throw new Error('Git spawn not supported in Live Share');
	}

	override async logStreamTo(
		repoPath: string,
		sha: string,
		limit: number,
		options?: { configs?: readonly string[]; stdin?: string },
		...args: string[]
	): Promise<[data: string[], count: number]> {
		const guest = await Container.instance.vsls.guest();
		if (guest == null) {
			debugger;
			throw new Error('No guest');
		}

		return guest.gitLogStreamTo(repoPath, sha, limit, options, ...args);
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
				this.openRepository(undefined, Uri.parse(r.folderUri, true), r.root, undefined, r.closed),
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
				const stats = await workspace.fs.stat(uri);
				isDirectory = (stats.type & FileType.Directory) === FileType.Directory;
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

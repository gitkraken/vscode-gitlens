import { FileType, Uri, workspace } from 'vscode';
import { Schemes } from '../../../constants';
import { Container } from '../../../container';
import { GitCommandOptions } from '../../../git/commandOptions';
import { GitProviderDescriptor, GitProviderId } from '../../../git/gitProvider';
import { Repository } from '../../../git/models/repository';
import { Logger } from '../../../logger';
import { addVslsPrefixIfNeeded, dirname } from '../../../system/path';
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
}

export class VslsGitProvider extends LocalGitProvider {
	override readonly descriptor: GitProviderDescriptor = { id: GitProviderId.Vsls, name: 'Live Share' };
	override readonly supportedSchemes: Set<string> = new Set([Schemes.Vsls, Schemes.VslsScc]);

	override async discoverRepositories(uri: Uri): Promise<Repository[]> {
		if (!this.supportedSchemes.has(uri.scheme)) return [];

		const cc = Logger.getCorrelationContext();

		try {
			const guest = await this.container.vsls.guest();
			const repositories = await guest?.getRepositoriesForUri(uri);
			if (repositories == null || repositories.length === 0) return [];

			return repositories.map(r =>
				this.openRepository(undefined, Uri.parse(r.folderUri, true), r.root, undefined, r.closed),
			);
		} catch (ex) {
			Logger.error(ex, cc);
			debugger;

			return [];
		}
	}

	override canHandlePathOrUri(scheme: string, pathOrUri: string | Uri): string | undefined {
		// TODO@eamodio To support virtual repositories, we need to verify that the path is local here (by converting the shared path to a local path)
		return super.canHandlePathOrUri(scheme, pathOrUri);
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
		const cc = Logger.getCorrelationContext();

		let repoPath: string | undefined;
		try {
			if (!isDirectory) {
				try {
					const stats = await workspace.fs.stat(uri);
					uri = stats?.type === FileType.Directory ? uri : uri.with({ path: dirname(uri.fsPath) });
				} catch {}
			}

			repoPath = await this.git.rev_parse__show_toplevel(uri.fsPath);
			if (!repoPath) return undefined;

			return repoPath ? Uri.parse(repoPath, true) : undefined;
		} catch (ex) {
			Logger.error(ex, cc);
			return undefined;
		}
	}

	override getLastFetchedTimestamp(_repoPath: string): Promise<number | undefined> {
		return Promise.resolve(undefined);
	}
}

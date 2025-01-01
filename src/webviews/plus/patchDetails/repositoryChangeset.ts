import { Disposable } from 'vscode';
import type { Container } from '../../../container';
import type { GitFileChangeShape } from '../../../git/models/file';
import type { PatchRevisionRange } from '../../../git/models/patch';
import type { Repository } from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import type { Change, ChangeType, RevisionChange } from './protocol';

export interface RepositoryChangeset extends Disposable {
	type: ChangeType;
	repository: Repository;
	revision: PatchRevisionRange;
	getChange(): Promise<Change>;

	suspend(): void;
	resume(): void;

	checked: Change['checked'];
	expanded: boolean;
}

export class RepositoryRefChangeset implements RepositoryChangeset {
	readonly type = 'revision';

	constructor(
		private readonly container: Container,
		public readonly repository: Repository,
		public readonly revision: PatchRevisionRange,
		private readonly files: RevisionChange['files'],
		checked: Change['checked'],
		expanded: boolean,
	) {
		this.checked = checked;
		this.expanded = expanded;
	}

	dispose() {}

	suspend() {}

	resume() {}

	private _checked: Change['checked'] = false;
	get checked(): Change['checked'] {
		return this._checked;
	}
	set checked(value: Change['checked']) {
		this._checked = value;
	}

	private _expanded = false;
	get expanded(): boolean {
		return this._expanded;
	}
	set expanded(value: boolean) {
		if (this._expanded === value) return;

		this._expanded = value;
	}

	// private _files: Promise<{ files: Change['files'] }> | undefined;
	// eslint-disable-next-line @typescript-eslint/require-await
	async getChange(): Promise<Change> {
		// let filesResult;
		// if (this.expanded) {
		// 	if (this._files == null) {
		// 		this._files = this.getFiles();
		// 	}

		// 	filesResult = await this._files;
		// }

		return {
			type: 'revision',
			repository: {
				name: this.repository.name,
				path: this.repository.path,
				uri: this.repository.uri.toString(),
			},
			revision: this.revision,
			files: this.files, //filesResult?.files,
			checked: this.checked,
			expanded: this.expanded,
		};
	}

	// private async getFiles(): Promise<{ files: Change['files'] }> {
	// 	const commit = await this.container.git.getCommit(this.repository.path, this.range.sha!);

	// 	const files: GitFileChangeShape[] = [];
	// 	if (commit != null) {
	// 		for (const file of commit.files ?? []) {
	// 			const change = {
	// 				repoPath: file.repoPath,
	// 				path: file.path,
	// 				status: file.status,
	// 				originalPath: file.originalPath,
	// 			};

	// 			files.push(change);
	// 		}
	// 	}

	// 	return { files: files };
	// }
}

export class RepositoryWipChangeset implements RepositoryChangeset {
	readonly type = 'wip';

	private _disposable: Disposable | undefined;

	constructor(
		private readonly container: Container,
		public readonly repository: Repository,
		public readonly revision: PatchRevisionRange,
		private readonly onDidChangeRepositoryWip: (e: RepositoryWipChangeset) => void,
		checked: Change['checked'],
		expanded: boolean,
	) {
		this.checked = checked;
		this.expanded = expanded;
	}

	dispose() {
		this._disposable?.dispose();
		this._disposable = undefined;
	}

	suspend() {
		this._disposable?.dispose();
		this._disposable = undefined;
	}

	resume() {
		this._files = undefined;
		if (this._expanded) {
			this.subscribe();
		}
	}

	private _checked: Change['checked'] = false;
	get checked(): Change['checked'] {
		return this._checked;
	}
	set checked(value: Change['checked']) {
		this._checked = value;
	}

	private _expanded = false;
	get expanded(): boolean {
		return this._expanded;
	}
	set expanded(value: boolean) {
		if (this._expanded === value) return;

		this._files = undefined;
		if (value) {
			this.subscribe();
		} else {
			this._disposable?.dispose();
			this._disposable = undefined;
		}
		this._expanded = value;
	}

	private _files: Promise<{ files: Change['files'] }> | undefined;
	async getChange(): Promise<Change> {
		let filesResult;
		if (this.expanded) {
			if (this._files == null) {
				this._files = this.getFiles();
			}

			filesResult = await this._files;
		}

		return {
			type: 'wip',
			repository: {
				name: this.repository.name,
				path: this.repository.path,
				uri: this.repository.uri.toString(),
			},
			revision: this.revision,
			files: filesResult?.files,
			checked: this.checked,
			expanded: this.expanded,
		};
	}

	private subscribe() {
		if (this._disposable != null) return;

		this._disposable = Disposable.from(
			this.repository.watchFileSystem(1000),
			this.repository.onDidChangeFileSystem(() => this.onDidChangeWip(), this),
			this.repository.onDidChange(e => {
				if (e.changed(RepositoryChange.Index, RepositoryChangeComparisonMode.Any)) {
					this.onDidChangeWip();
				}
			}),
		);
	}

	private onDidChangeWip() {
		this._files = undefined;
		this.onDidChangeRepositoryWip(this);
	}

	private async getFiles(): Promise<{ files: Change['files'] }> {
		const status = await this.container.git.getStatus(this.repository.path);

		const files: GitFileChangeShape[] = [];
		if (status != null) {
			for (const file of status.files) {
				const change = {
					repoPath: file.repoPath,
					path: file.path,
					status: file.status,
					originalPath: file.originalPath,
					staged: file.staged,
				};

				files.push(change);
				if (file.staged && file.wip) {
					files.push({ ...change, staged: false });
				}
			}
		}

		return { files: files };
	}
}

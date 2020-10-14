import { env, Range, TextDocumentShowOptions, Uri, window } from 'vscode';
import {
	BrowseRepoAtRevisionCommandArgs,
	Commands,
	DiffWithCommandArgs,
	DiffWithWorkingCommandArgs,
	executeCommand,
	executeEditorCommand,
	findOrOpenEditor,
	findOrOpenEditors,
	GitCommandsCommandArgs,
	OpenWorkingFileCommandArgs,
} from '../commands';
import { configuration, FileAnnotationType } from '../configuration';
import { Container } from '../container';
import {
	GitBranchReference,
	GitContributor,
	GitFile,
	GitLogCommit,
	GitReference,
	GitRemote,
	GitRevision,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
	Repository,
} from '../git/git';
import { GitUri } from '../git/gitUri';
import { ResetGitCommandArgs } from './git/reset';

export async function executeGitCommand(args: GitCommandsCommandArgs): Promise<void> {
	void (await executeCommand<GitCommandsCommandArgs>(Commands.GitCommands, args));
}

async function ensureRepo(repo: string | Repository): Promise<Repository> {
	return typeof repo === 'string' ? (await Container.git.getRepository(repo))! : repo;
}

export namespace GitActions {
	export async function browseAtRevision(uri: Uri, options?: { openInNewWindow?: boolean }) {
		void (await executeEditorCommand<BrowseRepoAtRevisionCommandArgs>(Commands.BrowseRepoAtRevision, undefined, {
			uri: uri,
			openInNewWindow: options?.openInNewWindow,
		}));
	}

	export function cherryPick(repo?: string | Repository, refs?: GitRevisionReference | GitRevisionReference[]) {
		return executeGitCommand({
			command: 'cherry-pick',
			state: { repo: repo, references: refs },
		});
	}

	export function fetch(repos?: string | string[] | Repository | Repository[]) {
		return executeGitCommand({ command: 'fetch', state: { repos: repos } });
	}

	export function merge(repo?: string | Repository, ref?: GitReference) {
		return executeGitCommand({ command: 'merge', state: { repo: repo, reference: ref } });
	}

	export function pull(repos?: string | string[] | Repository | Repository[], ref?: GitBranchReference) {
		return executeGitCommand({ command: 'pull', state: { repos: repos, reference: ref } });
	}

	export function push(repos?: string | string[] | Repository | Repository[], force?: boolean, ref?: GitReference) {
		return executeGitCommand({
			command: 'push',
			state: { repos: repos, flags: force ? ['--force'] : [], reference: ref },
		});
	}

	export function rebase(repo?: string | Repository, ref?: GitReference, interactive: boolean = true) {
		return executeGitCommand({
			command: 'rebase',
			state: { repo: repo, reference: ref, flags: interactive ? ['--interactive'] : [] },
		});
	}

	export function reset(
		repo?: string | Repository,
		ref?: GitRevisionReference,
		flags?: NonNullable<ResetGitCommandArgs['state']>['flags'],
	) {
		return executeGitCommand({
			command: 'reset',
			confirm: flags == null || flags.includes('--hard'),
			state: { repo: repo, reference: ref, flags: flags },
		});
	}

	export function revert(repo?: string | Repository, refs?: GitRevisionReference | GitRevisionReference[]) {
		return executeGitCommand({
			command: 'revert',
			state: { repo: repo, references: refs },
		});
	}

	export function switchTo(repos?: string | string[] | Repository | Repository[], ref?: GitReference) {
		return executeGitCommand({
			command: 'switch',
			state: { repos: repos, reference: ref },
		});
	}

	export namespace Branch {
		export function create(repo?: string | Repository, ref?: GitReference, name?: string) {
			return executeGitCommand({
				command: 'branch',
				state: {
					subcommand: 'create',
					repo: repo,
					reference: ref,
					name: name,
				},
			});
		}

		export function remove(repo?: string | Repository, refs?: GitBranchReference | GitBranchReference[]) {
			return executeGitCommand({
				command: 'branch',
				state: {
					subcommand: 'delete',
					repo: repo,
					references: refs,
				},
			});
		}

		export function rename(repo?: string | Repository, ref?: GitBranchReference, name?: string) {
			return executeGitCommand({
				command: 'branch',
				state: {
					subcommand: 'rename',
					repo: repo,
					reference: ref,
					name: name,
				},
			});
		}

		export async function reveal(
			branch: GitBranchReference,
			options?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			},
		) {
			if (
				configuration.get('views', 'repositories', 'enabled') &&
				(Container.repositoriesView.visible ||
					(branch.remote ? !Container.remotesView.visible : !Container.branchesView.visible))
			) {
				return Container.repositoriesView.revealBranch(branch, options);
			}

			let node;
			if (!branch.remote) {
				node = await Container.branchesView.revealBranch(branch, options);
			} else {
				node = await Container.remotesView.revealBranch(branch, options);
			}

			return node;
		}
	}

	export namespace Commit {
		export async function applyChanges(
			file: string | GitFile,
			ref1: GitRevisionReference,
			ref2?: GitRevisionReference,
		) {
			// Open the working file to ensure undo will work
			void (await GitActions.Commit.openFile(file, ref1, { preserveFocus: true, preview: false }));
			void (await Container.git.applyChangesToWorkingFile(
				GitUri.fromFile(file, ref1.repoPath, ref1.ref),
				ref1.ref,
				ref2?.ref,
			));
		}

		export async function copyIdToClipboard(ref: { repoPath: string; ref: string } | GitLogCommit) {
			void (await env.clipboard.writeText(ref.ref));
		}

		export async function copyMessageToClipboard(ref: { repoPath: string; ref: string } | GitLogCommit) {
			let message;
			if (GitLogCommit.is(ref)) {
				message = ref.message;
			} else {
				const commit = await Container.git.getCommit(ref.repoPath, ref.ref);
				if (commit == null) return;

				message = commit.message;
			}

			void (await env.clipboard.writeText(message));
		}

		export async function openAllChanges(commit: GitLogCommit, options?: TextDocumentShowOptions): Promise<void>;
		export async function openAllChanges(
			files: GitFile[],
			refs: { repoPath: string; ref1: string; ref2: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openAllChanges(
			commitOrFiles: GitLogCommit | GitFile[],
			refsOrOptions: { repoPath: string; ref1: string; ref2: string } | TextDocumentShowOptions | undefined,
			options?: TextDocumentShowOptions,
		) {
			let files;
			let refs;
			if (GitLogCommit.is(commitOrFiles)) {
				files = commitOrFiles.files;
				refs = {
					repoPath: commitOrFiles.repoPath,
					ref1: commitOrFiles.previousSha != null ? commitOrFiles.previousSha : GitRevision.deletedOrMissing,
					ref2: commitOrFiles.sha,
				};

				options = refsOrOptions as TextDocumentShowOptions | undefined;
			} else {
				files = commitOrFiles;
				refs = refsOrOptions as { repoPath: string; ref1: string; ref2: string };
			}

			if (files.length > 20) {
				const result = await window.showWarningMessage(
					`Are your sure you want to open all ${files.length} changes?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			options = { preserveFocus: true, preview: false, ...options };

			for (const file of files) {
				await openChanges(file, refs, options);
			}
		}

		export async function openAllChangesWithDiffTool(commit: GitLogCommit): Promise<void>;
		export async function openAllChangesWithDiffTool(
			files: GitFile[],
			ref: { repoPath: string; ref: string },
		): Promise<void>;
		export async function openAllChangesWithDiffTool(
			commitOrFiles: GitLogCommit | GitFile[],
			ref?: { repoPath: string; ref: string },
		) {
			let files;
			if (GitLogCommit.is(commitOrFiles)) {
				files = commitOrFiles.files;
				ref = {
					repoPath: commitOrFiles.repoPath,
					ref: commitOrFiles.sha,
				};
			} else {
				files = commitOrFiles;
			}

			if (files.length > 20) {
				const result = await window.showWarningMessage(
					`Are your sure you want to open all ${files.length} changes?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			for (const file of files) {
				void openChangesWithDiffTool(file, ref!);
			}
		}

		export async function openAllChangesWithWorking(
			commit: GitLogCommit,
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openAllChangesWithWorking(
			files: GitFile[],
			ref: { repoPath: string; ref: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openAllChangesWithWorking(
			commitOrFiles: GitLogCommit | GitFile[],
			refOrOptions: { repoPath: string; ref: string } | TextDocumentShowOptions | undefined,
			options?: TextDocumentShowOptions,
		) {
			let files;
			let ref;
			if (GitLogCommit.is(commitOrFiles)) {
				files = commitOrFiles.files;
				ref = {
					repoPath: commitOrFiles.repoPath,
					ref: commitOrFiles.sha,
				};

				options = refOrOptions as TextDocumentShowOptions | undefined;
			} else {
				files = commitOrFiles;
				ref = refOrOptions as { repoPath: string; ref: string };
			}

			if (files.length > 20) {
				const result = await window.showWarningMessage(
					`Are your sure you want to open all ${files.length} changes?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			options = { preserveFocus: true, preview: false, ...options };

			for (const file of files) {
				void (await openChangesWithWorking(file, ref, options));
			}
		}

		export async function openChanges(
			file: string | GitFile,
			commit: GitLogCommit,
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChanges(
			file: GitFile,
			refs: { repoPath: string; ref1: string; ref2: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChanges(
			file: string | GitFile,
			commitOrRefs: GitLogCommit | { repoPath: string; ref1: string; ref2: string },
			options?: TextDocumentShowOptions,
		) {
			if (typeof file === 'string') {
				if (!GitLogCommit.is(commitOrRefs)) throw new Error('Invalid arguments');

				const f = commitOrRefs.findFile(file);
				if (f == null) throw new Error('Invalid arguments');

				file = f;
			}

			if (file.status === 'A') return;

			const refs = GitLogCommit.is(commitOrRefs)
				? {
						repoPath: commitOrRefs.repoPath,
						ref1:
							commitOrRefs.previousSha != null ? commitOrRefs.previousSha : GitRevision.deletedOrMissing,
						ref2: commitOrRefs.sha,
				  }
				: commitOrRefs;

			options = { preserveFocus: true, preview: false, ...options };

			const uri1 = GitUri.fromFile(file, refs.repoPath);
			const uri2 =
				file.status === 'R' || file.status === 'C'
					? GitUri.fromFile(file, refs.repoPath, refs.ref2, true)
					: uri1;

			void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
				repoPath: refs.repoPath,
				lhs: { uri: uri1, sha: refs.ref1 },
				rhs: { uri: uri2, sha: refs.ref2 },
				showOptions: options,
			}));
		}

		export async function openChangesWithDiffTool(
			file: string | GitFile,
			commit: GitLogCommit,
			tool?: string,
		): Promise<void>;
		export async function openChangesWithDiffTool(
			file: GitFile,
			ref: { repoPath: string; ref: string },
			tool?: string,
		): Promise<void>;
		export async function openChangesWithDiffTool(
			file: string | GitFile,
			commitOrRef: GitLogCommit | { repoPath: string; ref: string },
			tool?: string,
		) {
			if (typeof file === 'string') {
				if (!GitLogCommit.is(commitOrRef)) throw new Error('Invalid arguments');

				const f = commitOrRef.findFile(file);
				if (f == null) throw new Error('Invalid arguments');

				file = f;
			}

			if (!tool) {
				tool = await Container.git.getDiffTool(commitOrRef.repoPath);
				if (tool == null) {
					const result = await window.showWarningMessage(
						'Unable to open changes in diff tool. No Git diff tool is configured',
						'View Git Docs',
					);
					if (!result) return;

					void env.openExternal(
						Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
					);

					return;
				}
			}

			void Container.git.openDiffTool(
				commitOrRef.repoPath,
				GitUri.fromFile(file, file.repoPath ?? commitOrRef.repoPath),
				{
					ref1: GitRevision.isUncommitted(commitOrRef.ref) ? '' : `${commitOrRef.ref}^`,
					ref2: GitRevision.isUncommitted(commitOrRef.ref) ? '' : commitOrRef.ref,
					staged: GitRevision.isUncommittedStaged(commitOrRef.ref) || file.indexStatus != null,
					tool: tool,
				},
			);
		}

		export async function openChangesWithWorking(
			file: string | GitFile,
			commit: GitLogCommit,
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChangesWithWorking(
			file: GitFile,
			ref: { repoPath: string; ref: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChangesWithWorking(
			file: string | GitFile,
			commitOrRef: GitLogCommit | { repoPath: string; ref: string },
			options?: TextDocumentShowOptions,
		) {
			if (typeof file === 'string') {
				if (!GitLogCommit.is(commitOrRef)) throw new Error('Invalid arguments');

				const f = commitOrRef.files.find(f => f.fileName === file);
				if (f == null) throw new Error('Invalid arguments');

				file = f;
			}

			if (file.status === 'A' || file.status === 'D') return;

			let ref;
			if (GitLogCommit.is(commitOrRef)) {
				ref = {
					repoPath: commitOrRef.repoPath,
					ref: commitOrRef.sha,
				};
			} else {
				ref = commitOrRef;
			}

			options = { preserveFocus: true, preview: false, ...options };

			void (await executeEditorCommand<DiffWithWorkingCommandArgs>(Commands.DiffWithWorking, undefined, {
				uri: GitUri.fromFile(file, ref.repoPath, ref.ref),
				showOptions: options,
			}));
		}

		export async function openDirectoryCompare(
			ref: { repoPath: string; ref: string } | GitLogCommit,
		): Promise<void> {
			try {
				void (await Container.git.openDirectoryCompare(ref.repoPath, ref.ref, `${ref.ref}^`));
			} catch (ex) {
				const msg: string = ex?.toString() ?? '';
				if (msg === 'No diff tool found') {
					const result = await window.showWarningMessage(
						'Unable to open directory compare because there is no Git diff tool configured',
						'View Git Docs',
					);
					if (!result) return;

					void env.openExternal(
						Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
					);
				}
			}
		}

		export async function openDirectoryCompareWithWorking(
			ref: { repoPath: string; ref: string } | GitLogCommit,
		): Promise<void> {
			try {
				void (await Container.git.openDirectoryCompare(ref.repoPath, ref.ref, undefined));
			} catch (ex) {
				const msg: string = ex?.toString() ?? '';
				if (msg === 'No diff tool found') {
					const result = await window.showWarningMessage(
						'Unable to open directory compare because there is no Git diff tool configured',
						'View Git Docs',
					);
					if (!result) return;

					void env.openExternal(
						Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
					);
				}
			}
		}

		export async function openFile(uri: Uri, options?: TextDocumentShowOptions): Promise<void>;
		export async function openFile(
			file: string | GitFile,
			ref: GitRevisionReference,
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openFile(
			fileOrUri: string | GitFile | Uri,
			refOrOptions?: GitRevisionReference | TextDocumentShowOptions,
			options?: TextDocumentShowOptions,
		) {
			let uri;
			if (fileOrUri instanceof Uri) {
				uri = fileOrUri;
				options = refOrOptions as TextDocumentShowOptions;
			} else {
				const ref = refOrOptions as GitRevisionReference;
				uri = GitUri.fromFile(fileOrUri, ref.repoPath, ref.ref);
			}

			options = { preserveFocus: true, preview: false, ...options };

			void (await executeEditorCommand<OpenWorkingFileCommandArgs>(Commands.OpenWorkingFile, undefined, {
				uri: uri,
				showOptions: options,
			}));
		}

		export async function openFileAtRevision(
			revisionUri: Uri,
			options?: TextDocumentShowOptions & { annotationType?: FileAnnotationType; line?: number },
		): Promise<void>;
		export async function openFileAtRevision(
			file: string | GitFile,
			commit: GitLogCommit,
			options?: TextDocumentShowOptions & { annotationType?: FileAnnotationType; line?: number },
		): Promise<void>;
		export async function openFileAtRevision(
			fileOrRevisionUri: string | GitFile | Uri,
			commitOrOptions?: GitLogCommit | TextDocumentShowOptions,
			options?: TextDocumentShowOptions & { annotationType?: FileAnnotationType; line?: number },
		): Promise<void> {
			let uri;
			if (fileOrRevisionUri instanceof Uri) {
				if (GitLogCommit.is(commitOrOptions)) throw new Error('Invalid arguments');

				uri = fileOrRevisionUri;
				options = commitOrOptions;
			} else {
				if (!GitLogCommit.is(commitOrOptions)) throw new Error('Invalid arguments');

				const commit = commitOrOptions;

				let file;
				if (typeof fileOrRevisionUri === 'string') {
					const f = commit.findFile(fileOrRevisionUri);
					if (f == null) throw new Error('Invalid arguments');

					file = f;
				} else {
					file = fileOrRevisionUri;
				}

				uri = GitUri.toRevisionUri(
					file.status === 'D' ? commit.previousFileSha : commit.sha,
					file,
					commit.repoPath,
				);
			}

			const { annotationType, line, ...opts }: Exclude<typeof options, undefined> = {
				preserveFocus: true,
				preview: false,
				...options,
			};

			if (line != null && line !== 0) {
				opts.selection = new Range(line, 0, line, 0);
			}

			const editor = await findOrOpenEditor(uri, opts);
			if (annotationType != null && editor != null) {
				void (await Container.fileAnnotations.show(editor, annotationType, line));
			}
		}

		export async function openFiles(commit: GitLogCommit): Promise<void>;
		export async function openFiles(files: GitFile[], repoPath: string, ref: string): Promise<void>;
		export async function openFiles(
			commitOrFiles: GitLogCommit | GitFile[],
			repoPath?: string,
			ref?: string,
		): Promise<void> {
			let files;
			if (GitLogCommit.is(commitOrFiles)) {
				files = commitOrFiles.files;
				repoPath = commitOrFiles.repoPath;
				ref = commitOrFiles.sha;
			} else {
				files = commitOrFiles;
			}

			if (files.length > 20) {
				const result = await window.showWarningMessage(
					`Are your sure you want to open all ${files.length} files?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			const uris: Uri[] = (
				await Promise.all(
					files.map(file => Container.git.getWorkingUri(repoPath!, GitUri.fromFile(file, repoPath!, ref))),
				)
			).filter(<T>(u?: T): u is T => Boolean(u));
			findOrOpenEditors(uris);
		}

		export async function openFilesAtRevision(commit: GitLogCommit): Promise<void>;
		export async function openFilesAtRevision(
			files: GitFile[],
			repoPath: string,
			ref1: string,
			ref2: string,
		): Promise<void>;
		export async function openFilesAtRevision(
			commitOrFiles: GitLogCommit | GitFile[],
			repoPath?: string,
			ref1?: string,
			ref2?: string,
		): Promise<void> {
			let files;
			if (GitLogCommit.is(commitOrFiles)) {
				files = commitOrFiles.files;
				repoPath = commitOrFiles.repoPath;
				ref1 = commitOrFiles.sha;
				ref2 = commitOrFiles.previousFileSha;
			} else {
				files = commitOrFiles;
			}

			if (files.length > 20) {
				const result = await window.showWarningMessage(
					`Are your sure you want to open all ${files.length} revisions?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			findOrOpenEditors(
				files.map(file => GitUri.toRevisionUri(file.status === 'D' ? ref2! : ref1!, file, repoPath!)),
			);
		}

		export async function restoreFile(file: string | GitFile, ref: GitRevisionReference) {
			void (await Container.git.checkout(ref.repoPath, ref.ref, {
				fileName: typeof file === 'string' ? file : file.fileName,
			}));
		}

		export async function reveal(
			commit: GitRevisionReference,
			options?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			},
		) {
			if (
				configuration.get('views', 'repositories', 'enabled') &&
				(Container.repositoriesView.visible || !Container.commitsView.visible)
			) {
				return Container.repositoriesView.revealCommit(commit, options);
			}

			// TODO@eamodio stop duplicate notifications

			let node = await Container.commitsView.revealCommit(commit, options);
			if (node != null) return node;

			node = await Container.branchesView.revealCommit(commit, options);
			if (node != null) return node;

			node = await Container.remotesView.revealCommit(commit, options);
			if (node != null) return node;

			return undefined;
		}
	}

	export namespace Contributor {
		export function addAuthors(repo?: string | Repository, contributors?: GitContributor | GitContributor[]) {
			return executeGitCommand({
				command: 'co-authors',
				state: { repo: repo, contributors: contributors },
			});
		}
	}

	export namespace Tag {
		export function create(repo?: string | Repository, ref?: GitReference, name?: string) {
			return executeGitCommand({
				command: 'tag',
				state: {
					subcommand: 'create',
					repo: repo,
					reference: ref,
					name: name,
				},
			});
		}

		export function remove(repo?: string | Repository, refs?: GitTagReference | GitTagReference[]) {
			return executeGitCommand({
				command: 'tag',
				state: {
					subcommand: 'delete',
					repo: repo,
					references: refs,
				},
			});
		}

		export async function reveal(
			tag: GitTagReference,
			options?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			},
		) {
			if (
				configuration.get('views', 'repositories', 'enabled') &&
				(Container.repositoriesView.visible || !Container.tagsView.visible)
			) {
				return Container.repositoriesView.revealTag(tag, options);
			}

			const node = await Container.tagsView.revealTag(tag, options);
			return node;
		}
	}

	export namespace Remote {
		export async function add(repo: string | Repository) {
			const name = await window.showInputBox({
				prompt: 'Please provide a name for the remote',
				placeHolder: 'Remote name',
				value: undefined,
				ignoreFocusOut: true,
			});
			if (name == null || name.length === 0) return undefined;

			const url = await window.showInputBox({
				prompt: 'Please provide the repository url for the remote',
				placeHolder: 'Remote repository url',
				value: undefined,
				ignoreFocusOut: true,
			});
			if (url == null || url.length === 0) return undefined;

			repo = await ensureRepo(repo);
			void (await Container.git.addRemote(repo.path, name, url));
			void (await repo.fetch({ remote: name }));

			return name;
		}

		export async function fetch(repo: string | Repository, remote: string) {
			if (typeof repo === 'string') {
				const r = await Container.git.getRepository(repo);
				if (r == null) return;

				repo = r;
			}

			void (await repo.fetch({ remote: remote }));
		}

		export async function prune(repo: string | Repository, remote: string) {
			void (await Container.git.pruneRemote(typeof repo === 'string' ? repo : repo.path, remote));
		}

		export async function reveal(
			remote: GitRemote,
			options?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			},
		) {
			// if (
			// 	configuration.get('views', 'repositories', 'enabled') &&
			// 	(Container.repositoriesView.visible || !Container.remotesView.visible)
			// ) {
			// 	return Container.repositoriesView.revealRemote(remote, options);
			// }

			const node = await Container.remotesView.revealRemote(remote, options);
			return node;
		}
	}

	export namespace Stash {
		export function apply(repo?: string | Repository, ref?: GitStashReference) {
			return executeGitCommand({
				command: 'stash',
				state: { subcommand: 'apply', repo: repo, reference: ref },
			});
		}

		export function drop(repo?: string | Repository, ref?: GitStashReference) {
			return executeGitCommand({
				command: 'stash',
				state: { subcommand: 'drop', repo: repo, reference: ref },
			});
		}

		export function pop(repo?: string | Repository, ref?: GitStashReference) {
			return executeGitCommand({
				command: 'stash',
				state: { subcommand: 'pop', repo: repo, reference: ref },
			});
		}

		export function push(repo?: string | Repository, uris?: Uri[], message?: string, keepStaged: boolean = false) {
			return executeGitCommand({
				command: 'stash',
				state: {
					subcommand: 'push',
					repo: repo,
					uris: uris,
					message: message,
					flags: keepStaged ? ['--keep-index'] : undefined,
				},
			});
		}

		export async function reveal(
			stash: GitStashReference,
			options?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			},
		) {
			if (
				configuration.get('views', 'repositories', 'enabled') &&
				(Container.repositoriesView.visible || !Container.stashesView.visible)
			) {
				return Container.repositoriesView.revealStash(stash, options);
			}

			const node = await Container.stashesView.revealStash(stash, options);
			return node;
		}
	}
}

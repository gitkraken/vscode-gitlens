import type { TextDocumentShowOptions } from 'vscode';
import { env, Range, Uri, window } from 'vscode';
import type {
	BrowseRepoAtRevisionCommandArgs,
	DiffWithCommandArgs,
	DiffWithPreviousCommandArgs,
	DiffWithWorkingCommandArgs,
	GitCommandsCommandArgs,
	GitCommandsCommandArgsWithCompletion,
	OpenFileOnRemoteCommandArgs,
	OpenWorkingFileCommandArgs,
	ShowQuickCommitCommandArgs,
	ShowQuickCommitFileCommandArgs,
} from '../commands';
import type { FileAnnotationType } from '../configuration';
import { Commands, CoreCommands } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit, GitStashCommit } from '../git/models/commit';
import { isCommit } from '../git/models/commit';
import type { GitContributor } from '../git/models/contributor';
import type { GitFile } from '../git/models/file';
import type {
	GitBranchReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '../git/models/reference';
import { GitReference, GitRevision } from '../git/models/reference';
import type { GitRemote } from '../git/models/remote';
import type { Repository } from '../git/models/repository';
import type { GitWorktree } from '../git/models/worktree';
import type { ShowInCommitGraphCommandArgs } from '../plus/webviews/graph/graphWebview';
import { ensure } from '../system/array';
import { executeCommand, executeCoreCommand, executeEditorCommand } from '../system/command';
import { defer } from '../system/promise';
import type { OpenWorkspaceLocation } from '../system/utils';
import { findOrOpenEditor, findOrOpenEditors, openWorkspace } from '../system/utils';
import type { ViewsWithRepositoryFolders } from '../views/viewBase';
import type { ResetGitCommandArgs } from './git/reset';

export async function executeGitCommand(args: GitCommandsCommandArgs): Promise<void> {
	const deferred = defer<void>();
	void (await executeCommand<GitCommandsCommandArgsWithCompletion>(Commands.GitCommands, {
		...args,
		completion: deferred,
	}));
	return deferred.promise;
}

export namespace GitActions {
	export async function browseAtRevision(uri: Uri, options?: { before?: boolean; openInNewWindow?: boolean }) {
		void (await executeEditorCommand<BrowseRepoAtRevisionCommandArgs>(Commands.BrowseRepoAtRevision, undefined, {
			uri: uri,
			before: options?.before,
			openInNewWindow: options?.openInNewWindow,
		}));
	}

	export function cherryPick(repo?: string | Repository, refs?: GitRevisionReference | GitRevisionReference[]) {
		return executeGitCommand({
			command: 'cherry-pick',
			state: { repo: repo, references: refs },
		});
	}

	export function fetch(repos?: string | string[] | Repository | Repository[], ref?: GitBranchReference) {
		return executeGitCommand({ command: 'fetch', state: { repos: repos, reference: ref } });
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

	export function switchTo(
		repos?: string | string[] | Repository | Repository[],
		ref?: GitReference,
		confirm?: boolean,
	) {
		return executeGitCommand({
			command: 'switch',
			state: { repos: repos, reference: ref },
			confirm: confirm,
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
			const view = branch.remote ? Container.instance.remotesView : Container.instance.branchesView;
			const node = view.canReveal
				? await view.revealBranch(branch, options)
				: await Container.instance.repositoriesView.revealBranch(branch, options);

			if (node == null) {
				void view.show({ preserveFocus: !options?.focus });
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
			await GitActions.Commit.openFile(file, ref1, { preserveFocus: true, preview: false });

			let ref = ref1.ref;
			// If the file is `?` (untracked), then this must be a stash, so get the ^3 commit to access the untracked file
			if (typeof file !== 'string' && file.status === '?') {
				ref = `${ref}^3`;
			}

			await Container.instance.git.applyChangesToWorkingFile(
				GitUri.fromFile(file, ref1.repoPath, ref),
				ref,
				ref2?.ref,
			);
		}

		export async function copyIdToClipboard(ref: { repoPath: string; ref: string } | GitCommit) {
			await env.clipboard.writeText(ref.ref);
		}

		export async function copyMessageToClipboard(
			ref: { repoPath: string; ref: string } | GitCommit,
		): Promise<void> {
			let commit;
			if (isCommit(ref)) {
				commit = ref;
				if (commit.message == null) {
					await commit.ensureFullDetails();
				}
			} else {
				commit = await Container.instance.git.getCommit(ref.repoPath, ref.ref);
				if (commit == null) return;
			}

			const message = commit.message ?? commit.summary;
			await env.clipboard.writeText(message);
		}

		export async function openAllChanges(commit: GitCommit, options?: TextDocumentShowOptions): Promise<void>;
		export async function openAllChanges(
			files: GitFile[],
			refs: { repoPath: string; ref1: string; ref2: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openAllChanges(
			commitOrFiles: GitCommit | GitFile[],
			refsOrOptions: { repoPath: string; ref1: string; ref2: string } | TextDocumentShowOptions | undefined,
			options?: TextDocumentShowOptions,
		) {
			let files;
			let refs;
			if (isCommit(commitOrFiles)) {
				if (commitOrFiles.files == null) {
					await commitOrFiles.ensureFullDetails();
				}

				files = commitOrFiles.files ?? [];
				refs = {
					repoPath: commitOrFiles.repoPath,
					// Don't need to worry about verifying the previous sha, as the DiffWith command will
					ref1: commitOrFiles.unresolvedPreviousSha,
					ref2: commitOrFiles.sha,
				};

				options = refsOrOptions as TextDocumentShowOptions | undefined;
			} else {
				files = commitOrFiles;
				refs = refsOrOptions as { repoPath: string; ref1: string; ref2: string };
			}

			if (files.length > 10) {
				const result = await window.showWarningMessage(
					`Are you sure you want to open the changes for all ${files.length} files?`,
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

		export async function openAllChangesWithDiffTool(commit: GitCommit): Promise<void>;
		export async function openAllChangesWithDiffTool(
			files: GitFile[],
			ref: { repoPath: string; ref: string },
		): Promise<void>;
		export async function openAllChangesWithDiffTool(
			commitOrFiles: GitCommit | GitFile[],
			ref?: { repoPath: string; ref: string },
		) {
			let files;
			if (isCommit(commitOrFiles)) {
				if (commitOrFiles.files == null) {
					await commitOrFiles.ensureFullDetails();
				}

				files = commitOrFiles.files ?? [];
				ref = {
					repoPath: commitOrFiles.repoPath,
					ref: commitOrFiles.sha,
				};
			} else {
				files = commitOrFiles;
			}

			if (files.length > 10) {
				const result = await window.showWarningMessage(
					`Are you sure you want to open the changes for all ${files.length} files?`,
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
			commit: GitCommit,
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openAllChangesWithWorking(
			files: GitFile[],
			ref: { repoPath: string; ref: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openAllChangesWithWorking(
			commitOrFiles: GitCommit | GitFile[],
			refOrOptions: { repoPath: string; ref: string } | TextDocumentShowOptions | undefined,
			options?: TextDocumentShowOptions,
		) {
			let files;
			let ref;
			if (isCommit(commitOrFiles)) {
				if (commitOrFiles.files == null) {
					await commitOrFiles.ensureFullDetails();
				}

				files = commitOrFiles.files ?? [];
				ref = {
					repoPath: commitOrFiles.repoPath,
					ref: commitOrFiles.sha,
				};

				options = refOrOptions as TextDocumentShowOptions | undefined;
			} else {
				files = commitOrFiles;
				ref = refOrOptions as { repoPath: string; ref: string };
			}

			if (files.length > 10) {
				const result = await window.showWarningMessage(
					`Are you sure you want to open the changes for all ${files.length} files?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			options = { preserveFocus: true, preview: false, ...options };

			for (const file of files) {
				await openChangesWithWorking(file, ref, options);
			}
		}

		export async function openChanges(
			file: string | GitFile,
			commit: GitCommit,
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChanges(
			file: GitFile,
			refs: { repoPath: string; ref1: string; ref2: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChanges(
			file: string | GitFile,
			commitOrRefs: GitCommit | { repoPath: string; ref1: string; ref2: string },
			options?: TextDocumentShowOptions,
		) {
			if (typeof file === 'string') {
				if (!isCommit(commitOrRefs)) throw new Error('Invalid arguments');

				const f = await commitOrRefs.findFile(file);
				if (f == null) throw new Error('Invalid arguments');

				file = f;
			}

			options = { preserveFocus: true, preview: false, ...options };

			if (file.status === 'A') {
				if (!isCommit(commitOrRefs)) return;

				const commit = await commitOrRefs.getCommitForFile(file);
				void executeCommand<DiffWithPreviousCommandArgs>(Commands.DiffWithPrevious, {
					commit: commit,
					showOptions: options,
				});
			}

			const refs = isCommit(commitOrRefs)
				? {
						repoPath: commitOrRefs.repoPath,
						// Don't need to worry about verifying the previous sha, as the DiffWith command will
						ref1: commitOrRefs.unresolvedPreviousSha,
						ref2: commitOrRefs.sha,
				  }
				: commitOrRefs;

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

		export function openChangesWithDiffTool(
			file: string | GitFile,
			commit: GitCommit,
			tool?: string,
		): Promise<void>;
		export function openChangesWithDiffTool(
			file: GitFile,
			ref: { repoPath: string; ref: string },
			tool?: string,
		): Promise<void>;
		export async function openChangesWithDiffTool(
			file: string | GitFile,
			commitOrRef: GitCommit | { repoPath: string; ref: string },
			tool?: string,
		) {
			if (typeof file === 'string') {
				if (!isCommit(commitOrRef)) throw new Error('Invalid arguments');

				const f = await commitOrRef.findFile(file);
				if (f == null) throw new Error('Invalid arguments');

				file = f;
			}

			return Container.instance.git.openDiffTool(
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
			commit: GitCommit,
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChangesWithWorking(
			file: GitFile,
			ref: { repoPath: string; ref: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChangesWithWorking(
			file: string | GitFile,
			commitOrRef: GitCommit | { repoPath: string; ref: string },
			options?: TextDocumentShowOptions,
		) {
			if (typeof file === 'string') {
				if (!isCommit(commitOrRef)) throw new Error('Invalid arguments');

				const f = await commitOrRef.findFile(file);
				if (f == null) throw new Error('Invalid arguments');

				file = f;
			}

			if (file.status === 'D') return;

			let ref;
			if (isCommit(commitOrRef)) {
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
			repoPath: string,
			ref: string,
			ref2: string | undefined,
			tool?: string,
		): Promise<void> {
			return Container.instance.git.openDirectoryCompare(repoPath, ref, ref2, tool);
		}

		export async function openDirectoryCompareWithPrevious(
			ref: { repoPath: string; ref: string } | GitCommit,
		): Promise<void> {
			return openDirectoryCompare(ref.repoPath, ref.ref, `${ref.ref}^`);
		}

		export async function openDirectoryCompareWithWorking(
			ref: { repoPath: string; ref: string } | GitCommit,
		): Promise<void> {
			return openDirectoryCompare(ref.repoPath, ref.ref, undefined);
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
				// If the file is `?` (untracked), then this must be an untracked file in a stash, so just return
				if (typeof fileOrUri !== 'string' && fileOrUri.status === '?') return;
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
			commit: GitCommit,
			options?: TextDocumentShowOptions & { annotationType?: FileAnnotationType; line?: number },
		): Promise<void>;
		export async function openFileAtRevision(
			fileOrRevisionUri: string | GitFile | Uri,
			commitOrOptions?: GitCommit | TextDocumentShowOptions,
			options?: TextDocumentShowOptions & { annotationType?: FileAnnotationType; line?: number },
		): Promise<void> {
			let uri;
			if (fileOrRevisionUri instanceof Uri) {
				if (isCommit(commitOrOptions)) throw new Error('Invalid arguments');

				uri = fileOrRevisionUri;
				options = commitOrOptions;
			} else {
				if (!isCommit(commitOrOptions)) throw new Error('Invalid arguments');

				const commit = commitOrOptions;

				let file;
				if (typeof fileOrRevisionUri === 'string') {
					const f = await commit.findFile(fileOrRevisionUri);
					if (f == null) throw new Error('Invalid arguments');

					file = f;
				} else {
					file = fileOrRevisionUri;
				}

				uri = Container.instance.git.getRevisionUri(
					file.status === 'D' ? (await commit.getPreviousSha()) ?? GitRevision.deletedOrMissing : commit.sha,
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
				void (await Container.instance.fileAnnotations.show(editor, annotationType, {
					selection: { line: line },
				}));
			}
		}

		export async function openFileOnRemote(uri: Uri): Promise<void>;
		export async function openFileOnRemote(file: string | GitFile, ref: GitRevisionReference): Promise<void>;
		export async function openFileOnRemote(
			fileOrUri: string | GitFile | Uri,
			ref?: GitRevisionReference,
		): Promise<void> {
			let uri;
			if (fileOrUri instanceof Uri) {
				uri = fileOrUri;
			} else {
				if (ref == null) throw new Error('Invalid arguments');

				uri = GitUri.fromFile(fileOrUri, ref.repoPath, ref.ref);
				// If the file is `?` (untracked), then this must be an untracked file in a stash, so just return
				if (typeof fileOrUri !== 'string' && fileOrUri.status === '?') return;
			}

			void (await executeCommand<[Uri, OpenFileOnRemoteCommandArgs]>(Commands.OpenFileOnRemote, uri, {
				sha: ref?.ref,
			}));
		}

		export async function openFiles(commit: GitCommit): Promise<void>;
		export async function openFiles(files: GitFile[], repoPath: string, ref: string): Promise<void>;
		export async function openFiles(
			commitOrFiles: GitCommit | GitFile[],
			repoPath?: string,
			ref?: string,
		): Promise<void> {
			let files;
			if (isCommit(commitOrFiles)) {
				if (commitOrFiles.files == null) {
					await commitOrFiles.ensureFullDetails();
				}

				files = commitOrFiles.files ?? [];
				repoPath = commitOrFiles.repoPath;
				ref = commitOrFiles.sha;
			} else {
				files = commitOrFiles;
			}

			if (files.length > 10) {
				const result = await window.showWarningMessage(
					`Are you sure you want to open all ${files.length} files?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			const uris: Uri[] = (
				await Promise.all(
					files.map(file =>
						Container.instance.git.getWorkingUri(repoPath!, GitUri.fromFile(file, repoPath!, ref)),
					),
				)
			).filter(<T>(u?: T): u is T => Boolean(u));
			findOrOpenEditors(uris);
		}

		export async function openFilesAtRevision(commit: GitCommit): Promise<void>;
		export async function openFilesAtRevision(
			files: GitFile[],
			repoPath: string,
			ref1: string,
			ref2: string,
		): Promise<void>;
		export async function openFilesAtRevision(
			commitOrFiles: GitCommit | GitFile[],
			repoPath?: string,
			ref1?: string,
			ref2?: string,
		): Promise<void> {
			let files;
			if (isCommit(commitOrFiles)) {
				if (commitOrFiles.files == null) {
					await commitOrFiles.ensureFullDetails();
				}

				files = commitOrFiles.files ?? [];
				repoPath = commitOrFiles.repoPath;
				ref1 = commitOrFiles.sha;
				ref2 = await commitOrFiles.getPreviousSha();
			} else {
				files = commitOrFiles;
			}

			if (files.length > 10) {
				const result = await window.showWarningMessage(
					`Are you sure you want to open all ${files.length} file revisions?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			findOrOpenEditors(
				files.map(file =>
					Container.instance.git.getRevisionUri(file.status === 'D' ? ref2! : ref1!, file, repoPath!),
				),
			);
		}

		export async function restoreFile(file: string | GitFile, revision: GitRevisionReference) {
			let path;
			let ref;
			if (typeof file === 'string') {
				path = file;
				ref = revision.ref;
			} else {
				path = file.path;
				ref =
					file.status === `?` ? `${revision.ref}^3` : file.status === 'D' ? `${revision.ref}^` : revision.ref;
			}

			await Container.instance.git.checkout(revision.repoPath, ref, { path: path });
		}

		export async function reveal(
			commit: GitRevisionReference,
			options?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			},
		) {
			const views = [
				Container.instance.commitsView,
				Container.instance.branchesView,
				Container.instance.remotesView,
			];

			// TODO@eamodio stop duplicate notifications

			for (const view of views) {
				const node = view.canReveal
					? await view.revealCommit(commit, options)
					: await Container.instance.repositoriesView.revealCommit(commit, options);
				if (node != null) return node;
			}

			void views[0].show({ preserveFocus: !options?.focus });
			return undefined;
		}

		export async function showDetailsQuickPick(commit: GitCommit, uri?: Uri): Promise<void>;
		export async function showDetailsQuickPick(commit: GitCommit, file?: string | GitFile): Promise<void>;
		export async function showDetailsQuickPick(
			commit: GitCommit,
			fileOrUri?: string | GitFile | Uri,
		): Promise<void> {
			if (fileOrUri == null) {
				void (await executeCommand<ShowQuickCommitCommandArgs>(Commands.ShowQuickCommit, { commit: commit }));
				return;
			}

			let uri;
			if (fileOrUri instanceof Uri) {
				uri = fileOrUri;
			} else {
				uri = GitUri.fromFile(fileOrUri, commit.repoPath, commit.ref);
			}

			void (await executeCommand<[Uri, ShowQuickCommitFileCommandArgs]>(Commands.ShowQuickCommitFile, uri, {
				sha: commit.sha,
			}));
		}

		export function showDetailsView(
			commit: GitRevisionReference | GitCommit,
			options?: { pin?: boolean; preserveFocus?: boolean; preserveVisibility?: boolean },
		): Promise<void> {
			return Container.instance.commitDetailsView.show({ ...options, commit: commit });
		}

		export async function showInCommitGraph(
			commit: GitRevisionReference | GitCommit,
			options?: { preserveFocus?: boolean },
		): Promise<void> {
			void (await executeCommand<ShowInCommitGraphCommandArgs>(Commands.ShowInCommitGraph, {
				ref: GitReference.fromRevision(commit),
				preserveFocus: options?.preserveFocus,
			}));
		}
	}

	export namespace Contributor {
		export function addAuthors(repo?: string | Repository, contributors?: GitContributor | GitContributor[]) {
			return executeGitCommand({
				command: 'co-authors',
				state: { repo: repo, contributors: contributors },
			});
		}

		export async function reveal(
			contributor: GitContributor,
			options?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			},
		) {
			const view = Container.instance.contributorsView;
			const node = view.canReveal
				? await view.revealContributor(contributor, options)
				: await Container.instance.repositoriesView.revealContributor(contributor, options);
			if (node == null) {
				void view.show({ preserveFocus: !options?.focus });
			}
			return node;
		}
	}

	export namespace Remote {
		export function add(
			repo?: string | Repository,
			name?: string,
			url?: string,
			options?: { confirm?: boolean; fetch?: boolean; reveal?: boolean },
		) {
			return executeGitCommand({
				command: 'remote',
				confirm: options?.confirm,
				state: {
					repo: repo,
					subcommand: 'add',
					name: name,
					url: url,
					flags: options?.fetch ? ['-f'] : undefined,
					reveal: options?.reveal,
				},
			});
		}

		export async function fetch(repo: string | Repository, remote: string) {
			if (typeof repo === 'string') {
				const r = Container.instance.git.getRepository(repo);
				if (r == null) return;

				repo = r;
			}

			await repo.fetch({ remote: remote });
		}

		export async function prune(repo: string | Repository, remote: string) {
			return executeGitCommand({
				command: 'remote',
				state: { repo: repo, subcommand: 'prune', remote: remote },
			});
		}

		export async function remove(repo: string | Repository, remote: string) {
			return executeGitCommand({
				command: 'remote',
				state: { repo: repo, subcommand: 'remove', remote: remote },
			});
		}

		export async function reveal(
			remote: GitRemote | undefined,
			options?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			},
		) {
			const view = Container.instance.remotesView;
			const node =
				remote != null
					? view.canReveal
						? await view.revealRemote(remote, options)
						: await Container.instance.repositoriesView.revealRemote(remote, options)
					: undefined;
			if (node == null) {
				void view.show({ preserveFocus: !options?.focus });
			}
			return node;
		}
	}

	export namespace Repo {
		export async function reveal(
			repoPath: string,
			view?: ViewsWithRepositoryFolders,
			options?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			},
		) {
			const node = view?.canReveal
				? await view.revealRepository(repoPath, options)
				: await Container.instance.repositoriesView.revealRepository(repoPath, options);
			if (node == null) {
				void (view ?? Container.instance.repositoriesView).show({ preserveFocus: !options?.focus });
			}
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
			const view = Container.instance.stashesView;
			const node = view.canReveal
				? await view.revealStash(stash, options)
				: await Container.instance.repositoriesView.revealStash(stash, options);
			if (node == null) {
				void view.show({ preserveFocus: !options?.focus });
			}
			return node;
		}

		export function showDetailsView(
			stash: GitStashReference | GitStashCommit,
			options?: { pin?: boolean; preserveFocus?: boolean },
		): Promise<void> {
			return Container.instance.commitDetailsView.show({ ...options, commit: stash });
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
			const view = Container.instance.tagsView;
			const node = view.canReveal
				? await view.revealTag(tag, options)
				: await Container.instance.repositoriesView.revealTag(tag, options);
			if (node == null) {
				void view.show({ preserveFocus: !options?.focus });
			}
			return node;
		}
	}

	export namespace Worktree {
		export function create(
			repo?: string | Repository,
			uri?: Uri,
			ref?: GitReference,
			options?: { reveal?: boolean },
		) {
			return executeGitCommand({
				command: 'worktree',
				state: { subcommand: 'create', repo: repo, uri: uri, reference: ref, reveal: options?.reveal },
			});
		}

		export function open(worktree: GitWorktree, options?: { location?: OpenWorkspaceLocation }) {
			return openWorkspace(worktree.uri, options);
		}

		export function remove(repo?: string | Repository, uri?: Uri) {
			return executeGitCommand({
				command: 'worktree',
				state: { subcommand: 'delete', repo: repo, uris: ensure(uri) },
			});
		}

		export async function reveal(
			worktree: GitWorktree | undefined,
			options?: { select?: boolean; focus?: boolean; expand?: boolean | number },
		) {
			const view = Container.instance.worktreesView;
			const node =
				worktree != null
					? view.canReveal
						? await view.revealWorktree(worktree, options)
						: await Container.instance.repositoriesView.revealWorktree(worktree, options)
					: undefined;
			if (node == null) {
				void view.show({ preserveFocus: !options?.focus });
			}
			return node;
		}

		export async function revealInFileExplorer(worktree: GitWorktree) {
			void (await executeCoreCommand(CoreCommands.RevealInFileExplorer, worktree.uri));
		}
	}
}

import type { TextDocumentShowOptions, TextEditor } from 'vscode';
import { env, Range, Uri, window, workspace } from 'vscode';
import type { DiffWithCommandArgs } from '../../commands/diffWith';
import type { DiffWithPreviousCommandArgs } from '../../commands/diffWithPrevious';
import type { DiffWithWorkingCommandArgs } from '../../commands/diffWithWorking';
import type { OpenFileOnRemoteCommandArgs } from '../../commands/openFileOnRemote';
import type { OpenOnlyChangedFilesCommandArgs } from '../../commands/openOnlyChangedFiles';
import type { OpenWorkingFileCommandArgs } from '../../commands/openWorkingFile';
import type { ShowQuickCommitCommandArgs } from '../../commands/showQuickCommit';
import type { ShowQuickCommitFileCommandArgs } from '../../commands/showQuickCommitFile';
import type { FileAnnotationType } from '../../config';
import { GlyphChars } from '../../constants';
import { GlCommand } from '../../constants.commands';
import { Container } from '../../container';
import { showRevisionFilesPicker } from '../../quickpicks/revisionFilesPicker';
import { getSettledValue } from '../../system/promise';
import { executeCommand, executeCoreGitCommand, executeEditorCommand } from '../../system/vscode/command';
import { configuration } from '../../system/vscode/configuration';
import { findOrOpenEditor, findOrOpenEditors, openChangesEditor } from '../../system/vscode/utils';
import type { ShowInCommitGraphCommandArgs } from '../../webviews/plus/graph/protocol';
import { GitUri } from '../gitUri';
import type { GitCommit } from '../models/commit';
import { isCommit } from '../models/commit';
import type { GitFile } from '../models/file';
import { GitFileChange } from '../models/file';
import type { GitRevisionReference } from '../models/reference';
import { createReference, getReferenceFromRevision, getReferenceLabel } from '../models/reference.utils';
import { deletedOrMissing } from '../models/revision';
import { createRevisionRange, isUncommitted, isUncommittedStaged, shortenRevision } from '../models/revision.utils';
import { getAheadBehindFilesQuery } from '../queryResults';

export type Ref = { repoPath: string; ref: string };
export type RefRange = { repoPath: string; rhs: string; lhs: string };

export interface FilesComparison {
	files: GitFile[];
	repoPath: string;
	ref1: string;
	ref2: string;
	title?: string;
}

const filesOpenThreshold = 10;
const filesOpenDiffsThreshold = 10;
const filesOpenMultiDiffThreshold = 50;

export async function applyChanges(file: string | GitFile, rev1: GitRevisionReference, rev2?: GitRevisionReference) {
	let create = false;
	let ref1 = rev1.ref;
	let ref2 = rev2?.ref;
	if (typeof file !== 'string') {
		// If the file is `?` (untracked), then this must be a stash, so get the ^3 commit to access the untracked file
		if (file.status === '?') {
			ref1 = `${ref1}^3`;
			create = true;
		} else if (file.status === 'A') {
			create = true;
		} else if (file.status === 'D') {
			// If the file is deleted, check to see if it exists, if so, apply the delete, otherwise restore it from the previous commit
			const uri = GitUri.fromFile(file, rev1.repoPath);
			try {
				await workspace.fs.stat(uri);
			} catch {
				create = true;

				ref2 = ref1;
				ref1 = `${ref1}^`;
			}
		}
	}

	if (create) {
		const uri = GitUri.fromFile(file, rev1.repoPath);
		await Container.instance.git.applyChangesToWorkingFile(uri, ref1, ref2);
		await openFile(uri, { preserveFocus: true, preview: false });
	} else {
		// Open the working file to ensure undo will work
		await openFile(file, rev1, { preserveFocus: true, preview: false });
		await Container.instance.git.applyChangesToWorkingFile(GitUri.fromFile(file, rev1.repoPath, ref1), ref1, ref2);
	}
}

export async function copyIdToClipboard(ref: Ref | GitCommit) {
	await env.clipboard.writeText(ref.ref);
}

export async function copyMessageToClipboard(ref: Ref | GitCommit): Promise<void> {
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

export async function openAllChanges(
	commit: GitCommit,
	options?: TextDocumentShowOptions & { title?: string },
): Promise<void>;
export async function openAllChanges(
	files: GitFile[],
	refs: RefRange,
	options?: TextDocumentShowOptions & { title?: string },
): Promise<void>;
export async function openAllChanges(
	commitOrFiles: GitCommit | GitFile[],
	refsOrOptions: RefRange | (TextDocumentShowOptions & { title?: string }) | undefined,
	maybeOptions?: TextDocumentShowOptions & { title?: string },
): Promise<void> {
	if (isCommit(commitOrFiles)) {
		if (configuration.get('views.openChangesInMultiDiffEditor')) {
			return openAllChangesInChangesEditor(commitOrFiles, refsOrOptions as TextDocumentShowOptions | undefined);
		}
		return openAllChangesIndividually(commitOrFiles, refsOrOptions as TextDocumentShowOptions | undefined);
	}

	if (configuration.get('views.openChangesInMultiDiffEditor')) {
		return openAllChangesInChangesEditor(commitOrFiles, refsOrOptions as RefRange, maybeOptions);
	}
	return openAllChangesIndividually(commitOrFiles, refsOrOptions as RefRange, maybeOptions);
}

export async function openAllChangesIndividually(commit: GitCommit, options?: TextDocumentShowOptions): Promise<void>;
export async function openAllChangesIndividually(
	files: GitFile[],
	refs: RefRange,
	options?: TextDocumentShowOptions,
): Promise<void>;
export async function openAllChangesIndividually(
	commitOrFiles: GitCommit | GitFile[],
	refsOrOptions: RefRange | TextDocumentShowOptions | undefined,
	maybeOptions?: TextDocumentShowOptions,
): Promise<void> {
	let { files, refs, options } = await getChangesRefsArgs(commitOrFiles, refsOrOptions, maybeOptions);

	if (
		!(await confirmOpenIfNeeded(files, {
			message: `Are you sure you want to open the changes for each of the ${files.length} files?`,
			confirmButton: 'Open Changes',
			threshold: filesOpenDiffsThreshold,
		}))
	) {
		return;
	}

	options = { preserveFocus: true, preview: false, ...options };

	for (const file of files) {
		await openChanges(file, refs, options);
	}
}

export async function openAllChangesInChangesEditor(
	commit: GitCommit,
	options?: TextDocumentShowOptions & { title?: string },
): Promise<void>;
export async function openAllChangesInChangesEditor(
	files: GitFile[],
	refs: RefRange,
	options?: TextDocumentShowOptions & { title?: string },
): Promise<void>;
export async function openAllChangesInChangesEditor(
	commitOrFiles: GitCommit | GitFile[],
	refsOrOptions: RefRange | (TextDocumentShowOptions & { title?: string }) | undefined,
	maybeOptions?: TextDocumentShowOptions & { title?: string },
): Promise<void> {
	if (!configuration.getCore('multiDiffEditor.experimental.enabled')) {
		void window.showErrorMessage(
			`Enable the multi-diff editor by setting 'multiDiffEditor.experimental.enabled' to use this command`,
		);
		return;
	}

	let title;
	if (maybeOptions != null) {
		({ title, ...maybeOptions } = maybeOptions);
	}

	const { commit, files, refs, options } = await getChangesRefsArgs(commitOrFiles, refsOrOptions, maybeOptions);

	if (title == null) {
		if (commit != null) {
			title = `Changes in ${shortenRevision(refs.rhs, { strings: { working: 'Working Tree' } })}`;
		} else {
			title = `Changes between ${shortenRevision(refs.lhs, { strings: { working: 'Working Tree' } })} ${
				GlyphChars.ArrowLeftRightLong
			} ${shortenRevision(refs.rhs, { strings: { working: 'Working Tree' } })}`;
		}
	}

	if (
		!(await confirmOpenIfNeeded(files, {
			message: `Are you sure you want to view the changes for all ${files.length} files?`,
			confirmButton: 'View All Changes',
			threshold: filesOpenMultiDiffThreshold,
		}))
	) {
		return;
	}

	const { git } = Container.instance;

	const resources: Parameters<typeof openChangesEditor>[0] = [];
	for (const file of files) {
		let rhs = file.status === 'D' ? undefined : (await git.getBestRevisionUri(refs.repoPath, file.path, refs.rhs))!;
		if (refs.rhs === '') {
			if (rhs != null) {
				rhs = await git.getWorkingUri(refs.repoPath, rhs);
			} else {
				rhs = Uri.from({
					scheme: 'untitled',
					authority: '',
					path: git.getAbsoluteUri(file.path, refs.repoPath).fsPath,
				});
			}
		}

		const lhs =
			file.status === 'A'
				? undefined
				: (await git.getBestRevisionUri(refs.repoPath, file.originalPath ?? file.path, refs.lhs))!;

		const uri = (file.status === 'D' ? lhs : rhs) ?? git.getAbsoluteUri(file.path, refs.repoPath);
		if (rhs?.scheme === 'untitled' && lhs == null) continue;

		resources.push({ uri: uri, lhs: lhs, rhs: rhs });
	}

	await openChangesEditor(resources, title, options);
}

export async function openAllChangesWithDiffTool(commit: GitCommit): Promise<void>;
export async function openAllChangesWithDiffTool(files: GitFile[], ref: Ref): Promise<void>;
export async function openAllChangesWithDiffTool(commitOrFiles: GitCommit | GitFile[], ref?: Ref) {
	const { files } = await getChangesRefArgs(commitOrFiles, ref);

	if (
		!(await confirmOpenIfNeeded(files, {
			message: `Are you sure you want to externally open the changes for each of the ${files.length} files?`,
			confirmButton: 'Open Changes',
			threshold: filesOpenDiffsThreshold,
		}))
	) {
		return;
	}

	for (const file of files) {
		void openChangesWithDiffTool(file, ref!);
	}
}

export async function openAllChangesWithWorking(
	commit: GitCommit,
	options?: TextDocumentShowOptions & { title?: string },
): Promise<void>;
export async function openAllChangesWithWorking(
	files: GitFile[],
	ref: Ref,
	options?: TextDocumentShowOptions & { title?: string },
): Promise<void>;
export async function openAllChangesWithWorking(
	commitOrFiles: GitCommit | GitFile[],
	refOrOptions: Ref | (TextDocumentShowOptions & { title?: string }) | undefined,
	maybeOptions?: TextDocumentShowOptions & { title?: string },
) {
	if (isCommit(commitOrFiles)) {
		if (configuration.get('views.openChangesInMultiDiffEditor')) {
			return openAllChangesInChangesEditor(commitOrFiles, refOrOptions as TextDocumentShowOptions | undefined);
		}
		return openAllChangesWithWorkingIndividually(
			commitOrFiles,
			refOrOptions as TextDocumentShowOptions | undefined,
		);
	}

	if (configuration.get('views.openChangesInMultiDiffEditor')) {
		return openAllChangesInChangesEditor(
			commitOrFiles,
			{
				repoPath: (refOrOptions as Ref).repoPath,
				lhs: (refOrOptions as Ref).ref,
				rhs: '',
			},
			maybeOptions,
		);
	}
	return openAllChangesWithWorkingIndividually(commitOrFiles, refOrOptions as Ref, maybeOptions);
}

export async function openAllChangesWithWorkingIndividually(
	commit: GitCommit,
	options?: TextDocumentShowOptions,
): Promise<void>;
export async function openAllChangesWithWorkingIndividually(
	files: GitFile[],
	ref: Ref,
	options?: TextDocumentShowOptions,
): Promise<void>;
export async function openAllChangesWithWorkingIndividually(
	commitOrFiles: GitCommit | GitFile[],
	refOrOptions: Ref | TextDocumentShowOptions | undefined,
	maybeOptions?: TextDocumentShowOptions,
) {
	let { files, ref, options } = await getChangesRefArgs(commitOrFiles, refOrOptions, maybeOptions);

	if (
		!(await confirmOpenIfNeeded(files, {
			message: `Are you sure you want to open the changes for each of the ${files.length} files?`,
			confirmButton: 'Open Changes',
			threshold: filesOpenDiffsThreshold,
		}))
	) {
		return;
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
	refs: RefRange,
	options?: TextDocumentShowOptions & { lhsTitle?: string; rhsTitle?: string },
): Promise<void>;
export async function openChanges(
	file: GitFile,
	commitOrRefs: GitCommit | RefRange,
	options?: TextDocumentShowOptions & { lhsTitle?: string; rhsTitle?: string },
): Promise<void>;
export async function openChanges(
	file: string | GitFile,
	commitOrRefs: GitCommit | RefRange,
	options?: TextDocumentShowOptions & { lhsTitle?: string; rhsTitle?: string },
) {
	const hasCommit = isCommit(commitOrRefs);

	if (typeof file === 'string') {
		if (!hasCommit) throw new Error('Invalid arguments');

		const f = await commitOrRefs.findFile(file);
		if (f == null) throw new Error('Invalid arguments');

		file = f;
	} else if (!hasCommit && commitOrRefs.rhs === '') {
		return openChangesWithWorking(file, { repoPath: commitOrRefs.repoPath, ref: commitOrRefs.lhs }, options);
	}

	options = { preserveFocus: true, preview: false, ...options };

	if (file.status === 'A' && hasCommit) {
		const commit = await commitOrRefs.getCommitForFile(file);
		void executeCommand<DiffWithPreviousCommandArgs>(GlCommand.DiffWithPrevious, {
			commit: commit,
			showOptions: options,
		});

		return;
	}

	const refs: RefRange = hasCommit
		? {
				repoPath: commitOrRefs.repoPath,
				rhs: commitOrRefs.sha,
				// Don't need to worry about verifying the previous sha, as the DiffWith command will
				lhs: commitOrRefs.unresolvedPreviousSha,
		  }
		: commitOrRefs;

	const rhsUri = GitUri.fromFile(file, refs.repoPath);
	const lhsUri =
		file.status === 'R' || file.status === 'C' ? GitUri.fromFile(file, refs.repoPath, refs.lhs, true) : rhsUri;

	void (await executeCommand<DiffWithCommandArgs>(GlCommand.DiffWith, {
		repoPath: refs.repoPath,
		lhs: { uri: lhsUri, sha: refs.lhs, title: options?.lhsTitle },
		rhs: { uri: rhsUri, sha: refs.rhs, title: options?.rhsTitle },
		showOptions: options,
	}));
}

export function openChangesWithDiffTool(file: string | GitFile, commit: GitCommit, tool?: string): Promise<void>;
export function openChangesWithDiffTool(file: GitFile, ref: Ref, tool?: string): Promise<void>;
export async function openChangesWithDiffTool(file: string | GitFile, commitOrRef: GitCommit | Ref, tool?: string) {
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
			ref1: isUncommitted(commitOrRef.ref) ? '' : `${commitOrRef.ref}^`,
			ref2: isUncommitted(commitOrRef.ref) ? '' : commitOrRef.ref,
			staged: isUncommittedStaged(commitOrRef.ref) || file.indexStatus != null,
			tool: tool,
		},
	);
}

export async function openChangesWithWorking(
	file: string | GitFile,
	commit: GitCommit,
	options?: TextDocumentShowOptions & { lhsTitle?: string },
): Promise<void>;
export async function openChangesWithWorking(
	file: GitFile,
	ref: Ref,
	options?: TextDocumentShowOptions & { lhsTitle?: string },
): Promise<void>;
export async function openChangesWithWorking(
	file: string | GitFile,
	commitOrRef: GitCommit | Ref,
	options?: TextDocumentShowOptions & { lhsTitle?: string },
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

	void (await executeEditorCommand<DiffWithWorkingCommandArgs>(GlCommand.DiffWithWorking, undefined, {
		uri: GitUri.fromFile(file, ref.repoPath, ref.ref),
		showOptions: options,
		lhsTitle: options?.lhsTitle,
	}));
}

export async function openComparisonChanges(
	container: Container,
	refs: RefRange,
	options?: TextDocumentShowOptions & { title?: string },
): Promise<void> {
	refs.lhs = refs.lhs || 'HEAD';
	refs.rhs = refs.rhs || 'HEAD';

	const { files } = await getAheadBehindFilesQuery(
		container,
		refs.repoPath,
		createRevisionRange(refs.lhs, refs.rhs, '...'),
		refs.rhs === '',
	);

	await openAllChangesInChangesEditor(files ?? [], refs, options);
}

export async function openDirectoryCompare(
	repoPath: string,
	ref: string,
	ref2: string | undefined,
	tool?: string,
): Promise<void> {
	return Container.instance.git.openDirectoryCompare(repoPath, ref, ref2, tool);
}

export async function openDirectoryCompareWithPrevious(ref: Ref | GitCommit): Promise<void> {
	return openDirectoryCompare(ref.repoPath, ref.ref, `${ref.ref}^`);
}

export async function openDirectoryCompareWithWorking(ref: Ref | GitCommit): Promise<void> {
	return openDirectoryCompare(ref.repoPath, ref.ref, undefined);
}

export async function openFolderCompare(
	pathOrUri: string | Uri,
	refs: RefRange,
	options?: TextDocumentShowOptions,
): Promise<void> {
	const { git } = Container.instance;

	let comparison;
	if (refs.lhs === '') {
		debugger;
		throw new Error('Cannot get files for comparisons of a ref with working tree');
	} else if (refs.rhs === '') {
		comparison = refs.lhs;
	} else {
		comparison = `${refs.lhs}..${refs.rhs}`;
	}

	const relativePath = git.getRelativePath(pathOrUri, refs.repoPath);

	const files = await git.getDiffStatus(refs.repoPath, comparison, undefined, { path: relativePath });
	if (files == null) {
		void window.showWarningMessage(
			`No changes in '${relativePath}' between ${shortenRevision(refs.lhs, {
				strings: { working: 'Working Tree' },
			})} ${GlyphChars.ArrowLeftRightLong} ${shortenRevision(refs.rhs, {
				strings: { working: 'Working Tree' },
			})}`,
		);
		return;
	}

	const title = `Changes in ${relativePath} between ${shortenRevision(refs.lhs, {
		strings: { working: 'Working Tree' },
	})} ${GlyphChars.ArrowLeftRightLong} ${shortenRevision(refs.rhs, { strings: { working: 'Working Tree' } })}`;

	return openAllChangesInChangesEditor(files, refs, { ...options, title: title });
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

	void (await executeEditorCommand<OpenWorkingFileCommandArgs>(GlCommand.OpenWorkingFile, undefined, {
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
	let uri: Uri;
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
			file.status === 'D' ? (await commit.getPreviousSha()) ?? deletedOrMissing : commit.sha,
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

	const gitUri = await GitUri.fromUri(uri);

	let editor: TextEditor | undefined;
	try {
		editor = await findOrOpenEditor(uri, { throwOnError: true, ...opts });
	} catch (ex) {
		if (!ex?.message?.includes('Unable to resolve nonexistent file')) {
			void window.showErrorMessage(`Unable to open '${gitUri.relativePath}' in revision '${gitUri.sha}'`);
			return;
		}

		const pickedUri = await showRevisionFilesPicker(
			Container.instance,
			createReference(gitUri.sha!, gitUri.repoPath!),
			{
				ignoreFocusOut: true,
				initialPath: gitUri.relativePath,
				title: `Open File at Revision \u2022 Unable to open '${gitUri.relativePath}'`,
				placeholder: 'Choose a file revision to open',
				keyboard: {
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (_key, uri) => {
						await findOrOpenEditor(uri, { ...opts, preserveFocus: true, preview: true });
					},
				},
			},
		);
		if (pickedUri == null) return;

		editor = await findOrOpenEditor(pickedUri, opts);
	}

	if (annotationType != null && editor != null) {
		void (await Container.instance.fileAnnotations.show(editor, annotationType, {
			selection: { line: line },
		}));
	}
}

export async function openFileOnRemote(uri: Uri): Promise<void>;
export async function openFileOnRemote(file: string | GitFile, ref: GitRevisionReference): Promise<void>;
export async function openFileOnRemote(fileOrUri: string | GitFile | Uri, ref?: GitRevisionReference): Promise<void> {
	let uri;
	if (fileOrUri instanceof Uri) {
		uri = fileOrUri;
	} else {
		if (ref == null) throw new Error('Invalid arguments');

		uri = GitUri.fromFile(fileOrUri, ref.repoPath, ref.ref);
		// If the file is `?` (untracked), then this must be an untracked file in a stash, so just return
		if (typeof fileOrUri !== 'string' && fileOrUri.status === '?') return;
	}

	void (await executeCommand<[Uri, OpenFileOnRemoteCommandArgs]>(GlCommand.OpenFileOnRemote, uri, {
		sha: ref?.ref,
	}));
}

export async function openFiles(commit: GitCommit, options?: TextDocumentShowOptions): Promise<void>;
export async function openFiles(files: GitFile[], ref: Ref, options?: TextDocumentShowOptions): Promise<void>;
export async function openFiles(
	commitOrFiles: GitCommit | GitFile[],
	refOrOptions: Ref | TextDocumentShowOptions | undefined,
	maybeOptions?: TextDocumentShowOptions,
): Promise<void> {
	const { files, ref, options } = await getChangesRefArgs(commitOrFiles, refOrOptions, maybeOptions);

	if (
		!(await confirmOpenIfNeeded(files, {
			message: `Are you sure you want to open each of the ${files.length} files?`,
			confirmButton: 'Open Files',
			threshold: filesOpenThreshold,
		}))
	) {
		return;
	}

	const uris: Uri[] = (
		await Promise.all(
			files.map(file =>
				Container.instance.git.getWorkingUri(ref.repoPath, GitUri.fromFile(file, ref.repoPath, ref.ref)),
			),
		)
	).filter(<T>(u?: T): u is T => Boolean(u));
	findOrOpenEditors(uris, options);
}

export async function openFilesAtRevision(commit: GitCommit, options?: TextDocumentShowOptions): Promise<void>;
export async function openFilesAtRevision(
	files: GitFile[],
	refs: RefRange,
	options?: TextDocumentShowOptions,
): Promise<void>;
export async function openFilesAtRevision(
	commitOrFiles: GitCommit | GitFile[],
	refOrOptions: RefRange | TextDocumentShowOptions | undefined,
	maybeOptions?: TextDocumentShowOptions,
): Promise<void> {
	const { files, refs, options } = await getChangesRefsArgs(commitOrFiles, refOrOptions, maybeOptions);

	if (
		!(await confirmOpenIfNeeded(files, {
			message: `Are you sure you want to open each of the ${files.length} file revisions?`,
			confirmButton: 'Open Revisions',
			threshold: filesOpenThreshold,
		}))
	) {
		return;
	}

	findOrOpenEditors(
		files.map(file =>
			Container.instance.git.getRevisionUri(file.status === 'D' ? refs.lhs : refs.rhs, file, refs.repoPath),
		),
		options,
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
		if (file.status === 'D') {
			// If the file is deleted, check to see if it exists, if so, restore it from the previous commit, otherwise restore it from the current commit
			const uri = GitUri.fromFile(file, revision.repoPath);
			try {
				await workspace.fs.stat(uri);
				ref = `${revision.ref}^`;
			} catch {
				ref = revision.ref;
			}
		} else if (file.status === '?') {
			ref = `${revision.ref}^3`;
		} else {
			ref = revision.ref;
		}
	}

	await Container.instance.git.checkout(revision.repoPath, ref, { path: path });
}

export function reveal(
	commit: GitRevisionReference,
	options?: {
		select?: boolean;
		focus?: boolean;
		expand?: boolean | number;
	},
) {
	return Container.instance.views.revealCommit(commit, options);
}

export async function showDetailsQuickPick(commit: GitCommit, uri?: Uri): Promise<void>;
export async function showDetailsQuickPick(commit: GitCommit, file?: string | GitFile): Promise<void>;
export async function showDetailsQuickPick(commit: GitCommit, fileOrUri?: string | GitFile | Uri): Promise<void> {
	if (fileOrUri == null) {
		void (await executeCommand<ShowQuickCommitCommandArgs>(GlCommand.ShowQuickCommit, { commit: commit }));
		return;
	}

	let uri;
	if (fileOrUri instanceof Uri) {
		uri = fileOrUri;
	} else {
		uri = GitUri.fromFile(fileOrUri, commit.repoPath, commit.ref);
	}

	void (await executeCommand<[Uri, ShowQuickCommitFileCommandArgs]>(GlCommand.ShowQuickCommitFile, uri, {
		sha: commit.sha,
		commit: commit,
	}));
}

export function showDetailsView(
	commit: GitRevisionReference | GitCommit,
	options?: { pin?: boolean; preserveFocus?: boolean; preserveVisibility?: boolean },
): Promise<void> {
	const { preserveFocus, ...opts } = { ...options, commit: commit };
	return Container.instance.views.commitDetails.show({ preserveFocus: preserveFocus }, opts);
}

export function showGraphDetailsView(
	commit: GitRevisionReference | GitCommit,
	options?: { pin?: boolean; preserveFocus?: boolean; preserveVisibility?: boolean },
): Promise<void> {
	const { preserveFocus, ...opts } = { ...options, commit: commit };
	return Container.instance.views.graphDetails.show({ preserveFocus: preserveFocus }, opts);
}

export async function showInCommitGraph(
	commit: GitRevisionReference | GitCommit,
	options?: { preserveFocus?: boolean },
): Promise<void> {
	void (await executeCommand<ShowInCommitGraphCommandArgs>(GlCommand.ShowInCommitGraph, {
		ref: getReferenceFromRevision(commit),
		preserveFocus: options?.preserveFocus,
	}));
}

export async function openOnlyChangedFiles(commit: GitCommit): Promise<void>;
export async function openOnlyChangedFiles(files: GitFile[]): Promise<void>;
export async function openOnlyChangedFiles(commitOrFiles: GitCommit | GitFile[]): Promise<void> {
	let files;
	if (isCommit(commitOrFiles)) {
		if (commitOrFiles.files == null) {
			await commitOrFiles.ensureFullDetails();
		}

		files = commitOrFiles.files ?? [];
	} else {
		files = commitOrFiles.map(f => new GitFileChange(f.repoPath!, f.path, f.status, f.originalPath));
	}

	if (
		!(await confirmOpenIfNeeded(files, {
			message: `Are you sure you want to open each of the ${files.length} files?`,
			confirmButton: 'Open Files',
			threshold: 10,
		}))
	) {
		return;
	}

	void (await executeCommand<OpenOnlyChangedFilesCommandArgs>(GlCommand.OpenOnlyChangedFiles, {
		uris: files.filter(f => f.status !== 'D').map(f => f.uri),
	}));
}

export async function undoCommit(container: Container, commit: GitRevisionReference) {
	const repo = await container.git.getOrOpenScmRepository(commit.repoPath);
	const scmCommit = await repo?.getCommit('HEAD');

	if (scmCommit?.hash !== commit.ref) {
		void window.showWarningMessage(
			`Commit ${getReferenceLabel(commit, {
				capitalize: true,
				icon: false,
			})} cannot be undone, because it is no longer the most recent commit.`,
		);

		return;
	}

	const status = await container.git.getStatus(commit.repoPath);
	if (status?.files.length) {
		const confirm = { title: 'Undo Commit' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			`You have uncommitted changes in the working tree.\n\nDo you still want to undo ${getReferenceLabel(
				commit,
				{
					capitalize: false,
					icon: false,
				},
			)}?`,
			{ modal: true },
			confirm,
			cancel,
		);

		if (result !== confirm) return;
	}

	await executeCoreGitCommand('git.undoCommit', commit.repoPath);
}

async function confirmOpenIfNeeded(
	items: readonly unknown[],
	options: { cancelButton?: string; confirmButton?: string; message: string; threshold: number },
): Promise<boolean> {
	if (items.length <= options.threshold) return true;

	const confirm = { title: options.confirmButton ?? 'Open' };
	const cancel = { title: options.cancelButton ?? 'Cancel', isCloseAffordance: true };
	const result = await window.showWarningMessage(options.message, { modal: true }, confirm, cancel);
	return result === confirm;
}

async function getChangesRefArgs(
	commitOrFiles: GitCommit | GitFile[],
	refOrOptions: Ref | TextDocumentShowOptions | undefined,
	options?: TextDocumentShowOptions,
): Promise<{
	commit?: GitCommit;
	files: readonly GitFile[];
	options: TextDocumentShowOptions | undefined;
	ref: Ref;
}> {
	if (!isCommit(commitOrFiles)) {
		return {
			files: commitOrFiles,
			options: options,
			ref: refOrOptions as Ref,
		};
	}

	if (commitOrFiles.files == null) {
		await commitOrFiles.ensureFullDetails();
	}

	return {
		commit: commitOrFiles,
		files: commitOrFiles.files ?? [],
		options: refOrOptions as TextDocumentShowOptions | undefined,
		ref: {
			repoPath: commitOrFiles.repoPath,
			ref: commitOrFiles.sha,
		},
	};
}

async function getChangesRefsArgs(
	commitOrFiles: GitCommit | GitFile[],
	refsOrOptions: RefRange | TextDocumentShowOptions | undefined,
	options?: TextDocumentShowOptions,
): Promise<{
	commit?: GitCommit;
	files: readonly GitFile[];
	options: TextDocumentShowOptions | undefined;
	refs: RefRange;
}> {
	if (!isCommit(commitOrFiles)) {
		return {
			files: commitOrFiles,
			options: options,
			refs: refsOrOptions as RefRange,
		};
	}

	if (commitOrFiles.files == null) {
		await commitOrFiles.ensureFullDetails();
	}

	return {
		commit: commitOrFiles,
		files: commitOrFiles.files ?? [],
		options: refsOrOptions as TextDocumentShowOptions | undefined,
		refs: {
			repoPath: commitOrFiles.repoPath,
			rhs: commitOrFiles.sha,
			lhs:
				commitOrFiles.resolvedPreviousSha ??
				(await commitOrFiles.getPreviousSha()) ??
				commitOrFiles.unresolvedPreviousSha,
		},
	};
}

export async function getOrderedComparisonRefs(
	container: Container,
	repoPath: string,
	refA: string,
	refB: string,
): Promise<[string, string]> {
	// Check the ancestry of refA and refB to determine which is the "newer" one
	const ancestor = await container.git.isAncestorOf(repoPath, refA, refB);
	// If refB is an ancestor of refA, compare refA to refB (as refA is "newer")
	if (ancestor) return [refB, refA];

	const ancestor2 = await container.git.isAncestorOf(repoPath, refB, refA);
	// If refA is an ancestor of refB, compare refB to refA (as refB is "newer")
	if (ancestor2) return [refA, refB];

	const [commitRefAResult, commitRefBResult] = await Promise.allSettled([
		container.git.getCommit(repoPath, refA),
		container.git.getCommit(repoPath, refB),
	]);

	const commitRefA = getSettledValue(commitRefAResult);
	const commitRefB = getSettledValue(commitRefBResult);

	if (commitRefB != null && commitRefA != null && commitRefB.date > commitRefA.date) {
		// If refB is "newer", compare refB to refA
		return [refB, refA];
	}

	// If refA is "newer", compare refA to refB
	return [refA, refB];
}

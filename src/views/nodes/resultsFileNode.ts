import type { Command, TextDocumentShowOptions } from 'vscode';
import { l10n, TreeItem, TreeItemCheckboxState, TreeItemCollapsibleState, Uri } from 'vscode';
import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitRevisionReference } from '@gitlens/git/models/reference.js';
import { getGitFileStatusIcon } from '@gitlens/git/utils/fileStatus.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { joinPaths } from '@gitlens/utils/path.js';
import type { DiffWithCommandArgs } from '../../commands/diffWith.js';
import { StatusFileFormatter } from '../../git/formatters/statusFormatter.js';
import { GitUri } from '../../git/gitUri.js';
import { createCommand } from '../../system/-webview/command.js';
import { relativeDir } from '../../system/-webview/path.js';
import type { View } from '../viewBase.js';
import { getFileTooltipMarkdown } from './abstract/viewFileNode.js';
import type { ViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId } from './abstract/viewNode.js';
import { ViewRefFileNode } from './abstract/viewRefNode.js';
import { getComparisonStoragePrefix } from './compareResultsNode.js';
import type { FileNode } from './folderNode.js';

type State = {
	checked: TreeItemCheckboxState;
};

export class ResultsFileNode extends ViewRefFileNode<'results-file', View, State> implements FileNode {
	constructor(
		view: View,
		parent: ViewNode,
		repoPath: string,
		file: GitFile,
		public readonly ref1: string,
		public readonly ref2: string,
		private readonly direction: 'ahead' | 'behind' | undefined,
	) {
		// The diff runs from `ref1` to `ref2`, so `file.path` is the name on the `ref2` side (or on `ref1` for a deletion);
		// pair the uri with that ref, otherwise a renamed or added file points at a revision that doesn't have it
		super(
			'results-file',
			GitUri.fromFile(file, repoPath, file.status === 'D' ? ref1 : ref2 || ref1),
			view,
			parent,
			file,
		);

		this.updateContext({ file: file });
		if (this.context.storedComparisonId != null) {
			this._uniqueId = `${getComparisonStoragePrefix(this.context.storedComparisonId)}${this.direction}|${
				file.path
			}`;
		} else {
			this._uniqueId = getViewNodeId(this.type, this.context);
		}
	}

	override toClipboard(): string {
		return this.file.path;
	}

	get ref(): GitRevisionReference {
		return createReference(this.ref1 || this.ref2, this.uri.repoPath!);
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.ResultsFile;
		item.description = this.description;
		item.tooltip = getFileTooltipMarkdown(this.file);

		const statusIcon = getGitFileStatusIcon(this.file.status);
		item.iconPath = {
			dark: Uri.file(this.view.container.context.asAbsolutePath(joinPaths('images', 'dark', statusIcon))),
			light: Uri.file(this.view.container.context.asAbsolutePath(joinPaths('images', 'light', statusIcon))),
		};

		item.command = this.getCommand();

		item.checkboxState = {
			state: this.getState('checked') ?? TreeItemCheckboxState.Unchecked,
			tooltip: l10n.t('Mark as Reviewed'),
		};

		return item;
	}

	private _description: string | undefined;
	get description(): string {
		this._description ??= StatusFileFormatter.fromTemplate(this.view.config.formats.files.description, this.file, {
			relativePath: this.relativePath,
		});
		return this._description;
	}

	private _folderName: string | undefined;
	get folderName(): string {
		this._folderName ??= relativeDir(this.uri.relativePath);
		return this._folderName;
	}

	private _label: string | undefined;
	get label(): string {
		this._label ??= StatusFileFormatter.fromTemplate(this.view.config.formats.files.label, this.file, {
			relativePath: this.relativePath,
		});
		return this._label;
	}

	get priority(): number {
		return 0;
	}

	private _relativePath: string | undefined;
	get relativePath(): string | undefined {
		return this._relativePath;
	}
	set relativePath(value: string | undefined) {
		this._relativePath = value;
		this._label = undefined;
		this._description = undefined;
	}

	override getCommand(): Command | undefined {
		if (this.view.type === 'searchAndCompare' && !this.view.config.files.openDiffOnClick) {
			return createCommand<[this, { line?: number; showOptions?: TextDocumentShowOptions }]>(
				'gitlens.views.openWorkingFileAtFirstChange',
				l10n.t('Open File'),
				this,
				{ showOptions: { preserveFocus: true, preview: true } },
			);
		}

		let lhsUri;
		let rhsUri;
		if (this.file.status === 'R' || this.file.status === 'C') {
			// `originalPath` is the name on the `ref1` side and `path` (this node's uri) the name on the `ref2` side,
			// whichever direction the files node runs
			lhsUri = GitUri.fromFile(this.file, this.uri.repoPath!, this.ref1, true);
			rhsUri = this.uri;
		} else {
			lhsUri = this.uri;
			rhsUri = this.uri;
		}

		return createCommand<[DiffWithCommandArgs]>('gitlens.diffWith', l10n.t('Open Changes'), {
			lhs: { sha: this.ref1, uri: lhsUri },
			rhs: { sha: this.ref2, uri: rhsUri },
			repoPath: this.uri.repoPath!,

			fromComparison: true,
			range: null,
			showOptions: { preserveFocus: true, preview: true },
		});
	}
}

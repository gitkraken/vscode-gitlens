import { MarkdownString } from 'vscode';
import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitStatusFile } from '@gitlens/git/models/statusFile.js';
import { loggable } from '@gitlens/utils/decorators/log.js';
import type { TreeViewFileNodeTypes } from '../../../constants.views.js';
import { StatusFileFormatter } from '../../../git/formatters/statusFormatter.js';
import type { GitUri } from '../../../git/gitUri.js';
import type { View } from '../../viewBase.js';
import { ViewNode } from './viewNode.js';

@loggable(i => i.file.path)
export abstract class ViewFileNode<
	Type extends TreeViewFileNodeTypes = TreeViewFileNodeTypes,
	TView extends View = View,
	State extends object = any,
> extends ViewNode<Type, TView, State> {
	constructor(
		type: Type,
		uri: GitUri,
		view: TView,
		public override parent: ViewNode,
		public readonly file: GitFile,
	) {
		super(type, uri, view, parent);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}
}

export function getFileTooltip(
	file: GitFile | GitStatusFile,
	suffix?: string,
	outputFormat?: 'markdown' | 'plaintext',
): string {
	return StatusFileFormatter.fromTemplate(
		`\${status${suffix ? `' ${suffix}'` : ''}} $(file) \${filePath}${file.submodule != null ? ' (submodule)' : ''}\${  ←  originalPath}\${'\\\n'changesDetail}`,
		file,
		{ outputFormat: outputFormat ?? 'markdown' },
	);
}

export function getFileTooltipMarkdown(file: GitFile | GitStatusFile, suffix?: string): MarkdownString {
	const tooltip = new MarkdownString(getFileTooltip(file, suffix, 'markdown'), true);
	tooltip.supportHtml = true;
	tooltip.isTrusted = true;
	return tooltip;
}

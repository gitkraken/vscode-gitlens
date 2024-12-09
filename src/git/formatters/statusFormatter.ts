import { GlyphChars } from '../../constants';
import { escapeMarkdown } from '../../system/markdown';
import { basename } from '../../system/path';
import type { TokenOptions } from '../../system/string';
import type { GitFile, GitFileWithCommit } from '../models/file';
import {
	getGitFileFormattedDirectory,
	getGitFileFormattedPath,
	getGitFileOriginalRelativePath,
	getGitFileRelativePath,
	getGitFileStatusText,
	isGitFileChange,
} from '../models/file';
import type { FormatOptions } from './formatter';
import { Formatter } from './formatter';

export interface StatusFormatOptions extends FormatOptions {
	outputFormat?: 'markdown' | 'plaintext';
	relativePath?: string;

	tokenOptions?: {
		directory?: TokenOptions;
		file?: TokenOptions;
		filePath?: TokenOptions;
		originalPath?: TokenOptions;
		path?: TokenOptions;
		status?: TokenOptions;
		working?: TokenOptions;
		changes?: TokenOptions;
		changesDetail?: TokenOptions;
		changesShort?: TokenOptions;
	};
}

export class StatusFileFormatter extends Formatter<GitFile, StatusFormatOptions> {
	get directory() {
		const directory = escapeIfNeeded(
			getGitFileFormattedDirectory(this._item, false, this._options.relativePath),
			this._options.outputFormat,
		);
		return this._padOrTruncate(directory, this._options.tokenOptions.directory);
	}

	get file() {
		const file = escapeIfNeeded(basename(this._item.path), this._options.outputFormat);
		return this._padOrTruncate(file, this._options.tokenOptions.file);
	}

	get filePath() {
		const filePath = escapeIfNeeded(
			getGitFileFormattedPath(this._item, {
				relativeTo: this._options.relativePath,
				truncateTo: this._options.tokenOptions.filePath?.truncateTo,
			}),
			this._options.outputFormat,
		);
		return this._padOrTruncate(filePath, this._options.tokenOptions.filePath);
	}

	get originalPath() {
		const originalPath = escapeIfNeeded(
			getGitFileOriginalRelativePath(this._item, this._options.relativePath),
			this._options.outputFormat,
		);
		return this._padOrTruncate(originalPath, this._options.tokenOptions.originalPath);
	}

	get path() {
		const directory = escapeIfNeeded(
			getGitFileRelativePath(this._item, this._options.relativePath),
			this._options.outputFormat,
		);
		return this._padOrTruncate(directory, this._options.tokenOptions.path);
	}

	get status() {
		const status = getGitFileStatusText(this._item.status);
		return this._padOrTruncate(status, this._options.tokenOptions.status);
	}

	get working() {
		let icon = '';
		if (this._item.workingTreeStatus != null && this._item.indexStatus != null) {
			icon = `${GlyphChars.Pencil}${GlyphChars.Space}${GlyphChars.SpaceThinnest}${GlyphChars.Check}`;
		} else if (this._item.workingTreeStatus != null) {
			icon = `${GlyphChars.Pencil}${GlyphChars.SpaceThin}${GlyphChars.SpaceThinnest}${GlyphChars.EnDash}${GlyphChars.Space}`;
		} else if (this._item.indexStatus != null) {
			icon = `${GlyphChars.Space}${GlyphChars.EnDash}${GlyphChars.Space.repeat(2)}${GlyphChars.Check}`;
		} else {
			icon = '';
		}
		return this._padOrTruncate(icon, this._options.tokenOptions.working);
	}

	get changes(): string {
		if (!isGitFileChange(this._item)) {
			return this._padOrTruncate('', this._options.tokenOptions.changes);
		}

		return this._padOrTruncate(
			this._item.formatStats('stats', this._options.outputFormat !== 'plaintext' ? { color: true } : undefined),
			this._options.tokenOptions.changes,
		);
	}

	get changesDetail(): string {
		if (!isGitFileChange(this._item)) {
			return this._padOrTruncate('', this._options.tokenOptions.changes);
		}

		return this._padOrTruncate(
			this._item.formatStats('expanded', { color: this._options.outputFormat !== 'plaintext', separator: ', ' }),
			this._options.tokenOptions.changesDetail,
		);
	}

	get changesShort(): string {
		if (!isGitFileChange(this._item)) {
			return this._padOrTruncate('', this._options.tokenOptions.changes);
		}

		return this._padOrTruncate(
			this._item.formatStats('short', { separator: '' }),
			this._options.tokenOptions.changesShort,
		);
	}

	static fromTemplate(template: string, file: GitFile | GitFileWithCommit, dateFormat: string | null): string;
	static fromTemplate(template: string, file: GitFile | GitFileWithCommit, options?: StatusFormatOptions): string;
	static fromTemplate(
		template: string,
		file: GitFile,
		dateFormatOrOptions?: string | null | StatusFormatOptions,
	): string;
	static fromTemplate(
		template: string,
		file: GitFile,
		dateFormatOrOptions?: string | null | StatusFormatOptions,
	): string {
		return super.fromTemplateCore(this, template, file, dateFormatOrOptions);
	}
}

function escapeIfNeeded(s: string, outputFormat: StatusFormatOptions['outputFormat']) {
	switch (outputFormat) {
		case 'markdown':
			return escapeMarkdown(s);
		default:
			return s;
	}
}

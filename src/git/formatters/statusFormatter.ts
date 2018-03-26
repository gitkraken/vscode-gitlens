'use strict';
import { Strings } from '../../system';
import { GlyphChars } from '../../constants';
import { Formatter, IFormatOptions } from './formatter';
import { GitStatusFile, IGitStatusFile, IGitStatusFileWithCommit } from '../models/status';
import * as path from 'path';

export interface IStatusFormatOptions extends IFormatOptions {
    relativePath?: string;

    tokenOptions?: {
        directory?: Strings.ITokenOptions;
        file?: Strings.ITokenOptions;
        filePath?: Strings.ITokenOptions;
        path?: Strings.ITokenOptions;
        status?: Strings.ITokenOptions;
    };
}

export class StatusFileFormatter extends Formatter<IGitStatusFile, IStatusFormatOptions> {

    get directory() {
        const directory = GitStatusFile.getFormattedDirectory(this._item, false, this._options.relativePath);
        return this._padOrTruncate(directory, this._options.tokenOptions!.file);
    }

    get file() {
        const file = path.basename(this._item.fileName);
        return this._padOrTruncate(file, this._options.tokenOptions!.file);
    }

    get filePath() {
        const filePath = GitStatusFile.getFormattedPath(this._item, undefined, this._options.relativePath);
        return this._padOrTruncate(filePath, this._options.tokenOptions!.filePath);
    }

    get path() {
        const directory = GitStatusFile.getRelativePath(this._item, this._options.relativePath);
        return this._padOrTruncate(directory, this._options.tokenOptions!.path);
    }

    get status() {
        const status = GitStatusFile.getStatusText(this._item.status);
        return this._padOrTruncate(status, this._options.tokenOptions!.status);
    }

    get working() {
        const commit = (this._item as IGitStatusFileWithCommit).commit;
        return (commit !== undefined && commit.isUncommitted) ? `${GlyphChars.Pencil} ${GlyphChars.Space}` : '';
    }

    static fromTemplate(template: string, status: IGitStatusFile, dateFormat: string | null): string;
    static fromTemplate(template: string, status: IGitStatusFile, options?: IStatusFormatOptions): string;
    static fromTemplate(template: string, status: IGitStatusFile, dateFormatOrOptions?: string | null | IStatusFormatOptions): string;
    static fromTemplate(template: string, status: IGitStatusFile, dateFormatOrOptions?: string | null | IStatusFormatOptions): string {
        return super.fromTemplateCore(this, template, status, dateFormatOrOptions);
    }
}
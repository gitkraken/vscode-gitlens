'use strict';
import * as path from 'path';
import { GlyphChars } from '../../constants';
import { Strings } from '../../system';
import { GitStatusFile, IGitStatusFile, IGitStatusFileWithCommit } from '../models/status';
import { Formatter, IFormatOptions } from './formatter';

export interface IStatusFormatOptions extends IFormatOptions {
    relativePath?: string;

    tokenOptions?: {
        directory?: Strings.ITokenOptions;
        file?: Strings.ITokenOptions;
        filePath?: Strings.ITokenOptions;
        path?: Strings.ITokenOptions;
        status?: Strings.ITokenOptions;
        working?: Strings.ITokenOptions;
    };
}

export class StatusFileFormatter extends Formatter<IGitStatusFile, IStatusFormatOptions> {
    get directory() {
        const directory = GitStatusFile.getFormattedDirectory(this._item, false, this._options.relativePath);
        return this._padOrTruncate(directory, this._options.tokenOptions!.directory);
    }

    get file() {
        const file = path.basename(this._item.fileName);
        return this._padOrTruncate(file, this._options.tokenOptions!.file);
    }

    get filePath() {
        const filePath = GitStatusFile.getFormattedPath(this._item, { relativeTo: this._options.relativePath });
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
        return this._padOrTruncate(
            commit !== undefined && commit.isUncommitted ? GlyphChars.Pencil : '',
            this._options.tokenOptions!.working
        );
    }

    static fromTemplate(template: string, status: IGitStatusFile, dateFormat: string | null): string;
    static fromTemplate(template: string, status: IGitStatusFile, options?: IStatusFormatOptions): string;
    static fromTemplate(
        template: string,
        status: IGitStatusFile,
        dateFormatOrOptions?: string | null | IStatusFormatOptions
    ): string;
    static fromTemplate(
        template: string,
        status: IGitStatusFile,
        dateFormatOrOptions?: string | null | IStatusFormatOptions
    ): string {
        return super.fromTemplateCore(this, template, status, dateFormatOrOptions);
    }
}

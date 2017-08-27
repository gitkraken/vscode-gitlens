'use strict';
import { Strings } from '../../system';
import { Formatter, IFormatOptions } from './formatter';
import { GitStatusFile, IGitStatusFile } from '../models/status';
import * as path from 'path';

export interface IStatusFormatOptions extends IFormatOptions {
    tokenOptions?: {
        file?: Strings.ITokenOptions;
        filePath?: Strings.ITokenOptions;
        path?: Strings.ITokenOptions;
    };
}

export class StatusFileFormatter extends Formatter<IGitStatusFile, IStatusFormatOptions> {

    get file() {
        const file = path.basename(this._item.fileName);
        return this._padOrTruncate(file, this._options.tokenOptions!.file);
    }

    get filePath() {
        const filePath = GitStatusFile.getFormattedPath(this._item);
        return this._padOrTruncate(filePath, this._options.tokenOptions!.filePath);
    }

    get path() {
        const directory = GitStatusFile.getFormattedDirectory(this._item, false);
        return this._padOrTruncate(directory, this._options.tokenOptions!.file);
    }

    static fromTemplate(template: string, status: IGitStatusFile, dateFormat: string | null): string;
    static fromTemplate(template: string, status: IGitStatusFile, options?: IStatusFormatOptions): string;
    static fromTemplate(template: string, status: IGitStatusFile, dateFormatOrOptions?: string | null | IStatusFormatOptions): string;
    static fromTemplate(template: string, status: IGitStatusFile, dateFormatOrOptions?: string | null | IStatusFormatOptions): string {
        return super.fromTemplateCore(this, template, status, dateFormatOrOptions);
    }
}
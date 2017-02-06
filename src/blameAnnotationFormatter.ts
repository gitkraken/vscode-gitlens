'use strict';
import { IBlameConfig } from './configuration';
import { GitCommit, IGitCommitLine } from './gitProvider';
import * as moment from 'moment';

export const defaultShaLength = 8;
export const defaultAbsoluteDateLength = 10;
export const defaultRelativeDateLength = 13;
export const defaultAuthorLength = 16;
export const defaultMessageLength = 32;

export enum BlameAnnotationFormat {
    Constrained,
    Unconstrained
}

export default class BlameAnnotationFormatter {

    static getAnnotation(config: IBlameConfig, commit: GitCommit, format: BlameAnnotationFormat) {
        const sha = commit.sha.substring(0, defaultShaLength);
        const message = this.getMessage(config, commit, format === BlameAnnotationFormat.Unconstrained ? 0 : defaultMessageLength);

        if (format === BlameAnnotationFormat.Unconstrained) {
            const authorAndDate = this.getAuthorAndDate(config, commit, 'MMMM Do, YYYY h:MMa');
            if (config.annotation.sha) {
                return `${sha}${(authorAndDate ? `\\00a0\\2022\\00a0 ${authorAndDate}` : '')}${(message ? `\\00a0\\2022\\00a0 ${message}` : '')}`;
            }

            if (config.annotation.author || config.annotation.date) {
                return `${authorAndDate}${(message ? `\\00a0\\2022\\00a0 ${message}` : '')}`;
            }

            return message;
        }

        const author = this.getAuthor(config, commit, defaultAuthorLength);
        const date = this.getDate(config, commit, 'MM/DD/YYYY', true);
        if (config.annotation.sha) {
            return `${sha}${(author ? `\\00a0\\2022\\00a0 ${author}` : '')}${(date ? `\\00a0\\2022\\00a0 ${date}` : '')}${(message ? `\\00a0\\2022\\00a0 ${message}` : '')}`;
        }

        if (config.annotation.author) {
            return `${author}${(date ? `\\00a0\\2022\\00a0 ${date}` : '')}${(message ? `\\00a0\\2022\\00a0 ${message}` : '')}`;
        }

        if (config.annotation.date) {
            return `${date}${(message ? `\\00a0\\2022\\00a0 ${message}` : '')}`;
        }

        return message;
    }

    static getAnnotationHover(config: IBlameConfig, line: IGitCommitLine, commit: GitCommit): string | Array<string> {
        const message = commit.message.replace(/\n/g, '\n\n');
        if (commit.isUncommitted) {
            return `\`${'0'.repeat(8)}\` &nbsp; __Uncommitted changes__ \n\n > ${message}`;
        }

        return `\`${commit.sha}\` &nbsp; __${commit.author}__, ${moment(commit.date).fromNow()} _(${moment(commit.date).format('MMMM Do, YYYY h:MMa')})_ \n\n > ${message}`;
    }

    static getAuthorAndDate(config: IBlameConfig, commit: GitCommit, format?: string, force: boolean = false) {
        if (!force && !config.annotation.author && (!config.annotation.date || config.annotation.date === 'off')) return '';

        if (!config.annotation.author) {
            return this.getDate(config, commit, format);
        }

        if (!config.annotation.date || config.annotation.date === 'off') {
            return this.getAuthor(config, commit);
        }

        return `${this.getAuthor(config, commit)}, ${this.getDate(config, commit, format)}`;
    }

    static getAuthor(config: IBlameConfig, commit: GitCommit, truncateTo: number = 0, force: boolean = false) {
        if (!force && !config.annotation.author) return '';

        const author = commit.isUncommitted ? 'Uncommitted' : commit.author;
        if (!truncateTo) return author;

        if (author.length > truncateTo) {
            return `${author.substring(0, truncateTo - 1)}\\2026`;
        }

        return author + '\\00a0'.repeat(truncateTo - author.length);
    }

    static getDate(config: IBlameConfig, commit: GitCommit, format?: string, truncate: boolean = false, force: boolean = false) {
        if (!force && (!config.annotation.date || config.annotation.date === 'off')) return '';

        const date = config.annotation.date === 'relative'
            ? moment(commit.date).fromNow()
            : moment(commit.date).format(format);
        if (!truncate) return date;

        const truncateTo = config.annotation.date === 'relative' ? defaultRelativeDateLength : defaultAbsoluteDateLength;
        if (date.length > truncateTo) {
            return `${date.substring(0, truncateTo - 1)}\\2026`;
        }

        return date + '\\00a0'.repeat(truncateTo - date.length);
    }

    static getMessage(config: IBlameConfig, commit: GitCommit, truncateTo: number = 0, force: boolean = false) {
        if (!force && !config.annotation.message) return '';

        let message = commit.message;
        if (truncateTo && message.length > truncateTo) {
            return `${message.substring(0, truncateTo - 1)}\\2026`;
        }

        return message;
    }
}
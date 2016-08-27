import {Range, Uri} from 'vscode';
import {DocumentSchemes} from './constants';
import {IGitBlameLine} from './git';
import {basename, dirname, extname} from 'path';
import * as moment from 'moment';

export interface IGitBlameUriData extends IGitBlameLine {
    repoPath: string,
    range: Range,
    index: number,
    lines: IGitBlameLine[],
    commits: string[]
}

export function toGitBlameUri(data: IGitBlameUriData) {
    const pad = n => ("0000000" + n).slice(-("" + data.commits.length).length);

    let ext = extname(data.file);
    let path = `${dirname(data.file)}/${data.sha}: ${basename(data.file, ext)}${ext}`;
    // TODO: Need to specify an index here, since I can't control the sort order -- just alphabetic or by file location
    return Uri.parse(`${DocumentSchemes.GitBlame}:${pad(data.index)}. ${data.author}, ${moment(data.date).format('MMM D, YYYY hh:MMa')} - ${path}?${JSON.stringify(data)}`);
}

export function fromGitBlameUri(uri: Uri): IGitBlameUriData {
    let data = JSON.parse(uri.query);
    data.range = new Range(data.range[0].line, data.range[0].character, data.range[1].line, data.range[1].character);
    return data;
}
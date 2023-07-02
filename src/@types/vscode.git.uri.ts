import { Uri } from 'vscode';
import { Schemes } from '../constants';

export interface GitUriQuery {
	path: string;
	ref: string;

	decoration?: string;
}

export function getQueryDataFromScmGitUri(uri: Uri): GitUriQuery | undefined {
	if (uri.scheme === Schemes.Git) {
		try {
			return JSON.parse(uri.query) as GitUriQuery;
		} catch {}
	}
	return undefined;
}

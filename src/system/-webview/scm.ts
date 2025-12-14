import type { SourceControl, SourceControlResourceGroup, SourceControlResourceState } from 'vscode';
import { Uri } from 'vscode';
import { commonBase } from '../path';

// Since `scm/resourceFolder/context` commands use the URIs of the files, we have to find the common parent
export function getScmResourceFolderUri(args: unknown[]): Uri | undefined {
	const uris = args
		.map(a => (isScmResourceState(a) ? a.resourceUri : undefined))
		.filter(<T>(u?: T): u is T => Boolean(u));
	if (!uris.length) return undefined;

	const [uri] = uris;
	if (uris.length === 1) {
		// Strip off the filename
		return Uri.joinPath(uri, '..');
	}

	const common = commonBase(
		uris.map(u => u.path),
		'/',
	);
	return Uri.from({
		scheme: uri.scheme,
		authority: uri.authority,
		path: common,
	});
}

export function getScmResourceUri(args: unknown[]): Uri | undefined {
	if (!args.length) return undefined;

	const arg = args[0];
	if (isScmResourceState(arg)) return arg.resourceUri;

	if (Array.isArray(arg) && isScmResourceState(arg[0])) {
		return arg[0].resourceUri;
	}

	return undefined;
}

export function isScm(scm: unknown): scm is SourceControl {
	if (scm == null) return false;

	return (
		(scm as SourceControl).id != null &&
		(scm as SourceControl).rootUri != null &&
		(scm as SourceControl).inputBox != null &&
		(scm as SourceControl).statusBarCommands != null
	);
}

export function isScmResourceGroup(group: unknown): group is SourceControlResourceGroup {
	if (group == null) return false;

	return (
		(group as SourceControlResourceGroup).id != null &&
		(group as SourceControlResourceGroup).label != null &&
		(group as SourceControlResourceGroup).resourceStates != null &&
		Array.isArray((group as SourceControlResourceGroup).resourceStates)
	);
}

export function isScmResourceState(resource: unknown): resource is SourceControlResourceState {
	if (resource == null) return false;

	return (resource as SourceControlResourceState).resourceUri != null;
}

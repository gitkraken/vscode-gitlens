import { Uri } from 'vscode';
import type { TimelineScope, TimelineScopeSerialized } from '../../protocol';

export function areTimelineScopesEqual(
	a: TimelineScope | TimelineScopeSerialized | undefined,
	b: TimelineScope | TimelineScopeSerialized | undefined,
): boolean {
	if (a === b || (a == null && b == null)) return true;
	if (a == null || b == null) return false;

	return (
		a.type === b.type &&
		a.uri.toString() === b.uri.toString() &&
		a.head?.ref === b.head?.ref &&
		a.base?.ref === b.base?.ref
	);
}

export function isTimelineScope(o: unknown): o is TimelineScope {
	return o != null && typeof o === 'object' && 'type' in o && 'uri' in o;
}

export function deserializeTimelineScope(scope: TimelineScopeSerialized): TimelineScope;
export function deserializeTimelineScope(scope: TimelineScopeSerialized | undefined): TimelineScope | undefined;
export function deserializeTimelineScope(scope: TimelineScopeSerialized | undefined): TimelineScope | undefined {
	if (scope == null) return undefined;

	return { type: scope.type, uri: Uri.parse(scope.uri), head: scope.head, base: scope.base };
}

export function serializeTimelineScope(scope: Required<TimelineScope>, relativePath: string): TimelineScopeSerialized;
export function serializeTimelineScope(
	scope: Required<TimelineScope> | undefined,
	relativePath: string,
): TimelineScopeSerialized | undefined;
export function serializeTimelineScope(
	scope: Required<TimelineScope> | undefined,
	relativePath: string,
): TimelineScopeSerialized | undefined {
	if (scope == null) return undefined;

	return {
		type: scope.type,
		uri: scope.uri.toString(),
		head: scope.head,
		base: scope.base,
		relativePath: relativePath,
	};
}

export function focusProcessWindow(_pid: number): Promise<boolean> {
	return Promise.resolve(false);
}

export function getProcessParentPid(_pid: number): Promise<number | undefined> {
	return Promise.resolve(undefined);
}

export function isDescendantOfThisExtensionHost(_pid: number, _maxDepth?: number): Promise<boolean> {
	return Promise.resolve(false);
}

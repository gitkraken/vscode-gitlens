export function realpath(_path: string): Promise<string> {
	// Most likely clients of this function will check for `not-isWeb` before calling,
	// So we probably should never get here.
	// But even if we do, cliens should be ready to handle errors of path resolving.
	return Promise.reject(new Error('Not implemented'));
}

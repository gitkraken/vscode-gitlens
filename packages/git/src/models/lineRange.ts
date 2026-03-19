/** A 1-based line and character range, replacing VS Code's `Range` which depends on `Position` objects */
export interface LineRange {
	startLine: number;
	startCharacter: number;
	endLine: number;
	endCharacter: number;
}

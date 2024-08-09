import type {
	WidthOptions as StringWidthOptions,
	TruncationOptions as StringWidthTruncationOptions,
	Result as TruncatedStringWidthResult,
} from 'fast-string-truncated-width';

function getTruncatedStringWidth(
	_s: string,
	_options: StringWidthTruncationOptions,
	_widthOptions: StringWidthOptions,
): TruncatedStringWidthResult {
	return {
		truncated: false,
		ellipsed: false,
		width: 0,
		index: 0,
	};
}
export { getTruncatedStringWidth };

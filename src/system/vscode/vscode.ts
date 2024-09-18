import type { ThemeIcon } from 'vscode';
import { Uri } from 'vscode';
import type { IconPath } from '../../@types/vscode.iconpath';
import type { Container } from '../../container';

export function getIconPathUris(container: Container, filename: string): Exclude<IconPath, ThemeIcon> {
	return {
		dark: Uri.file(container.context.asAbsolutePath(`images/dark/${filename}`)),
		light: Uri.file(container.context.asAbsolutePath(`images/light/${filename}`)),
	};
}

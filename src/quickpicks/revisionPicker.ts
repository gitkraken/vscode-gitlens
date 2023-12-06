// import path from "path";
import type { Disposable, Uri } from "vscode";
import { window } from "vscode";
import { Container } from "../container";
import type { GitUri } from "../git/gitUri";
import { filterMap } from "../system/iterable";
import { getQuickPickIgnoreFocusOut } from "../system/utils";

export async function showRevisionPicker(
	uri: GitUri,
	options: {
		title: string;
		initialPath?: string;
	},
): Promise<Uri | undefined> {
	const disposables: Disposable[] = [];
	try {
		const picker = window.createQuickPick();
		picker.title = options.title;
		picker.value = options.initialPath ?? uri.relativePath;
		picker.placeholder = 'Enter path to file...';
		picker.matchOnDescription = true;
		picker.busy = true;
		picker.ignoreFocusOut = getQuickPickIgnoreFocusOut();

		picker.show();

		const tree = await Container.instance.git.getTreeForRevision(uri.repoPath, uri.sha!);
		picker.items = Array.from(filterMap(tree, file => {
			// Exclude directories
			if (file.type !== 'blob') { return null }
			return { label: file.path }
			// FIXME: Remove this unless we opt to show the directory in the description
			// const parsed = path.parse(file.path)
			// return { label: parsed.base, description: parsed.dir }
		}))
		picker.busy = false;

		const pick = await new Promise<string | undefined>(resolve => {
			disposables.push(
				picker,
				picker.onDidHide(() => resolve(undefined)),
				picker.onDidAccept(() => {
					if (picker.activeItems.length === 0) return;
					resolve(picker.activeItems[0].label);
				}),
			);
		});

		return pick
			? Container.instance.git.getRevisionUri(uri.sha!, `${uri.repoPath}/${pick}`, uri.repoPath!)
			: undefined;
	} finally {
		disposables.forEach(d => {
			d.dispose();
		});
	}
}

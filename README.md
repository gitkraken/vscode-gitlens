# GitLens

Provides Git blame and blame history CodeLens for many supported Visual Studio Code languages (in theory -- the language must support symbol searching).

## Features

Provides two CodeLens on code blocks :
- **Recent Change** - author and date of the most recent check-in
  > Clicking on the CodeLens opens a **Blame explorer** with the commits and changed lines in the right pane and the commit (file) contents on the left
- **Blame** - number of authors of a block and the most prominent author (if there are more than one)
  > Clicking on the CodeLens toggles Git blame overlay

> ![GitLens preview](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/preview-gitlens.gif)

## Requirements

Must be using Git and it must be in your path.

## Extension Settings

None yet.

## Known Issues

- Content in the **Blame explorer** disappears after a bit: [Open vscode issue](https://github.com/Microsoft/vscode/issues/11360)
- Highlighted lines disappear in **Blame explorer** after changing selection and returning to a previous selection: [Open vscode issue](https://github.com/Microsoft/vscode/issues/11360)
- CodeLens aren't updated properly after a file is saved: [Open vscode issue](https://github.com/Microsoft/vscode/issues/11546)
- Visible whitespace causes issue with blame overlay (currently fixed with a hack, but fails randomly): [Open vscode issue](https://github.com/Microsoft/vscode/issues/11485)

## Release Notes

### 0.0.5

Fixes issues where filename changes in history would cause diffs to fails
Removes CodeLens from fields and single-line properties to reduce visual noise

### 0.0.4

Candidate for preview release on the vscode marketplace.

### 0.0.1

Initial release but still heavily a work in progress.
# GitLens

Provides Git blame and blame history CodeLens for many supported Visual Studio Code languages (in theory -- the language must support symbol searching).

## Features

Provides two CodeLens on code blocks:
- **Recent Change** - author and date of the most recent check-in
  > Clicking on the CodeLens opens a **Blame explorer** with the commits and changed lines in the right pane and the commit (file) contents on the left
- **Authors** - number of authors of a block and the most prominent author (if there are more than one)
  > Clicking on the CodeLens toggles Git blame annotations on/off

## Screenshot
> ![GitLens preview](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/preview-gitlens.gif)

## Requirements

Must be using Git and it must be in your path.

## Extension Settings

See the Contributions tab above

## Known Issues

- Content in the **Blame explorer** disappears after a bit: [vscode issue](https://github.com/Microsoft/vscode/issues/11360)
- Highlighted lines disappear in **Blame explorer** after changing selection and returning to a previous selection: [vscode issue](https://github.com/Microsoft/vscode/issues/11360)
- CodeLens aren't updated properly after a file is saved: [vscode issue](https://github.com/Microsoft/vscode/issues/11546)
- Visible whitespace causes issue with blame overlay (currently fixed with a hack, but fails randomly): [vscode issue](https://github.com/Microsoft/vscode/issues/11485)

## Release Notes

### 0.1.0

 - Improved blame annotations, now with sha and author by default
 - Add new blame annotation styles -- compact and expanded (default)
 - Adds many new configuration settings; see Contributions tab above

### 0.0.7

 - Fixes [#4](https://github.com/eamodio/vscode-gitlens/issues/4) - Absolute paths fail on Windows due to backslash (Really!)
 - Fixes [#5](https://github.com/eamodio/vscode-gitlens/issues/5) - Finding first non-white-space fails sometimes
 - Adds .gitignore checks to reduce the number of blame calls

### 0.0.6

 - Fixes [#2](https://github.com/eamodio/vscode-gitlens/issues/2) - [request] Provide some debug info when things fail
 - Fixes [#4](https://github.com/eamodio/vscode-gitlens/issues/4) - Absolute paths fail on Windows due to backslash
 - Attempts to scroll to the correct position when opening a diff

### 0.0.5

- Fixes issues where filename changes in history would cause diffs to fails
- Fixes some issues with uncommited blames
- Removes CodeLens from fields and single-line properties to reduce visual noise
- Automatically turns off blame only when required now

### 0.0.4

Candidate for preview release on the vscode marketplace.

### 0.0.1

Initial release but still heavily a work in progress.
# Contributing

👍🎉 First off, thanks for taking the time to contribute! 🎉👍

When contributing to this project, please first discuss the changes you wish to make via an issue before making changes.

Please note the [Code of Conduct](CODE_OF_CONDUCT.md) document, please follow it in all your interactions with this project.

## Your First Code Contribution

Unsure where to begin contributing? You can start by looking through the [`help-wanted`](https://github.com/gitkraken/vscode-gitlens/labels/help-wanted) issues.

### Getting the code

```
git clone https://github.com/gitkraken/vscode-gitlens.git
```

Prerequisites

- [Git](https://git-scm.com/), `>= 2.7.2`
- [NodeJS](https://nodejs.org/), `>= v22.11.0`
- [pnpm](https://pnpm.io/), `>= 9.x` (install using [corepack](https://nodejs.org/docs/latest-v20.x/api/corepack.html))

### Dependencies

From a terminal, where you have cloned the repository, execute the following command to install the required dependencies:

```
pnpm install
```

### Build

From a terminal, where you have cloned the repository, execute the following command to re-build the project from scratch:

```
pnpm run rebuild
```

👉 **NOTE!** This will run a complete rebuild of the project.

Or to just run a quick build, use:

```
pnpm run build
```

### Watch

During development you can use a watcher to make builds on changes quick and easy. From a terminal, where you have cloned the repository, execute the following command:

```
pnpm run watch
```

Or use the provided `watch` task in VS Code, execute the following from the command palette (be sure there is no `>` at the start):

```
task watch
```

This will first do an initial full build and then watch for file changes, compiling those changes incrementally, enabling a fast, iterative coding experience.

👉 **Tip!** You can press <kbd>CMD+SHIFT+B</kbd> (<kbd>CTRL+SHIFT+B</kbd> on Windows, Linux) to start the watch task.

👉 **Tip!** You don't need to stop and restart the development version of Code after each change. You can just execute `Reload Window` from the command palette.

### Formatting

This project uses [prettier](https://prettier.io/) for code formatting. You can run prettier across the code by calling `pnpm run pretty` from a terminal.

To format the code as you make changes you can install the [Prettier - Code formatter](https://marketplace.visualstudio.com/items/esbenp.prettier-vscode) extension.

Add the following to your User Settings to run prettier:

```
"editor.formatOnSave": true,
```

### Linting

This project uses [ESLint](https://eslint.org/) for code linting. You can run ESLint across the code by calling `pnpm run lint` from a terminal. Warnings from ESLint show up in the `Errors and Warnings` quick box and you can navigate to them from inside VS Code.

To lint the code as you make changes you can install the [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) extension.

### Bundling

To generate a production bundle (without packaging) run the following from a terminal:

```
pnpm run bundle
```

To generate a VSIX (installation package) run the following from a terminal:

```
pnpm run package
```

### Debugging

#### Using VS Code (desktop)

1. Open the `vscode-gitlens` folder
2. Ensure the required [dependencies](#dependencies) are installed
3. Choose the `Watch & Run` launch configuration from the launch dropdown in the Run and Debug viewlet and press `F5`
4. A new VS Code "Extension Development Host" window will open with the extension loaded and ready for debugging
   1. If the "Extension Development Host" window opened without a folder/workspace with a repository (required for most GitLens functionality), you will need to open one and then stop and restart the debug session

In order to see any code changes reflected in the "Extension Development Host" window, you will need to restart the debug session, e.g. using the "Restart" button in the debug toolbar or by pressing `[Ctrl|Cmd]+Shift+F5`. Although, if the code changes are purely within a webview, you can refresh the webview by clicking the refresh button in the toolbar associated with the webview.

_Note: If you see a pop-up with a message similar to "The task cannot be tracked. Make sure to have a problem matcher defined.", you will need to install the [TypeScript + Webpack Problem Matchers](https://marketplace.visualstudio.com/items?itemName=amodio.tsl-problem-matcher) extension._

#### Using VS Code (desktop webworker)

1. Open the `vscode-gitlens` folder
2. Ensure the required [dependencies](#dependencies) are installed
3. Choose the `Watch & Run (web)` launch configuration from the launch dropdown in the Run and Debug viewlet and press `F5`
4. A new VS Code "Extension Development Host" window will open with the extension loaded and ready for debugging
   1. If the "Extension Development Host" window opened without a folder/workspace with a repository (required for most GitLens functionality), you will need to open one and then stop and restart the debug session

In order to see any code changes reflected in the "Extension Development Host" window, you will need to restart the debug session, e.g. using the "Restart" button in the debug toolbar or by pressing `[Ctrl|Cmd]+Shift+F5`. Although, if the code changes are purely within a webview, you can refresh the webview by clicking the refresh button in the toolbar associated with the webview.

#### Using VS Code for the Web (locally)

See https://code.visualstudio.com/api/extension-guides/web-extensions#test-your-web-extension-in-a-browser-using-vscodetestweb

1. Open the `vscode-gitlens` folder
2. Ensure the required [dependencies](#dependencies) are installed
3. Run the `build` or `watch` task from the command palette
4. Run the `Run (local web)` task from the command palette

#### Using VS Code for the Web (vscode.dev)

See https://code.visualstudio.com/api/extension-guides/web-extensions#test-your-web-extension-in-vscode.dev

1. Open the `vscode-gitlens` folder
2. Ensure the required [dependencies](#dependencies) are installed
3. Run the `build` or `watch` task from the command palette
4. Run the `Run (vscode.dev)` task from the command palette

## Submitting a Pull Request

Please follow all the instructions in the [PR template](.github/PULL_REQUEST_TEMPLATE.md).

### Contributions to GitLens+ Licensed Files

This repository contains both OSS-licensed and non-OSS-licensed files. All files in or under any directory named "plus" fall under LICENSE.plus. The remaining files fall under LICENSE, the MIT license.

If a pull request is submitted which contains changes to files in or under any directory named "plus", then you agree that GitKraken and/or its licensors (as applicable) retain all right, title and interest in and to all such modifications and/or patches.

### Update the CHANGELOG

The [Change Log](CHANGELOG.md) is updated manually and an entry should be added for each change. Changes are grouped in lists by `added`, `changed`, `removed`, or `fixed`.

Entries should be written in future tense:

- Be sure to give yourself much deserved credit by adding your name and user in the entry

> Added
>
> - Adds awesome feature &mdash; closes [#\<issue\>](https://github.com/gitkraken/vscode-gitlens/issues/<issue>) thanks to [PR #\<pr\>](https://github.com/gitkraken/vscode-gitlens/issues/<pr>) by Your Name ([@\<your-github-username\>](https://github.com/<your-github-username>))
>
> Changed
>
> - Changes or improves an existing feature &mdash; closes [#\<issue\>](https://github.com/gitkraken/vscode-gitlens/issues/<issue>) thanks to [PR #\<pr\>](https://github.com/gitkraken/vscode-gitlens/issues/<pr>) by Your Name ([@\<your-github-username\>](https://github.com/<your-github-username>))
>
> Fixed
>
> - Fixes [#\<issue\>](https://github.com/gitkraken/vscode-gitlens/issues/<issue>) a bug or regression &mdash; thanks to [PR #\<pr\>](https://github.com/gitkraken/vscode-gitlens/issues/<pr>) by Your Name ([@\<your-github-username\>](https://github.com/<your-github-username>))

### Update the README

If this is your first contribution to GitLens, please give yourself credit by adding yourself to the `Contributors` section of the [README](README.md#contributors-) in the following format:

> - `Your Name ([@<your-github-username>](https://github.com/<your-github-username>)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=<your-github-username>)`

## Publishing

### Stable Releases

#### Versioning

GitLens version changes are bucketed into two types:

- `minor`: normal release (new features, enhancements and fixes)
- `patch`: hotfix release (just fixes)

<small>Note: `major` version bumps are only considered for more special circumstances.</small>

#### Preparing a Normal Release

Before publishing a new release, do the following:

1. Create a GitHub milestone for any potential patch releases, named `{major}.{minor}-patch` with a description of `Work intended for any patch releases before the {major}.{minor} release`
2. Create a GitHub milestone for the next release, `{major}.{minor+1}` with a description of `Work intended for the {release-month} {release-year} release` and a set the appropriate due date
3. Ensure all items in the `{major}.{minor}` GitHub milestone are closed and verified or moved into one of the above milestones
4. Close the `{major}.{minor}` and `{major}.{minor-1}-patch` GitHub milestones

Then, use the [prep-release](scripts/prep-release.mjs) script to prepare a new release. The script updates the [package.json](package.json) and [CHANGELOG.md](CHANGELOG.md) appropriately, commits the changes as `Bumps to v{major}.{minor}.{patch}`, and creates a `v{major}.{minor}.{patch}` tag which when pushed will trigger the CI to publish a release.

1. Ensure you are on the `main` branch and have a clean working tree
2. Ensure the [CHANGELOG.md](CHANGELOG.md) has been updated with the release notes
3. Run `pnpm run prep-release` and enter the desired `{major}.{minor}.{patch}` version when prompted
4. Review the `Bumps to v{major}.{minor}.{patch}` commit
5. Run `git push --follow-tags` to push the commit and tag

Pushing the `v{major}.{minor}.{patch}` tag will trigger the [Publish Stable workflow](.github/workflows/cd-stable.yml) to automatically package the extension, create a [GitHub release](https://github.com/gitkraken/vscode-gitlens/releases/latest), and deploy it to the [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens).

If the action fails and retries are unsuccessful, the VSIX can be built locally with `pnpm run package` and uploaded manually to the marketplace. A GitHub release can also be [created manually](https://github.com/gitkraken/vscode-gitlens/releases/new) using `v{major}.{minor}.{patch}` as the title and the notes from the [CHANGELOG.md](CHANGELOG.md) with the VSIX attached.

#### Preparing a Patch Release

Before publishing a new release, do the following:

1. Ensure all items in the `{major}.{minor}-patch` GitHub milestone are closed and verified
2. Create, if needed, a `release/{major}.{minor}` branch from the latest `v{major}.{minor}.{patch}` tag
3. Cherry-pick the desired commits from `main` into the `release/{major}.{minor}` branch
4. Follow steps 2-5 in [Preparing a Normal Release](#preparing-a-normal-release) above
5. Manually update the [CHANGELOG.md](CHANGELOG.md) on `main` with the patch release notes

Note: All patch releases for the same `{major}.{minor}` version use the same `release/{major}.{minor}` branch

### Pre-releases

The [Publish Pre-release workflow](.github/workflows/cd-pre.yml) is automatically run every AM unless no new changes have been committed to `main`. This workflow can also be manually triggered by running the `Publish Pre-release` workflow from the Actions tab, no more than once per hour (because of the versioning scheme).

### Insiders (deprecated use pre-release instead)

The Publish Insiders workflow is no longer available and was replaced with the pre-release edition.

## Updating GL Icons

To add new icons to the GL Icons font follow the steps below:

- Add new SVG icons to the `images/icons` folder
- Append entries for the new icons to the end of the `images/icons/template/mapping.json` file
  - Entries should be in the format of `<icon-file-name-without-extension>: <increment-last-number>`
- Optimize and build the icons by running the following from a terminal:

  ```
  pnpm run icons:svgo
  pnpm run build:icons

  ```

Once you've finshed copy the new `glicons.woff2?<uuid>` URL from `src/webviews/apps/shared/glicons.scss` and search and replace the old references with the new one.

'use strict';
/* eslint-disable no-loop-func */
import { ProgressLocation, QuickInputButtons, window } from 'vscode';
import { Container } from '../../container';
import { Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { GitCommandBase } from './gitCommand';
import { CommandAbortError, QuickPickStep } from './quickCommand';
import { ReferencesQuickPickItem, RepositoryQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';

interface State {
    repos: Repository[];
    ref: string;
}

export class CheckoutQuickCommand extends GitCommandBase {
    constructor() {
        super('checkout', 'Checkout');
    }

    async execute(state: State) {
        return void (await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Checking out ${
                    state.repos.length === 1 ? state.repos[0].formattedName : `${state.repos.length} repositories`
                } to ${state.ref}`
            },
            () => Promise.all(state.repos.map(r => r.checkout(state.ref, { progress: false })))
        ));
    }

    async *steps(): AsyncIterableIterator<QuickPickStep> {
        const state: Partial<State> & { counter: number } = { counter: 0 };
        let oneRepo = false;
        let showTags = false;

        while (true) {
            try {
                if (state.repos === undefined || state.counter < 1) {
                    const repos = [...(await Container.git.getOrderedRepositories())];

                    if (repos.length === 1) {
                        oneRepo = true;
                        state.counter++;
                        state.repos = [repos[0]];
                    }
                    else {
                        const step = this.createStep<RepositoryQuickPickItem>({
                            multiselect: true,
                            title: this.title,
                            placeholder: 'Choose repositories',
                            items: await Promise.all(
                                repos.map(repo =>
                                    RepositoryQuickPickItem.create(
                                        repo,
                                        state.repos ? state.repos.some(r => r.id === repo.id) : undefined,
                                        { branch: true, fetched: true, status: true }
                                    )
                                )
                            )
                        });
                        const selection = yield step;

                        if (!this.canMoveNext(step, state, selection)) {
                            break;
                        }

                        state.repos = selection.map(i => i.item);
                    }
                }

                if (state.ref === undefined || state.counter < 2) {
                    const includeTags = showTags || state.repos.length === 1;

                    const items = await this.getBranchesAndOrTags(state.repos, includeTags);
                    const step = this.createStep<ReferencesQuickPickItem>({
                        title: `${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                            state.repos.length === 1
                                ? state.repos[0].formattedName
                                : `${state.repos.length} repositories`
                        }`,
                        placeholder: `Choose a branch${includeTags ? ' or tag' : ''} to checkout to`,
                        items: items,
                        selectedItems: state.ref ? items.filter(ref => ref.label === state.ref) : undefined,
                        buttons: includeTags
                            ? [QuickInputButtons.Back]
                            : [
                                  QuickInputButtons.Back,
                                  {
                                      iconPath: {
                                          dark: Container.context.asAbsolutePath('images/dark/icon-tag.svg') as any,
                                          light: Container.context.asAbsolutePath('images/light/icon-tag.svg') as any
                                      },
                                      tooltip: 'Show Tags'
                                  }
                              ],
                        onDidClickButton: async (quickpick, button) => {
                            quickpick.busy = true;
                            quickpick.enabled = false;

                            if (!showTags) {
                                showTags = true;
                            }

                            quickpick.placeholder = `Choose a branch${showTags ? ' or tag' : ''} to checkout to`;
                            quickpick.buttons = [QuickInputButtons.Back];

                            quickpick.items = await this.getBranchesAndOrTags(state.repos!, showTags);

                            quickpick.busy = false;
                            quickpick.enabled = true;
                        }
                    });
                    const selection = yield step;

                    if (!this.canMoveNext(step, state, selection)) {
                        if (oneRepo) {
                            break;
                        }

                        continue;
                    }

                    state.ref = selection[0].item.ref;
                }

                const step = this.createConfirmStep(
                    `Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                        state.repos.length === 1 ? state.repos[0].formattedName : `${state.repos.length} repositories`
                    } to ${state.ref}`,
                    [
                        {
                            label: this.title,
                            description: `${state.ref}`,
                            detail: `Will checkout ${
                                state.repos.length === 1
                                    ? state.repos[0].formattedName
                                    : `${state.repos.length} repositories`
                            } to ${state.ref}`
                        }
                    ]
                );
                const selection = yield step;

                if (!this.canMoveNext(step, state, selection)) {
                    continue;
                }

                this.execute(state as State);
                break;
            }
            catch (ex) {
                if (ex instanceof CommandAbortError) break;

                throw ex;
            }
        }
    }
}

// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module completer-extension
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  CompletionProviderManager,
  ContextCompleterProvider,
  ICompletionProviderManager,
  KernelCompleterProvider
} from '@jupyterlab/completer';
import { IEditorTracker } from '@jupyterlab/fileeditor';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IConsoleTracker } from '@jupyterlab/console';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { PartialJSONObject } from '@lumino/coreutils';
/**
 * The command IDs used by the completer plugin.
 */
namespace CommandIDs {
  export const invoke = 'completer:invoke';

  export const invokeConsole = 'completer:invoke-console';

  export const invokeNotebook = 'completer:invoke-notebook';

  export const invokeFile = 'completer:invoke-file';

  export const select = 'completer:select';

  export const selectConsole = 'completer:select-console';

  export const selectNotebook = 'completer:select-notebook';

  export const selectFile = 'completer:select-file';
}

const COMPLETION_MANAGER_PLUGIN = '@jupyterlab/completer-extension:tracker';

const defaultProvider: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab/completer-extension:base-service',
  requires: [ICompletionProviderManager],
  autoStart: true,
  activate: async (
    app: JupyterFrontEnd,
    serviceManager: ICompletionProviderManager
  ): Promise<void> => {
    serviceManager.registerProvider(new ContextCompleterProvider());
    serviceManager.registerProvider(new KernelCompleterProvider());
  }
};

const manager: JupyterFrontEndPlugin<ICompletionProviderManager> = {
  id: COMPLETION_MANAGER_PLUGIN,
  requires: [
    INotebookTracker,
    IEditorTracker,
    IConsoleTracker,
    ISettingRegistry
  ],
  provides: ICompletionProviderManager,
  autoStart: true,
  activate: (
    app: JupyterFrontEnd,
    notebooks: INotebookTracker,
    editorTracker: IEditorTracker,
    consoles: IConsoleTracker,
    settings: ISettingRegistry
  ): ICompletionProviderManager => {
    const AVAILABLE_PROVIDERS = 'availableProviders';
    const PROVIDER_TIMEOUT = 'providerTimeout';
    const manager = new CompletionProviderManager();
    const updateSetting = (settingValues: ISettingRegistry.ISettings): void => {
      const providersData = settingValues.get(AVAILABLE_PROVIDERS);
      const timeout = settingValues.get(PROVIDER_TIMEOUT);
      manager.setTimeout(timeout.composite as number);
      const selectedProviders = providersData.user || providersData.composite;
      if (selectedProviders) {
        const sortedProviders = Object.entries(selectedProviders)
          .filter(val => val[1] >= 0)
          .sort(([, rank1], [, rank2]) => rank2 - rank1)
          .map(item => item[0]);
        manager.activateProvider(sortedProviders);
      }
    };

    app.restored.then(() => {
      const availableProviders = [...manager.getProviders().keys()];
      settings.transform(COMPLETION_MANAGER_PLUGIN, {
        fetch: plugin => {
          const schema = plugin.schema.properties!;
          availableProviders.forEach((item, index) => {
            schema[AVAILABLE_PROVIDERS]['properties']![item] = {
              type: 'number',
              default: (index + 1) * 100
            };
          });
          return plugin;
        }
      });
      const settingsPromise = settings.load(COMPLETION_MANAGER_PLUGIN);
      settingsPromise.then(settingValues => {
        const userData = settingValues.get(AVAILABLE_PROVIDERS).user;

        if (userData) {
          const newData: PartialJSONObject = {};
          for (const [key, value] of Object.entries(userData)) {
            if (availableProviders.includes(key)) {
              newData[key] = value;
            }
          }
          void settingValues.set(AVAILABLE_PROVIDERS, newData);
        }

        updateSetting(settingValues);
        settingValues.changed.connect(newSettings => {
          updateSetting(newSettings);
        });
      });
    });

    app.commands.addCommand(CommandIDs.invokeNotebook, {
      execute: args => {
        const panel = notebooks.currentWidget;
        if (panel && panel.content.activeCell?.model.type === 'code') {
          manager.invoke(panel.id);
        }
      }
    });

    app.commands.addCommand(CommandIDs.selectNotebook, {
      execute: () => {
        const id = notebooks.currentWidget && notebooks.currentWidget.id;

        if (id) {
          return manager.select(id);
        }
      }
    });

    // Add console completer invoke command.
    app.commands.addCommand(CommandIDs.invokeFile, {
      execute: () => {
        const id =
          editorTracker.currentWidget && editorTracker.currentWidget.id;
        if (id) {
          return manager.invoke(id);
        }
      }
    });

    app.commands.addCommand(CommandIDs.selectFile, {
      execute: () => {
        const id =
          editorTracker.currentWidget && editorTracker.currentWidget.id;

        if (id) {
          return manager.select(id);
        }
      }
    });

    app.commands.addCommand(CommandIDs.invokeConsole, {
      execute: () => {
        const id = consoles.currentWidget && consoles.currentWidget.id;

        if (id) {
          return manager.invoke(id);
        }
      }
    });

    app.commands.addCommand(CommandIDs.selectConsole, {
      execute: () => {
        const id = consoles.currentWidget && consoles.currentWidget.id;

        if (id) {
          return manager.select(id);
        }
      }
    });

    const addKeyBinding = (command: string, selector: string): void => {
      app.commands.addKeyBinding({
        command,
        keys: ['Enter'],
        selector
      });
    };
    addKeyBinding(
      CommandIDs.selectNotebook,
      `.jp-Notebook .jp-mod-completer-active`
    );
    addKeyBinding(
      CommandIDs.selectFile,
      `.jp-FileEditor .jp-mod-completer-active`
    );
    addKeyBinding(
      CommandIDs.selectConsole,
      `.jp-ConsolePanel .jp-mod-completer-active`
    );

    notebooks.widgetAdded.connect(
      async (_, notebook) => await manager.attachPanel(notebook)
    );
    editorTracker.widgetAdded.connect(
      async (_, widget) =>
        await manager.attachEditor(widget, app.serviceManager.sessions)
    );
    consoles.widgetAdded.connect(
      async (_, console) => await manager.attachConsole(console)
    );
    return manager;
  }
};

/**
 * Export the plugins as default.
 */
const plugins: JupyterFrontEndPlugin<any>[] = [manager, defaultProvider];
export default plugins;

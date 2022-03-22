/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/
/**
 * @packageDocumentation
 * @module lsp-extension
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { ITranslator } from '@jupyterlab/translation';

import {
  DocumentConnectionManager,
  IDocumentConnectionManager,
  LanguageServerManager,
} from '@jupyterlab/lsp';
/**
 * The default terminal extension.
 */
const plugin: JupyterFrontEndPlugin<IDocumentConnectionManager> = {
  activate,
  id: '@jupyterlab/lsp-extension:plugin',
  requires: [ISettingRegistry, ITranslator],
  provides: IDocumentConnectionManager,
  autoStart: true
};

/**
 * Activate the lsp plugin.
 */
async function activate(
  app: JupyterFrontEnd,
  settingRegistry: ISettingRegistry,
  translator: ITranslator
): Promise<IDocumentConnectionManager> {

  const languageServerManager = new LanguageServerManager({
    console: {
      ...console,
      scope: (_: string) => {
        /** */
      }
    }
  });
  const connectionManager = new DocumentConnectionManager({
    languageServerManager,
    console: console
  });

  connectionManager.initialConfigurations = {};
  // update the server-independent part of configuration immediately
  connectionManager.updateConfiguration({});
  connectionManager.updateLogging(false, 'off');
  // const capabilities = {
  //   textDocument: {
  //     synchronization: {
  //       dynamicRegistration: true,
  //       willSave: false,
  //       didSave: true,
  //       willSaveWaitUntil: false
  //     }
  //   },
  //   workspace: {
  //     didChangeConfiguration: {
  //       dynamicRegistration: true
  //     }
  //   }
  // };
  // languageServerManager.sessionsChanged.connect(() => {
  //   connectionManager.connect({
  //     language: 'python',
  //     documentPath: 'voila.ipynb',
  //     capabilities,
  //     hasLspSupportedFile: false
  //   });
  // });

  console.log('connectionManager', connectionManager);

  return connectionManager
}

/**
 * Export the plugin as default.
 */
export default plugin;

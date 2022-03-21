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

/**
 * The default terminal extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  activate,
  id: '@jupyterlab/lsp-extension:plugin',
  requires: [ISettingRegistry, ITranslator],
  autoStart: true
};

/**
 * Activate the lsp plugin.
 */
function activate(
  app: JupyterFrontEnd,
  settingRegistry: ISettingRegistry,
  translator: ITranslator
): void {
  console.log('openc calle d');
}

/**
 * Export the plugin as default.
 */
export default plugin;

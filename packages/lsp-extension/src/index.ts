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
import { IRunningSessionManagers, IRunningSessions } from '@jupyterlab/running';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { ITranslator } from '@jupyterlab/translation';

import {
  DocumentConnectionManager,
  IDocumentConnectionManager,
  ILSPConnection,
  LanguageServerManager
} from '@jupyterlab/lsp';
import { LabIcon, pythonIcon } from '@jupyterlab/ui-components';
/**
 * The default terminal extension.
 */
const plugin: JupyterFrontEndPlugin<IDocumentConnectionManager> = {
  activate,
  id: '@jupyterlab/lsp-extension:plugin',
  requires: [ISettingRegistry, ITranslator],
  optional: [IRunningSessionManagers],
  provides: IDocumentConnectionManager,
  autoStart: true
};

/**
 * Activate the lsp plugin.
 */
async function activate(
  app: JupyterFrontEnd,
  settingRegistry: ISettingRegistry,
  translator: ITranslator,
  runningSessionManagers: IRunningSessionManagers | null
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

  console.log('connectionManager', connectionManager);
  // Add a sessions manager if the running extension is available
  if (runningSessionManagers) {
    addRunningSessionManager(runningSessionManagers, connectionManager, translator);
  }

  return connectionManager;
}

export class RunningLanguageServers implements IRunningSessions.IRunningItem {
  constructor(connection: ILSPConnection) {
    this._connection = connection    
  }
  open(): void {
    /** */
  }
  icon(): LabIcon {
    return pythonIcon;
  }
  label(): string {
    return `${this._connection.serverIdentifier ?? ''} (${this._connection.serverLanguage ?? ''})` ;
  }
  shutdown(): void {
    this._connection.close()
  }
  private _connection : ILSPConnection
}

/**
 * Add the running terminal manager to the running panel.
 */
function addRunningSessionManager(
  managers: IRunningSessionManagers,
  lsManager: IDocumentConnectionManager,
  translator: ITranslator
) {
  const trans = translator.load('jupyterlab');

  managers.add({
    name: trans.__('Language servers'),
    running: () => {
      const connections = new Set([...lsManager.connections.values()] ) 
      
      return [...connections].map(conn => new RunningLanguageServers(conn))  
    },
    shutdownAll: () => {/** */},
    refreshRunning: () => {/** */},
    runningChanged: lsManager.connected,
    shutdownLabel: trans.__('Shut Down'),
    shutdownAllLabel: trans.__('Shut Down All'),
    shutdownAllConfirmationText: trans.__(
      'Are you sure you want to permanently shut down all running language servers?'
    )
  });
}
/**
 * Export the plugin as default.
 */
export default plugin;

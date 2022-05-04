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
import { ICompletionProviderManager } from '@jupyterlab/completer';
import {
  CodeExtractorsManager,
  DocumentConnectionManager,
  FeatureManager,
  IFeature,
  ILSPCodeExtractorsManager,
  ILSPConnection,
  ILSPDocumentConnectionManager,
  ILSPFeatureManager,
  LanguageServer,
  LanguageServerManager,
  LspCompletionProvider,
  TextForeignCodeExtractor,
  TLanguageServerConfigurations,
  TLanguageServerId
} from '@jupyterlab/lsp';
import { IRunningSessionManagers, IRunningSessions } from '@jupyterlab/running';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator } from '@jupyterlab/translation';
import {
  IFormComponentRegistry,
  LabIcon,
  pythonIcon
} from '@jupyterlab/ui-components';
import { Signal } from '@lumino/signaling';
import type { FieldProps } from '@rjsf/core';
import { renderServerSetting } from './renderer';
import { PartialJSONObject } from '@lumino/coreutils';
const plugin: JupyterFrontEndPlugin<ILSPDocumentConnectionManager> = {
  activate,
  id: '@jupyterlab/lsp-extension:plugin',
  requires: [ISettingRegistry, ITranslator],
  optional: [IRunningSessionManagers, IFormComponentRegistry],
  provides: ILSPDocumentConnectionManager,
  autoStart: true
};

const featurePlugin: JupyterFrontEndPlugin<ILSPFeatureManager> = {
  activate: activateFeature,
  id: '@jupyterlab/lsp-extension:feature',
  requires: [ISettingRegistry, ITranslator],
  provides: ILSPFeatureManager,
  autoStart: true
};

const completerPlugin: JupyterFrontEndPlugin<void> = {
  activate: activateCompleter,
  id: '@jupyterlab/lsp-extension:completer',
  requires: [ICompletionProviderManager],
  optional: [ILSPDocumentConnectionManager, ILSPFeatureManager],
  autoStart: true
};

const codeExtractorManagerPlugin: JupyterFrontEndPlugin<ILSPCodeExtractorsManager> = {
  id: ILSPCodeExtractorsManager.name,
  requires: [],
  activate: app => {
    const extractorManager = new CodeExtractorsManager();

    const markdownCellExtractor = new TextForeignCodeExtractor({
      language: 'markdown',
      isStandalone: false,
      file_extension: 'md',
      cellType: ['markdown']
    });
    extractorManager.register(markdownCellExtractor, null);
    const rawCellExtractor = new TextForeignCodeExtractor({
      language: 'text',
      isStandalone: false,
      file_extension: 'txt',
      cellType: ['raw']
    });
    extractorManager.register(rawCellExtractor, null);
    return extractorManager;
  },
  provides: ILSPCodeExtractorsManager,
  autoStart: true
};

/**
 * Activate the lsp plugin.
 */
function activate(
  app: JupyterFrontEnd,
  settingRegistry: ISettingRegistry,
  translator: ITranslator,
  runningSessionManagers: IRunningSessionManagers | null,
  settingRendererRegistry: IFormComponentRegistry | null
): ILSPDocumentConnectionManager {
  const LANGUAGE_SERVERS = 'language_servers';
  const languageServerManager = new LanguageServerManager({});
  const connectionManager = new DocumentConnectionManager({
    languageServerManager
  });

  const updateOptions = (settings: ISettingRegistry.ISettings) => {
    const options = settings.composite as Required<LanguageServer>;
    const languageServerSettings = (options.language_servers ||
      {}) as TLanguageServerConfigurations;

    connectionManager.initialConfigurations = languageServerSettings;
    // TODO: if priorities changed reset connections
    connectionManager.updateConfiguration(languageServerSettings);
    connectionManager.updateServerConfigurations(languageServerSettings);
    connectionManager.updateLogging(
      options.logAllCommunication,
      options.setTrace
    );
  };
  languageServerManager.sessionsChanged.connect(() => {
    settingRegistry.transform(plugin.id, {
      fetch: plugin => {
        const schema = plugin.schema.properties!;
        const defaultValue: { [key: string]: any } = {};
        languageServerManager.sessions.forEach((_, key) => {
          defaultValue[key] = { priority: 50, serverSettings: {} };
        });

        schema[LANGUAGE_SERVERS]['default'] = defaultValue;
        return plugin;
      },
      compose: plugin => {
        const properties = plugin.schema.properties!;
        const user = plugin.data.user;

        const serverDefaultSettings = properties[LANGUAGE_SERVERS][
          'default'
        ] as PartialJSONObject;
        const serverUserSettings = user[LANGUAGE_SERVERS] as
          | PartialJSONObject
          | undefined;
        let serverComposite = { ...serverDefaultSettings };
        if (serverUserSettings) {
          serverComposite = { ...serverComposite, ...serverUserSettings };
        }
        const composite: { [key: string]: any } = {
          [LANGUAGE_SERVERS]: serverComposite
        };
        Object.entries(properties).forEach(([key, value]) => {
          if (key !== LANGUAGE_SERVERS) {
            if (key in user) {
              composite[key] = user[key];
            } else {
              composite[key] = value.default;
            }
          }
        });
        plugin.data.composite = composite;
        return plugin;
      }
    });
    settingRegistry
      .load(plugin.id)
      .then(settings => {
        updateOptions(settings);
        settings.changed.connect(() => {
          updateOptions(settings);
        });
      })
      .catch((reason: Error) => {
        console.error(reason.message);
      });
  });

  // Add a sessions manager if the running extension is available
  if (runningSessionManagers) {
    addRunningSessionManager(
      runningSessionManagers,
      connectionManager,
      translator
    );
  }

  if (settingRendererRegistry) {
    settingRendererRegistry.addRenderer(
      LANGUAGE_SERVERS,
      (props: FieldProps) => {
        return renderServerSetting(props, translator);
      }
    );

  }

  return connectionManager;
}

function activateCompleter(
  app: JupyterFrontEnd,
  providerManager: ICompletionProviderManager,
  lspManager?: ILSPDocumentConnectionManager,
  featureManager?: ILSPFeatureManager
): void {
  if (!lspManager || !featureManager) {
    return;
  }
  const feature: IFeature = {
    id: 'lsp-extension:completer',
    capabilities: {
      textDocument: {
        completion: {
          dynamicRegistration: true,
          completionItem: {
            snippetSupport: false,
            commitCharactersSupport: true,
            documentationFormat: ['markdown', 'plaintext'],
            deprecatedSupport: true,
            preselectSupport: false,
            tagSupport: {
              valueSet: [1]
            }
          },
          contextSupport: false
        }
      }
    }
  };

  featureManager.register(feature);
  const provider = new LspCompletionProvider({ manager: lspManager });
  providerManager.registerProvider(provider);
}

function activateFeature(
  app: JupyterFrontEnd,
  settingRegistry: ISettingRegistry,
  translator: ITranslator
): ILSPFeatureManager {
  const featureManager = new FeatureManager();

  return featureManager;
}

export class RunningLanguageServers implements IRunningSessions.IRunningItem {
  constructor(
    connection: ILSPConnection,
    manager: ILSPDocumentConnectionManager
  ) {
    this._connection = connection;
    this._manager = manager;
  }
  open(): void {
    /** */
  }
  icon(): LabIcon {
    return pythonIcon;
  }
  label(): string {
    return `${this._connection.serverIdentifier ?? ''} (${
      this._connection.serverLanguage ?? ''
    })`;
  }
  shutdown(): void {
    for (const [key, value] of this._manager.connections.entries()) {
      if (value === this._connection) {
        const document = this._manager.documents.get(key)!;
        this._manager.unregisterDocument(document);
      }
    }
    this._manager.disconnect(
      this._connection.serverIdentifier as TLanguageServerId
    );
  }
  private _connection: ILSPConnection;
  private _manager: ILSPDocumentConnectionManager;
}

/**
 * Add the running terminal manager to the running panel.
 */
function addRunningSessionManager(
  managers: IRunningSessionManagers,
  lsManager: ILSPDocumentConnectionManager,
  translator: ITranslator
) {
  const trans = translator.load('jupyterlab');
  const signal = new Signal<any, any>(lsManager);
  lsManager.connected.connect(() => signal.emit(lsManager));
  lsManager.disconnected.connect(() => signal.emit(lsManager));
  lsManager.closed.connect(() => signal.emit(lsManager));
  lsManager.documentsChanged.connect(() => signal.emit(lsManager));

  managers.add({
    name: trans.__('Language servers'),
    running: () => {
      const connections = new Set([...lsManager.connections.values()]);
      return [...connections].map(
        conn => new RunningLanguageServers(conn, lsManager)
      );
    },
    shutdownAll: () => {
      /** */
    },
    refreshRunning: () => {
      /** */
    },
    runningChanged: signal,
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
export default [
  plugin,
  featurePlugin,
  completerPlugin,
  codeExtractorManagerPlugin
];

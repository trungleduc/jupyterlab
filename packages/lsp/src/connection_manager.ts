import { PageConfig, URLExt } from '@jupyterlab/coreutils';
import { Signal } from '@lumino/signaling';

import { LSPConnection } from './connection';
import {
  IDocumentConnectionData,
  IDocumentConnectionManager,
  ILanguageServerManager,
  ILSPLogConsole,
  TLanguageServerConfigurations,
  TLanguageServerId,
  TServerKeys
} from './tokens';
import { expandDottedPaths, sleep, untilReady } from './utils';

import type * as protocol from 'vscode-languageserver-protocol';

type AskServersToSendTraceNotifications = any;
type ClientCapabilities = any;
type VirtualDocument = any;

export interface ISocketConnectionOptions {
  /**
   * The language identifier, corresponding to the API endpoint on the LSP proxy server.
   */
  language: string;
  /**
   * Path to the document in the JupyterLab space
   */
  documentPath: string;
  /**
   * LSP capabilities describing currently supported features
   */
  capabilities: ClientCapabilities;

  hasLspSupportedFile: boolean;
}

/**
 * Each Widget with a document (whether file or a notebook) has the same DocumentConnectionManager
 * (see JupyterLabWidgetAdapter). Using id_path instead of uri led to documents being overwritten
 * as two identical id_paths could be created for two different notebooks.
 */
export class DocumentConnectionManager implements IDocumentConnectionManager {
  connections: Map<string, LSPConnection>;
  documents: Map<string, VirtualDocument>;
  initialized: Signal<DocumentConnectionManager, IDocumentConnectionData>;
  connected: Signal<DocumentConnectionManager, IDocumentConnectionData>;
  /**
   * Connection temporarily lost or could not be fully established; a re-connection will be attempted;
   */
  disconnected: Signal<DocumentConnectionManager, IDocumentConnectionData>;
  /**
   * Connection was closed permanently and no-reconnection will be attempted, e.g.:
   *  - there was a serious server error
   *  - user closed the connection,
   *  - re-connection attempts exceeded,
   */
  closed: Signal<DocumentConnectionManager, IDocumentConnectionData>;
  documentsChanged: Signal<
    DocumentConnectionManager,
    Map<string, VirtualDocument>
  >;
  languageServerManager: ILanguageServerManager;
  initialConfigurations: TLanguageServerConfigurations;
  private ignoredLanguages: Set<string>;
  private readonly console: ILSPLogConsole;

  constructor(options: DocumentConnectionManager.IOptions) {
    this.connections = new Map();
    this.documents = new Map();
    this.ignoredLanguages = new Set();
    this.connected = new Signal(this);
    this.initialized = new Signal(this);
    this.disconnected = new Signal(this);
    this.closed = new Signal(this);
    this.documentsChanged = new Signal(this);
    this.languageServerManager = options.languageServerManager;
    this.console = options.console;
    Private.setLanguageServerManager(options.languageServerManager);
  }

  connectDocumentSignals(documentPath: string): void {
    // this.documents.set(documentPath, virtual_document);
    // this.documents_changed.emit(this.documents);
  }

  disconnectDocumentSignals(documentPath: string, emit = true): void {
    this.documents.delete(documentPath);
    if (emit) {
      this.documentsChanged.emit(this.documents);
    }
  }

  private async connectSocket(
    options: ISocketConnectionOptions
  ): Promise<LSPConnection> {
    this.console.log('Connection Socket', options);
    let { language, capabilities, documentPath, hasLspSupportedFile } = options;

    this.connectDocumentSignals(documentPath);

    const uris = DocumentConnectionManager.solveUris(
      documentPath,
      hasLspSupportedFile,
      language
    );

    const matchingServers = this.languageServerManager.getMatchingServers({
      language
    });
    console.debug('Matching servers: ', matchingServers);

    // for now use only the server with the highest priority.
    const languageServerId =
      matchingServers.length === 0 ? null : matchingServers[0];

    // lazily load 1) the underlying library (1.5mb) and/or 2) a live WebSocket-
    // like connection: either already connected or potentially in the process
    // of connecting.
    const connection = await Private.connection(
      language,
      languageServerId!,
      uris,
      this.onNewConnection,
      this.console,
      capabilities
    );

    // if connecting for the first time, all documents subsequent documents will
    // be re-opened and synced
    this.connections.set(documentPath, connection);

    return connection;
  }

  /**
   * Handles the settings that do not require an existing connection
   * with a language server (or can influence to which server the
   * connection will be created, e.g. `priority`).
   *
   * This function should be called **before** initialization of servers.
   */
  public updateConfiguration(
    allServerSettings: TLanguageServerConfigurations
  ): void {
    this.languageServerManager.setConfiguration(allServerSettings);
  }

  /**
   * Handles the settings that the language servers accept using
   * `onDidChangeConfiguration` messages, which should be passed under
   * the "serverSettings" keyword in the setting registry.
   * Other configuration options are handled by `updateConfiguration` instead.
   *
   * This function should be called **after** initialization of servers.
   */
  public updateServerConfigurations(
    allServerSettings: TLanguageServerConfigurations
  ): void {
    let languageServerId: TServerKeys;

    for (languageServerId in allServerSettings) {
      if (!allServerSettings.hasOwnProperty(languageServerId)) {
        continue;
      }
      const rawSettings = allServerSettings[languageServerId]!;

      const parsedSettings = expandDottedPaths(
        rawSettings.serverSettings || {}
      );

      const serverSettings: protocol.DidChangeConfigurationParams = {
        settings: parsedSettings
      };

      this.console.log('Server Update: ', languageServerId);
      this.console.log('Sending settings: ', serverSettings);
      Private.updateServerConfiguration(languageServerId, serverSettings);
    }
  }

  /**
   * Fired the first time a connection is opened. These _should_ be the only
   * invocation of `.on` (once remaining LSPFeature.connection_handlers are made
   * singletons).
   */
  onNewConnection = (connection: LSPConnection): void => {
    console.log('onNewConnection', connection);
    
    connection.on('error', e => {
      this.console.warn(e);
      // TODO invalid now
      let error: Error = e.length && e.length >= 1 ? e[0] : new Error();
      // TODO: those codes may be specific to my proxy client, need to investigate
      if (error.message.indexOf('code = 1005') !== -1) {
        this.console.warn(`Connection failed for ${connection}`);
      } else if (error.message.indexOf('code = 1006') !== -1) {
        this.console.warn('Connection closed by the server');
      } else {
        this.console.error('Connection error:', e);
      }
    });

    connection.on('serverInitialized', capabilities => {
      // Initialize using settings stored in the SettingRegistry
      console.log('serverInitialized', capabilities);
      
      this.updateServerConfigurations(this.initialConfigurations);
      this.initialized.emit({ connection, documentPath: '' });
    });

    connection.on('close', closedManually => {
      if (!closedManually) {
        this.console.warn('Connection unexpectedly disconnected');
      } else {
        this.console.warn('Connection closed');
      }
    });
  };

  /**
   * TODO: presently no longer referenced. A failing connection would close
   * the socket, triggering the language server on the other end to exit
   */
  public async retryToConnect(
    options: ISocketConnectionOptions,
    reconnectDelay: number,
    retrialsLeft = -1
  ): Promise<void> {
    let { language } = options;

    if (this.ignoredLanguages.has(language)) {
      return;
    }

    let interval = reconnectDelay * 1000;
    let success = false;

    while (retrialsLeft !== 0 && !success) {
      await this.connect(options)
        .then(() => {
          success = true;
        })
        .catch(e => {
          this.console.warn(e);
        });

      this.console.log(
        'will attempt to re-connect in ' + interval / 1000 + ' seconds'
      );
      await sleep(interval);

      // gradually increase the time delay, up to 5 sec
      interval = interval < 5 * 1000 ? interval + 500 : interval;
    }
  }

  async connect(
    options: ISocketConnectionOptions,
    firstTimeoutSeconds = 30,
    secondTimeoutMinutes = 5
  ): Promise<LSPConnection | undefined> {
    this.console.log('connection requested', options);
    let connection = await this.connectSocket(options);

    let { documentPath } = options;

    if (!connection.isReady) {
      try {
        // user feedback hinted that 40 seconds was too short and some users are willing to wait more;
        // to make the best of both worlds we first check frequently (6.6 times a second) for the first
        // 30 seconds, and show the warning early in case if something is wrong; we then continue retrying
        // for another 5 minutes, but only once per second.
        await untilReady(
          () => connection.isReady,
          Math.round((firstTimeoutSeconds * 1000) / 150),
          150
        );
      } catch {
        this.console.warn(
          `Connection to ${documentPath} timed out after ${firstTimeoutSeconds} seconds, will continue retrying for another ${secondTimeoutMinutes} minutes`
        );
        try {
          await untilReady(
            () => connection.isReady,
            60 * secondTimeoutMinutes,
            1000
          );
        } catch {
          this.console.warn(
            `Connection to ${documentPath} timed out again after ${secondTimeoutMinutes} minutes, giving up`
          );
          return;
        }
      }
    }

    this.console.log(documentPath, 'connected.');

    this.connected.emit({ connection, documentPath });

    return connection;
  }

  public unregisterDocument(documentPath: string): void {
    this.connections.delete(documentPath);
    this.documentsChanged.emit(this.documents);
  }

  updateLogging(
    logAllCommunication: boolean,
    setTrace: AskServersToSendTraceNotifications
  ): void {
    for (const connection of this.connections.values()) {
      connection.logAllCommunication = logAllCommunication;
      if (setTrace !== null) {
        connection.clientNotifications['$/setTrace'].emit({ value: setTrace });
      }
    }
  }
}

export namespace DocumentConnectionManager {
  export interface IOptions {
    languageServerManager: ILanguageServerManager;
    console: ILSPLogConsole;
  }

  export function solveUris(
    documentPath: string,
    hasLspSupportedFile: boolean,
    language: string
  ): IURIs {
    const wsBase = PageConfig.getBaseUrl().replace(/^http/, 'ws');
    const rootUri = PageConfig.getOption('rootUri');
    const virtualDocumentsUri = PageConfig.getOption('virtualDocumentsUri');

    const baseUri = hasLspSupportedFile ? rootUri : virtualDocumentsUri;

    // for now take the best match only
    const matchingServers = Private.getLanguageServerManager().getMatchingServers(
      {
        language
      }
    );
    const languageServerId =
      matchingServers.length === 0 ? null : matchingServers[0];

    if (languageServerId === null) {
      throw `No language server installed for language ${language}`;
    }

    // workaround url-parse bug(s) (see https://github.com/jupyter-lsp/jupyterlab-lsp/issues/595)
    let documentUri = URLExt.join(baseUri, documentPath);
    if (
      !documentUri.startsWith('file:///') &&
      documentUri.startsWith('file://')
    ) {
      documentUri = documentUri.replace('file://', 'file:///');
      if (
        documentUri.startsWith('file:///users/') &&
        baseUri.startsWith('file:///Users/')
      ) {
        documentUri = documentUri.replace('file:///users/', 'file:///Users/');
      }
    }

    return {
      base: baseUri,
      document: documentUri,
      server: URLExt.join('ws://jupyter-lsp', language),
      socket: URLExt.join(wsBase, 'lsp', 'ws', languageServerId)
    };
  }

  export interface IURIs {
    base: string;
    document: string;
    server: string;
    socket: string;
  }
}

/**
 * Namespace primarily for language-keyed cache of LSPConnections
 */
namespace Private {
  const _connections: Map<TLanguageServerId, LSPConnection> = new Map();
  let _languageServerManager: ILanguageServerManager;

  export function getLanguageServerManager(): ILanguageServerManager {
    return _languageServerManager;
  }
  export function setLanguageServerManager(
    languageServerManager: ILanguageServerManager
  ): void {
    _languageServerManager = languageServerManager;
  }

  /**
   * Return (or create and initialize) the WebSocket associated with the language
   */
  export async function connection(
    language: string,
    languageServerId: TLanguageServerId,
    uris: DocumentConnectionManager.IURIs,
    onCreate: (connection: LSPConnection) => void,
    console: ILSPLogConsole,
    capabilities: ClientCapabilities
  ): Promise<LSPConnection> {
    let connection = _connections.get(languageServerId);

    if (connection == null) {
      const socket = new WebSocket(uris.socket);
      const connection = new LSPConnection({
        languageId: language,
        serverUri: uris.server,
        rootUri: uris.base,
        serverIdentifier: languageServerId,
        console: console,
        capabilities: capabilities
      });
      // TODO: remove remaining unbounded users of connection.on
      connection.setMaxListeners(999);
      _connections.set(languageServerId, connection);
      connection.connect(socket);
      onCreate(connection);
    }

    connection = _connections.get(languageServerId)!;

    return connection;
  }

  export function updateServerConfiguration(
    languageServerId: TLanguageServerId,
    settings: protocol.DidChangeConfigurationParams
  ): void {
    const connection = _connections.get(languageServerId);
    if (connection) {
      connection.sendConfigurationChange(settings);
    }
  }
}

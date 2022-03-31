import { PageConfig, URLExt } from '@jupyterlab/coreutils';
import { Signal } from '@lumino/signaling';

import { ILSPConnection, LSPConnection } from './connection';
import {
  ClientCapabilities,
  IDocumentConnectionData,
  IDocumentConnectionManager,
  ILanguageServerManager,
  ILSPLogConsole,
  ISocketConnectionOptions,
  TLanguageServerConfigurations,
  TLanguageServerId,
  TServerKeys
} from './tokens';
import { expandDottedPaths, sleep, untilReady } from './utils';
import { VirtualDocument } from './virtual/document';
import type * as protocol from 'vscode-languageserver-protocol';
import { WidgetAdapter } from './adapters/adapter';
import { IDocumentWidget } from '@jupyterlab/docregistry';

type AskServersToSendTraceNotifications = any;

/**
 * Each Widget with a document (whether file or a notebook) has the same DocumentConnectionManager
 * (see JupyterLabWidgetAdapter). Using id_path instead of uri led to documents being overwritten
 * as two identical id_paths could be created for two different notebooks.
 */
export class DocumentConnectionManager implements IDocumentConnectionManager {
  connections: Map<VirtualDocument.uri, LSPConnection>;
  adapters: Map<string, WidgetAdapter<IDocumentWidget>>;
  documents: Map<VirtualDocument.uri, VirtualDocument>;
  initialized: Signal<IDocumentConnectionManager, IDocumentConnectionData>;
  connected: Signal<IDocumentConnectionManager, IDocumentConnectionData>;
  /**
   * Connection temporarily lost or could not be fully established; a re-connection will be attempted;
   */
  disconnected: Signal<IDocumentConnectionManager, IDocumentConnectionData>;
  /**
   * Connection was closed permanently and no-reconnection will be attempted, e.g.:
   *  - there was a serious server error
   *  - user closed the connection,
   *  - re-connection attempts exceeded,
   */
  closed: Signal<IDocumentConnectionManager, IDocumentConnectionData>;
  documentsChanged: Signal<
    IDocumentConnectionManager,
    Map<VirtualDocument.uri, VirtualDocument>
  >;
  languageServerManager: ILanguageServerManager;
  initialConfigurations: TLanguageServerConfigurations;
  private ignoredLanguages: Set<string>;
  private readonly console: ILSPLogConsole;

  constructor(options: DocumentConnectionManager.IOptions) {
    this.connections = new Map();
    this.documents = new Map();
    this.adapters = new Map()
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

  connect_document_signals(virtualDocument: VirtualDocument): void {
    this.documents.set(virtualDocument.uri, virtualDocument);
    this.documentsChanged.emit(this.documents);
  }

  disconnect_document_signals(virtualDocument: VirtualDocument, emit = true): void {
    this.documents.delete(virtualDocument.uri);
    if (emit) {
      this.documentsChanged.emit(this.documents);
    }
  }

  private async connectSocket(
    options: ISocketConnectionOptions
  ): Promise<LSPConnection> {
    this.console.log('Connection Socket', options);
    let { language, capabilities, virtualDocument } = options;
    this.connect_document_signals(virtualDocument)

    const uris = DocumentConnectionManager.solveUris(
      virtualDocument,
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
    this.connections.set(virtualDocument.uri, connection);

    return connection;
  }

  registerAdater(path: string, adapter: WidgetAdapter<IDocumentWidget>):void {
    this.adapters.set(path, adapter)
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
        this.forEachDocumentOfConnection(connection, virtualDocument => {
          console.warn('disconnecting ' + virtualDocument.uri);
          this.closed.emit({ connection, virtualDocument });
          this.ignoredLanguages.add(virtualDocument.language);
          console.warn(
            `Cancelling further attempts to connect ${virtualDocument.uri} and other documents for this language (no support from the server)`
          );
        });
      } else if (error.message.indexOf('code = 1006') !== -1) {
        this.console.warn('Connection closed by the server');
      } else {
        this.console.error('Connection error:', e);
      }
    });

    connection.on('serverInitialized', capabilities => {
      // Initialize using settings stored in the SettingRegistry
      this.forEachDocumentOfConnection(connection, virtualDocument => {
        // TODO: is this still necessary, e.g. for status bar to update responsively?
        this.initialized.emit({ connection, virtualDocument });
      }); 
      this.updateServerConfigurations(this.initialConfigurations);

    });

    connection.on('close', closedManually => {
      if (!closedManually) {
        this.console.warn('Connection unexpectedly disconnected');
      } else {
        this.console.warn('Connection closed');
        this.forEachDocumentOfConnection(connection, virtualDocument => {
          this.closed.emit({ connection, virtualDocument });
        });
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
    let { virtualDocument } = options;

    if (this.ignoredLanguages.has(virtualDocument.language)) {
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

  // async registerDocument(options: IDocumentRegistationOptions) {}

  async connect(
    options: ISocketConnectionOptions,
    firstTimeoutSeconds = 30,
    secondTimeoutMinutes = 5
  ): Promise<ILSPConnection | undefined> {
    this.console.log('connection requested', options);
    let connection = await this.connectSocket(options);
    console.log('connection', connection);

    let { documentPath, virtualDocument } = options;

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
          `Connection to ${virtualDocument.uri} timed out after ${firstTimeoutSeconds} seconds, will continue retrying for another ${secondTimeoutMinutes} minutes`
        );
        try {
          await untilReady(
            () => connection.isReady,
            60 * secondTimeoutMinutes,
            1000
          );
        } catch {
          this.console.warn(
            `Connection to ${virtualDocument.uri} timed out again after ${secondTimeoutMinutes} minutes, giving up`
          );
          return;
        }
      }
    }

    console.log(documentPath, 'connected.');

    this.connected.emit({ connection, virtualDocument });

    return connection;
  }

  public unregisterDocument(virtualDocument: VirtualDocument): void {
    this.connections.delete(virtualDocument.uri);
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

  private forEachDocumentOfConnection(
    connection: ILSPConnection,
    callback: (virtualDocument: VirtualDocument) => void
  ) {
    for (const [
      virtualDocumentUri,
      currentConnection
    ] of this.connections.entries()) {
      if (connection !== currentConnection) {
        continue;
      }
      callback(this.documents.get(virtualDocumentUri)!);
    }
  }
}

export namespace DocumentConnectionManager {
  export interface IOptions {
    languageServerManager: ILanguageServerManager;
    console: ILSPLogConsole;
  }

  export function solveUris(
    virtualDocument: VirtualDocument,
    language: string
  ): IURIs {
    const wsBase = PageConfig.getBaseUrl().replace(/^http/, 'ws');
    const rootUri = PageConfig.getOption('rootUri');
    const virtualDocumentsUri = PageConfig.getOption('virtualDocumentsUri');

    const baseUri = virtualDocument.has_lsp_supported_file ? rootUri : virtualDocumentsUri;

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
    let documentUri = URLExt.join(baseUri, virtualDocument.uri);
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

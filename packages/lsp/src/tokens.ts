import { IDocumentWidget } from '@jupyterlab/docregistry';
import { ServerConnection } from '@jupyterlab/services';
import { Token } from '@lumino/coreutils';
import { ISignal } from '@lumino/signaling';

import { LanguageServer2 as LSPLanguageServerSettings } from './_plugin';
import * as SCHEMA from './_schema';
import { WidgetAdapter } from './adapters/adapter';
import { ILSPConnection } from './connection';
import { ClientCapabilities } from './lsp';
import { VirtualDocument } from './virtual/document';

export type TLanguageServerId =
  | 'pylsp'
  | 'bash-language-server'
  | 'dockerfile-language-server-nodejs'
  | 'javascript-typescript-langserver'
  | 'unified-language-server'
  | 'vscode-css-languageserver-bin'
  | 'vscode-html-languageserver-bin'
  | 'vscode-json-languageserver-bin'
  | 'yaml-language-server'
  | 'r-languageserver';

export type TServerKeys = TLanguageServerId;
export type TLanguageServerConfigurations = Partial<
  Record<TServerKeys, LSPLanguageServerSettings>
>;

export type TSessionMap = Map<TServerKeys, SCHEMA.LanguageServerSession>;
export type TSpecsMap = Map<TServerKeys, SCHEMA.LanguageServerSpec>;

export type TLanguageId = string;

export interface ILanguageServerManager {
  sessionsChanged: ISignal<ILanguageServerManager, void>;
  sessions: TSessionMap;
  /**
   * An ordered list of matching >running< sessions, with servers of higher priority higher in the list
   */
  getMatchingServers(
    options: ILanguageServerManager.IGetServerIdOptions
  ): TLanguageServerId[];

  /**
   * A list of all known matching specs (whether detected or not).
   */
  getMatchingSpecs(
    options: ILanguageServerManager.IGetServerIdOptions
  ): TSpecsMap;
  setConfiguration(configuration: TLanguageServerConfigurations): void;
  fetchSessions(): Promise<void>;
  statusUrl: string;
  statusCode: number;
}

export namespace ILanguageServerManager {
  export const URL_NS = 'lsp';
  export interface IOptions {
    settings?: ServerConnection.ISettings;
    baseUrl?: string;
    /**
     * Number of connection retries to fetch the sessions.
     * Default 2.
     */
    retries?: number;
    /**
     * The interval for retries, default 10 seconds.
     */
    retriesInterval?: number;
  }
  export interface IGetServerIdOptions {
    language?: TLanguageId;
    mimeType?: string;
  }
}

export interface ISocketConnectionOptions {
  virtualDocument: VirtualDocument;
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
export interface IDocumentRegistationOptions {
  /**
   * The language identifier, corresponding to the API endpoint on the LSP proxy server.
   */
  language: string;
  /**
   * Path to the document in the JupyterLab space
   */
  document: string;
  /**
   * LSP capabilities describing currently supported features
   */
  capabilities: ClientCapabilities;

  hasLspSupportedFile: boolean;
}

export interface IDocumentConnectionData {
  virtualDocument: VirtualDocument;
  connection: ILSPConnection;
}

export interface IDocumentConnectionManager {
  connections: Map<VirtualDocument.uri, ILSPConnection>;
  documents: Map<VirtualDocument.uri, VirtualDocument>;
  adapters: Map<string, WidgetAdapter<IDocumentWidget>>;
  connected: ISignal<IDocumentConnectionManager, IDocumentConnectionData>;
  initialized: ISignal<IDocumentConnectionManager, IDocumentConnectionData>;
  disconnected: ISignal<IDocumentConnectionManager, IDocumentConnectionData>;
  closed: ISignal<IDocumentConnectionManager, IDocumentConnectionData>;
  languageServerManager: ILanguageServerManager;
  updateConfiguration(allServerSettings: TLanguageServerConfigurations): void;
  updateServerConfigurations(
    allServerSettings: TLanguageServerConfigurations
  ): void;
  retryToConnect(
    options: ISocketConnectionOptions,
    reconnectDelay: number,
    retrialsLeft: number
  ): Promise<void>;
  connect(
    options: ISocketConnectionOptions,
    firstTimeoutSeconds?: number,
    secondTimeoutMinute?: number
  ): Promise<ILSPConnection | undefined>;
  unregisterDocument(virtualDocument: VirtualDocument): void;
  registerAdater(path: string, adapter: WidgetAdapter<IDocumentWidget>): void;
}

export const IDocumentConnectionManager = new Token<IDocumentConnectionManager>(
  '@jupyterlab/lsp:IDocumentConnectionManager'
);

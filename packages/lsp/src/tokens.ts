import { ISignal } from '@lumino/signaling';
import { ServerConnection } from '@jupyterlab/services';
import { ILspConnection } from 'lsp-ws-connection';
import { Token } from '@lumino/coreutils';
export type ILSPLogConsole = any;
export type TLanguageServerConfigurations = any;
export type TServerKeys = any;
export type TSessionMap = any;
export type TSpecsMap = any;
export type TLanguageId = string;
export type ClientCapabilities = any;

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
    console: ILSPLogConsole;
  }
  export interface IGetServerIdOptions {
    language?: TLanguageId;
    mimeType?: string;
  }
}

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

export interface IDocumentConnectionData {
  documentPath: string;
  connection: ILspConnection;
}

export interface ILSPConnection extends ILspConnection {

}
export interface IDocumentConnectionManager {
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
    firstTimeoutSeconds: number,
    secondTimeoutMinute: number
  ): Promise<ILSPConnection | undefined>
  unregisterDocument(documentPath: string): void
}

export const IDocumentConnectionManager = new Token<IDocumentConnectionManager>(
  '@jupyterlab/lsp:IDocumentConnectionManager'
)
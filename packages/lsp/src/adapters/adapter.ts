import { JupyterFrontEnd } from '@jupyterlab/application';
import { Dialog, showDialog } from '@jupyterlab/apputils';
import { CodeEditor } from '@jupyterlab/codeeditor';
import { DocumentRegistry, IDocumentWidget } from '@jupyterlab/docregistry';
import * as nbformat from '@jupyterlab/nbformat';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import { JSONObject } from '@lumino/coreutils';
import { Signal } from '@lumino/signaling';
import mergeWith from 'lodash.mergewith';

import { ClientCapabilities, LanguageIdentifier } from '../lsp';
import { IVirtualPosition } from '../positioning';
import {
  IDocumentConnectionData,
  ILSPCodeExtractorsManager,
  ILSPDocumentConnectionManager,
  ILSPFeatureManager,
  ISocketConnectionOptions
} from '../tokens';
import { IForeignContext, VirtualDocument } from '../virtual/document';

type IButton = Dialog.IButton;
const createButton = Dialog.createButton;
export class StatusMessage {
  /**
   * The text message to be shown on the statusbar
   */
  message: string;
  changed: Signal<StatusMessage, void>;
  private timer: number | null;

  constructor() {
    this.message = '';
    this.changed = new Signal(this);
    this.timer = null;
  }

  /**
   * Set the text message and (optionally) the timeout to remove it.
   * @param message
   * @param timeout - number of ms to until the message is cleaned;
   *        -1 if the message should stay up indefinitely;
   *        defaults to 3000ms (3 seconds)
   */
  set(message: string, timeout: number = 1000 * 3): void {
    this.expireTimer();
    this.message = message;
    this.changed.emit();
    if (timeout !== -1) {
      this.timer = window.setTimeout(this.clear.bind(this), timeout);
    }
  }

  clear(): void {
    this.message = '';
    this.changed.emit();
  }

  private expireTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = 0;
    }
  }
}

/**
 * The values should follow the https://microsoft.github.io/language-server-protocol/specification guidelines
 */
const MIME_TYPE_LANGUAGE_MAP: JSONObject = {
  'text/x-rsrc': 'r',
  'text/x-r-source': 'r',
  // currently there are no LSP servers for IPython we are aware of
  'text/x-ipython': 'python'
};

export interface IEditorChangedData {
  editor: CodeEditor.IEditor;
}

export interface IAdapterOptions {
  app: JupyterFrontEnd;
  connectionManager: ILSPDocumentConnectionManager;
  featureManager: ILSPFeatureManager;
  foreignCodeExtractorsManager: ILSPCodeExtractorsManager;
  translator?: ITranslator;
}

/**
 * Foreign code: low level adapter is not aware of the presence of foreign languages;
 * it operates on the virtual document and must not attempt to infer the language dependencies
 * as this would make the logic of inspections caching impossible to maintain, thus the WidgetAdapter
 * has to handle that, keeping multiple connections and multiple virtual documents.
 */
export abstract class WidgetAdapter<T extends IDocumentWidget> {
  public adapterConnected: Signal<WidgetAdapter<T>, IDocumentConnectionData>;
  public isConnected: boolean;
  public connectionManager: ILSPDocumentConnectionManager;
  public trans: TranslationBundle;
  protected isDisposed = false;

  protected app: JupyterFrontEnd;

  public activeEditorChanged: Signal<WidgetAdapter<T>, IEditorChangedData>;
  public editorAdded: Signal<WidgetAdapter<T>, IEditorChangedData>;
  public editorRemoved: Signal<WidgetAdapter<T>, IEditorChangedData>;
  public updateFinished: Promise<void>;
  public initialized: Promise<void>;

  virtualDocument: VirtualDocument;
  /**
   * (re)create virtual document using current path and language
   */
  abstract createVirtualDocument(): VirtualDocument;

  abstract getEditorIndexAt(position: IVirtualPosition): number;

  abstract getEditorIndex(ceEditor: CodeEditor.IEditor): number;

  abstract getEditorWrapper(ceEditor: CodeEditor.IEditor): HTMLElement;

  // note: it could be using namespace/IOptions pattern,
  // but I do not know how to make it work with the generic type T
  // (other than using 'any' in the IOptions interface)
  protected constructor(protected options: IAdapterOptions, public widget: T) {
    this.app = options.app;
    this.connectionManager = options.connectionManager;
    this.adapterConnected = new Signal(this);
    this.activeEditorChanged = new Signal(this);
    this.editorRemoved = new Signal(this);
    this.editorAdded = new Signal(this);
    this.isConnected = false;
    this.trans = (options.translator || nullTranslator).load('jupyterlab-lsp');

    // set up signal connections
    this.widget.context.saveState.connect(this.onSaveState, this);
    this.connectionManager.closed.connect(this.onConnectionClosed, this);
    this.widget.disposed.connect(this.dispose, this);
  }

  onConnectionClosed(
    _: ILSPDocumentConnectionManager,
    { virtualDocument }: IDocumentConnectionData
  ): void {
    if (virtualDocument === this.virtualDocument) {
      this.dispose();
    }
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.widget.context.saveState.disconnect(this.onSaveState, this);
    this.connectionManager.closed.disconnect(this.onConnectionClosed, this);
    this.widget.disposed.disconnect(this.dispose, this);

    this.disconnect();

    // just to be sure
    this.app = null as any;
    this.widget = null as any;
    this.connectionManager = null as any;
    this.widget = null as any;

    this.isDisposed = true;
  }

  abstract get documentPath(): string;

  abstract get mimeType(): string;

  get widgetId(): string {
    return this.widget.id;
  }

  get language(): LanguageIdentifier {
    // the values should follow https://microsoft.github.io/language-server-protocol/specification guidelines,
    // see the table in https://microsoft.github.io/language-server-protocol/specification#textDocumentItem
    if (MIME_TYPE_LANGUAGE_MAP.hasOwnProperty(this.mimeType)) {
      return MIME_TYPE_LANGUAGE_MAP[this.mimeType] as string;
    } else {
      let withoutParameters = this.mimeType.split(';')[0];
      let [type, subtype] = withoutParameters.split('/');
      if (type === 'application' || type === 'text') {
        if (subtype.startsWith('x-')) {
          return subtype.substr(2);
        } else {
          return subtype;
        }
      } else {
        return this.mimeType;
      }
    }
  }

  abstract get languageFileExtension(): string | undefined;

  disconnect(): void {
    this.connectionManager.unregisterDocument(this.virtualDocument);
    this.widget.context.model.contentChanged.disconnect(
      this.onContentChanged,
      this
    );

    // pretend that all editors were removed to trigger the disconnection of even handlers
    // they will be connected again on new connection
    for (let { ceEditor: editor } of this.editors) {
      this.editorRemoved.emit({
        editor: editor
      });
    }

    this.virtualDocument.dispose();
  }

  // equivalent to triggering didClose and didOpen, as per syncing specification,
  // but also reloads the connection; used during file rename (or when it was moved)
  protected reloadConnection(): void {
    // ignore premature calls (before the editor was initialized)
    if (this.virtualDocument == null) {
      return;
    }

    // disconnect all existing connections (and dispose adapters)
    this.disconnect();

    // recreate virtual document using current path and language
    // as virtual editor assumes it gets the virtual document at init,
    // just dispose virtual editor (which disposes virtual document too)
    // and re-initialize both virtual editor and document
    this.initVirtual();

    // reconnect
    this.connectDocument(this.virtualDocument, true).catch(console.warn);
  }

  protected onSaveState(
    context: DocumentRegistry.IContext<DocumentRegistry.IModel>,
    state: DocumentRegistry.SaveState
  ): void {
    // ignore premature calls (before the editor was initialized)
    if (this.virtualDocument == null) {
      return;
    }

    // TODO: remove workaround no later than with 3.2 release of JupyterLab
    // workaround for https://github.com/jupyterlab/jupyterlab/issues/10721
    // while already reverted in https://github.com/jupyterlab/jupyterlab/pull/10741,
    // it was not released yet and many users will continue to run 3.1.0 and 3.1.1
    // so lets workaround it for now
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const completedManually = state === 'completed manually';

    if (state === 'completed' || completedManually) {
      // note: must only be send to the appropriate connections as
      // some servers (Julia) break if they receive save notification
      // for a document that was not opened before, see:
      // https://github.com/jupyter-lsp/jupyterlab-lsp/issues/490
      const documentsToSave = [this.virtualDocument];

      for (let virtualDocument of documentsToSave) {
        let connection = this.connectionManager.connections.get(
          virtualDocument.uri
        );
        if (!connection) {
          continue;
        }
        connection.sendSaved(virtualDocument.documentInfo);
        for (let foreign of virtualDocument.foreignDocuments.values()) {
          documentsToSave.push(foreign);
        }
      }
    }
  }

  abstract activeEditor: CodeEditor.IEditor | undefined;

  abstract get editors(): {
    ceEditor: CodeEditor.IEditor;
    type: nbformat.CellType;
  }[];

  /**
   * public for use in tests (but otherwise could be private)
   */
  public updateDocuments(): Promise<void> | undefined {
    if (this.isDisposed) {
      console.warn('Cannot update documents: adapter disposed');
      return;
    }
    return this.virtualDocument.updateManager.updateDocuments(
      this.editors.map(({ ceEditor, type }) => {
        return {
          ceEditor: ceEditor,
          value: ceEditor.model.value.text,
          type
        };
      })
    );
  }

  get hasMultipleEditors(): boolean {
    return this.editors.length > 1;
  }

  protected async onConnected(data: IDocumentConnectionData): Promise<void> {
    let { virtualDocument } = data;

    this.adapterConnected.emit(data);
    this.isConnected = true;

    const promise = this.updateDocuments();

    if (!promise) {
      console.warn('Could not update documents');
      return;
    }
    await promise.then(() => {
      // refresh the document on the LSP server
      this.documentChanged(virtualDocument, virtualDocument, true);
    });

    // Note: the logger extension behaves badly with non-default names
    // as it changes the source to the active file afterwards anyways
    // const loggerSourceName = virtualDocument.uri;
    let log: (text: string) => void;
    log = (text: string) => console.log(text);

    data.connection.serverNotifications['$/logTrace'].connect(
      (connection, message) => {
        console.log(
          data.connection.serverIdentifier,
          'trace',
          virtualDocument.uri,
          message
        );
      }
    );

    data.connection.serverNotifications['window/logMessage'].connect(
      (connection, message) => {
        log(connection.serverIdentifier + ': ' + message.message);
      }
    );

    data.connection.serverNotifications['window/showMessage'].connect(
      (connection, message) => {
        void showDialog({
          title: this.trans.__('Message from ') + connection.serverIdentifier,
          body: message.message
        });
      }
    );

    data.connection.serverRequests['window/showMessageRequest'].setHandler(
      async params => {
        const actionItems = params.actions;
        const buttons = actionItems
          ? actionItems.map(action => {
              return createButton({
                label: action.title
              });
            })
          : [createButton({ label: this.trans.__('Dismiss') })];
        const result = await showDialog<IButton>({
          title:
            this.trans.__('Message from ') + data.connection.serverIdentifier,
          body: params.message,
          buttons: buttons
        });
        const choice = buttons.indexOf(result.button);
        if (choice === -1) {
          return null;
        }
        if (actionItems) {
          return actionItems[choice];
        }
        return null;
      }
    );
  }

  /**
   * Opens a connection for the document. The connection may or may
   * not be initialized, yet, and depending on when this is called, the client
   * may not be fully connected.
   *
   * @param virtualDocument a VirtualDocument
   * @param sendOpen whether to open the document immediately
   */
  protected async connectDocument(
    virtualDocument: VirtualDocument,
    sendOpen = false
  ): Promise<void> {
    virtualDocument.foreignDocumentOpened.connect(
      this.onForeignDocumentOpened,
      this
    );
    const connectionContext = await this.connect(virtualDocument).catch(
      console.error
    );

    if (connectionContext && connectionContext.connection) {
      virtualDocument.changed.connect(this.documentChanged, this);
      if (sendOpen) {
        connectionContext.connection.sendOpenWhenReady(
          virtualDocument.documentInfo
        );
      }
    } else {
      console.log(`Connection for ${virtualDocument.uri} was not opened`);
    }
  }

  protected initVirtual(): void {
    let virtualDocument = this.createVirtualDocument();
    if (virtualDocument == null) {
      console.error(
        'Could not initialize a VirtualDocument for adapter: ',
        this
      );
      return;
    }
    this.virtualDocument = virtualDocument;
    this.connectContentChangedSignal();
  }

  private onForeignDocumentClosed(
    _: VirtualDocument,
    context: IForeignContext
  ): void {
    const { foreignDocument } = context;
    foreignDocument.foreignDocumentClosed.disconnect(
      this.onForeignDocumentClosed,
      this
    );
    foreignDocument.foreignDocumentOpened.disconnect(
      this.onForeignDocumentOpened,
      this
    );
    foreignDocument.changed.disconnect(this.documentChanged, this);
  }

  /**
   * Handler for opening a document contained in a parent document. The assumption
   * is that the editor already exists for this, and as such the document
   * should be queued for immediate opening.
   *
   * @param host the VirtualDocument that contains the VirtualDocument in another language
   * @param context information about the foreign VirtualDocument
   */
  protected async onForeignDocumentOpened(
    _: VirtualDocument,
    context: IForeignContext
  ): Promise<void> {
    const { foreignDocument } = context;

    await this.connectDocument(foreignDocument, true);

    foreignDocument.foreignDocumentClosed.connect(
      this.onForeignDocumentClosed,
      this
    );
  }

  documentChanged(
    virtualDocument: VirtualDocument,
    document: VirtualDocument,
    isInit = false
  ): void {
    if (this.isDisposed) {
      console.warn('Cannot swap document: adapter disposed');
      return;
    }

    // TODO only send the difference, using connection.sendSelectiveChange()
    let connection = this.connectionManager.connections.get(
      virtualDocument.uri
    );

    if (!connection?.isReady) {
      console.log('Skipping document update signal: connection not ready');
      return;
    }

    connection.sendFullTextChange(
      virtualDocument.value,
      virtualDocument.documentInfo
    );
    // the first change (initial) is not propagated to features,
    // as it has no associated CodeMirrorChange object
    if (!isInit) {
      // TODO??
      // guarantee that the virtual editor won't perform an update of the virtual documents while
      // the changes are recorded...
      // TODO this is not ideal - why it solves the problem of some errors,
      //  it introduces an unnecessary delay. A better way could be to invalidate some of the updates when a new one comes in.
      //  but maybe not every one (then the outdated state could be kept for too long fo a user who writes very quickly)
      //  also we would not want to invalidate the updates for the purpose of autocompletion (the trigger characters)
    }
  }

  private async connect(virtualDocument: VirtualDocument) {
    let language = virtualDocument.language;

    let capabilities: ClientCapabilities = {
      textDocument: {
        synchronization: {
          dynamicRegistration: true,
          willSave: false,
          didSave: true,
          willSaveWaitUntil: false
        }
      },
      workspace: {
        didChangeConfiguration: {
          dynamicRegistration: true
        }
      }
    };
    capabilities = mergeWith(
      capabilities,
      this.options.featureManager.clientCapabilities()
    );

    let options: ISocketConnectionOptions = {
      capabilities,
      virtualDocument,
      language,
      hasLspSupportedFile: virtualDocument.hasLspSupportedFile
    };

    let connection = await this.connectionManager.connect(options);

    if (connection) {
      await this.onConnected({ virtualDocument, connection });

      return {
        connection,
        virtualDocument
      };
    } else {
      return undefined;
    }
  }

  /**
   * Connect the change signal in order to update all virtual documents after a change.
   *
   * Update to the state of a notebook may be done without a notice on the CodeMirror level,
   * e.g. when a cell is deleted. Therefore a JupyterLab-specific signals are watched instead.
   *
   * While by not using the change event of CodeMirror editors we loose an easy way to send selective,
   * (range) updates this can be still implemented by comparison of before/after states of the
   * virtual documents, which is even more resilient and -obviously - editor-independent.
   */
  private connectContentChangedSignal(): void {
    this.widget.context.model.contentChanged.connect(
      this.onContentChanged,
      this
    );
  }

  private async onContentChanged(_slot: any) {
    // update the virtual documents (sending the updates to LSP is out of scope here)

    const promise = this.updateDocuments();
    if (!promise) {
      console.warn('Could not update documents');
      return;
    }
    this.updateFinished = promise.catch(console.warn);
    await this.updateFinished;
  }

  abstract get wrapperElement(): HTMLElement;
}

import { JupyterFrontEnd } from '@jupyterlab/application';
import { Dialog, showDialog } from '@jupyterlab/apputils';
import { CodeEditor } from '@jupyterlab/codeeditor';
import { DocumentRegistry, IDocumentWidget } from '@jupyterlab/docregistry';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import { JSONObject } from '@lumino/coreutils';
import { Signal } from '@lumino/signaling';

import { ClientCapabilities, LanguageIdentifier } from '../lsp';
import { IVirtualPosition } from '../positioning';
import {
  IDocumentConnectionData,
  IDocumentConnectionManager,
  ILanguageServerManager,
  ISocketConnectionOptions
} from '../tokens';
import { VirtualDocument } from '../virtual/document';

import IButton = Dialog.IButton;
import createButton = Dialog.createButton;

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
  connection_manager: IDocumentConnectionManager;
  language_server_manager: ILanguageServerManager;
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
  public connection_manager: IDocumentConnectionManager;
  public status_message: StatusMessage;
  public trans: TranslationBundle;
  protected isDisposed = false;

  protected app: JupyterFrontEnd;

  public activeEditorChanged: Signal<WidgetAdapter<T>, IEditorChangedData>;
  public editorAdded: Signal<WidgetAdapter<T>, IEditorChangedData>;
  public editorRemoved: Signal<WidgetAdapter<T>, IEditorChangedData>;
  public update_finished: Promise<void>;
  public initialized: Promise<void>;

  virtualDocument: VirtualDocument;
  /**
   * (re)create virtual document using current path and language
   */
  abstract create_virtual_document(): VirtualDocument;

  abstract get_editor_index_at(position: IVirtualPosition): number;

  abstract get_editor_index(ce_editor: CodeEditor.IEditor): number;

  abstract get_editor_wrapper(ce_editor: CodeEditor.IEditor): HTMLElement;

  // note: it could be using namespace/IOptions pattern,
  // but I do not know how to make it work with the generic type T
  // (other than using 'any' in the IOptions interface)
  protected constructor(protected options: IAdapterOptions, public widget: T) {
    this.app = options.app;
    this.connection_manager = options.connection_manager;
    this.adapterConnected = new Signal(this);
    this.activeEditorChanged = new Signal(this);
    this.editorRemoved = new Signal(this);
    this.editorAdded = new Signal(this);
    this.status_message = new StatusMessage();
    this.isConnected = false;
    this.trans = (options.translator || nullTranslator).load('jupyterlab-lsp');


    // set up signal connections
    this.widget.context.saveState.connect(this.on_save_state, this);
    this.connection_manager.closed.connect(this.on_connection_closed, this);
    this.widget.disposed.connect(this.dispose, this);
  }

  on_connection_closed() {
    this.dispose();
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }

    this.widget.context.saveState.disconnect(this.on_save_state, this);
    this.connection_manager.closed.disconnect(this.on_connection_closed, this);
    this.widget.disposed.disconnect(this.dispose, this);

    this.disconnect();

    // just to be sure
    this.app = null as any;
    this.widget = null as any;
    this.connection_manager = null as any;
    this.widget = null as any;

    this.isDisposed = true;
  }

  abstract get document_path(): string;

  abstract get mime_type(): string;

  get widget_id(): string {
    return this.widget.id;
  }

  get language(): LanguageIdentifier {
    // the values should follow https://microsoft.github.io/language-server-protocol/specification guidelines,
    // see the table in https://microsoft.github.io/language-server-protocol/specification#textDocumentItem
    if (MIME_TYPE_LANGUAGE_MAP.hasOwnProperty(this.mime_type)) {
      return MIME_TYPE_LANGUAGE_MAP[this.mime_type] as string;
    } else {
      let without_parameters = this.mime_type.split(';')[0];
      let [type, subtype] = without_parameters.split('/');
      if (type === 'application' || type === 'text') {
        if (subtype.startsWith('x-')) {
          return subtype.substr(2);
        } else {
          return subtype;
        }
      } else {
        return this.mime_type;
      }
    }
  }

  abstract get language_file_extension(): string | undefined;

  disconnect() {
    this.connection_manager.unregisterDocument(this.virtualDocument);
    this.widget.context.model.contentChanged.disconnect(
      this.onContentChanged,
      this
    );

    // pretend that all editors were removed to trigger the disconnection of even handlers
    // they will be connected again on new connection
    for (let editor of this.editors) {
      this.editorRemoved.emit({
        editor: editor
      });
    }

    this.virtualDocument.dispose();
  }

  // equivalent to triggering didClose and didOpen, as per syncing specification,
  // but also reloads the connection; used during file rename (or when it was moved)
  protected reload_connection() {
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
    this.init_virtual();

    // reconnect
    this.connect_document(this.virtualDocument, true).catch(console.warn);
  }

  protected on_save_state(context: any, state: DocumentRegistry.SaveState) {
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
      const documents_to_save = [this.virtualDocument];

      for (let virtual_document of documents_to_save) {
        let connection = this.connection_manager.connections.get(
          virtual_document.uri
        )!;
        console.log(
          'Sending save notification for',
          virtual_document.uri,
          'to',
          connection
        );
        connection.sendSaved(virtual_document.document_info);
      }
    }
  }

  abstract activeEditor: CodeEditor.IEditor | undefined;

  abstract get editors(): CodeEditor.IEditor[];

  /**
   * public for use in tests (but otherwise could be private)
   */
  public update_documents() {
    if (this.isDisposed) {
      console.warn('Cannot update documents: adapter disposed');
      return;
    }
    return this.virtualDocument.update_manager.update_documents(
      this.editors.map(ce_editor => {
        return {
          ce_editor: ce_editor,
          value: ce_editor.model.value.text
        };
      })
    );
  }

  get has_multiple_editors(): boolean {
    return this.editors.length > 1;
  }

  protected async on_connected(data: IDocumentConnectionData) {
    let { virtualDocument } = data;

    this.adapterConnected.emit(data);
    this.isConnected = true;

    const promise = this.update_documents();

    if (!promise) {
      console.warn('Could not update documents');
      return;
    }
    await promise.then(() => {
      // refresh the document on the LSP server
      this.document_changed(virtualDocument, virtualDocument, true);

      console.log(
        'virtual document(s) for',
        this.document_path,
        'have been initialized'
      );
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
        console.log(
          data.connection.serverIdentifier,
          virtualDocument.uri,
          message
        );
        log(connection.serverIdentifier + ': ' + message.message);
      }
    );

    data.connection.serverNotifications['window/showMessage'].connect(
      (connection, message) => {
        console.log(
          data.connection.serverIdentifier,
          virtualDocument.uri,
          message.message
        );
        void showDialog({
          title: this.trans.__('Message from ') + connection.serverIdentifier,
          body: message.message
        });
      }
    );

    data.connection.serverRequests['window/showMessageRequest'].setHandler(
      async params => {
        console.log(
          data.connection.serverIdentifier,
          virtualDocument.uri,
          params
        );
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
   * @param virtual_document a VirtualDocument
   * @param send_open whether to open the document immediately
   */
  protected async connect_document(
    virtual_document: VirtualDocument,
    send_open = false
  ): Promise<void> {
    virtual_document.changed.connect(this.document_changed, this);

    const connection_context = await this.connect(virtual_document).catch(
      console.warn
    );

    if (!send_open) {
      return;
    }

    if (connection_context && connection_context.connection) {
      connection_context.connection.sendOpenWhenReady(
        virtual_document.document_info
      );
    } else {
      console.warn(`Connection for ${virtual_document.path} was not opened`);
    }
  }

  protected init_virtual(): void {
    let virtualDocument = this.create_virtual_document();
    if (virtualDocument == null) {
      console.error(
        'Could not initialize a VirtualDocument for adapter: ',
        this
      );
      return;
    }
    this.virtualDocument = virtualDocument;
    this.connect_contentChanged_signal();
  }

  document_changed(
    virtual_document: VirtualDocument,
    document: VirtualDocument,
    is_init = false
  ) {
    if (this.isDisposed) {
      console.warn('Cannot swap document: adapter disposed');
      return;
    }

    // TODO only send the difference, using connection.sendSelectiveChange()
    let connection = this.connection_manager.connections.get(
      virtual_document.uri
    );

    if (!connection?.isReady) {
      console.log('Skipping document update signal: connection not ready');
      return;
    }

    // this.virtual_editor.console.log(
    //   'LSP: virtual document',
    //   virtual_document.id_path,
    //   'has changed sending update'
    // );
    connection.sendFullTextChange(
      virtual_document.value,
      virtual_document.document_info
    );
    // the first change (initial) is not propagated to features,
    // as it has no associated CodeMirrorChange object
    if (!is_init) {
      // guarantee that the virtual editor won't perform an update of the virtual documents while
      // the changes are recorded...
      // TODO this is not ideal - why it solves the problem of some errors,
      //  it introduces an unnecessary delay. A better way could be to invalidate some of the updates when a new one comes in.
      //  but maybe not every one (then the outdated state could be kept for too long fo a user who writes very quickly)
      //  also we would not want to invalidate the updates for the purpose of autocompletion (the trigger characters)
      // this.virtualDocument.update_manager
      //   .with_update_lock(async () => {
      //     await adapter.updateAfterChange();
      //   })
      //   .then()
      //   .catch(console.warn);
    }
  }

  private async connect(virtualDocument: VirtualDocument) {
    let language = virtualDocument.language;

    console.log(`will connect using language: ${language}`);

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

    let options: ISocketConnectionOptions = {
      capabilities,
      virtualDocument,
      language,
      documentPath: this.document_path,
      hasLspSupportedFile: virtualDocument.has_lsp_supported_file
    };

    let connection = await this.connection_manager.connect(options);

    if (connection) {
      await this.on_connected({ virtualDocument, connection });

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
  private connect_contentChanged_signal() {
    this.widget.context.model.contentChanged.connect(
      this.onContentChanged,
      this
    );
  }

  private async onContentChanged(_slot: any) {
    // update the virtual documents (sending the updates to LSP is out of scope here)
    
    const promise = this.update_documents();
    if (!promise) {
      console.warn('Could not update documents');
      return;
    }
    this.update_finished = promise.catch(console.warn);
    await this.update_finished;
  }

  abstract get wrapper_element(): HTMLElement;
}


import { CodeEditor } from '@jupyterlab/codeeditor';
import { CodeMirrorEditor } from '@jupyterlab/codemirror';
import { IDocumentWidget } from '@jupyterlab/docregistry';
import {
  IAdapterOptions,
  IVirtualPosition,
  VirtualDocument,
  WidgetAdapter
} from '@jupyterlab/lsp';

import { FileEditor } from './widget';



export class FileEditorAdapter extends WidgetAdapter<
  IDocumentWidget<FileEditor>
> {
  editor: FileEditor;

  get document_path() {
    return this.widget.context.path;
  }
  get mime_type() {
    const codeMirrorMimeType = this.editor.model.mimeType;
    const contentsModel = this.editor.context.contentsModel;

    // when MIME type is not known it defaults to 'text/plain',
    // so if it is different we can accept it as it is
    if (codeMirrorMimeType != 'text/plain') {
      return codeMirrorMimeType;
    } else if (contentsModel) {
      // a script that does not have a MIME type known by the editor
      // (no syntax highlight mode), can still be known by the document
      // registry (and this is arguably easier to extend), so let's check it
      // just in case; this is also how the "Klingon" language for testing
      // gets registered, so we need it for tests too.
      let fileType = this.options.app.docRegistry.getFileTypeForModel(
        contentsModel
      );
      return fileType.mimeTypes[0];
    } else {
      // "text/plain" this is
      return codeMirrorMimeType;
    }
  }

  get language_file_extension(): string {
    let parts = this.document_path.split('.');
    return parts[parts.length - 1];
  }

  get ce_editor(): CodeMirrorEditor {
    return this.editor.editor as CodeMirrorEditor;
  }

  get activeEditor(): CodeEditor.IEditor {
    return this.editor.editor;
  }

  constructor(
    options: IAdapterOptions,
    editor_widget: IDocumentWidget<FileEditor>
  ) {
    super(options, editor_widget);
    this.editor = editor_widget.content;
    this.initialized = new Promise<void>((resolve, reject) => {
      this.init_once_ready().then(resolve).catch(reject);
    });
  }

  get wrapper_element() {
    return this.widget.node;
  }

  get path() {
    return this.widget.context.path;
  }

  protected async init_once_ready() {
    console.log('waiting for', this.document_path, 'to fully load');
    if (!this.editor.context.isReady) {
      await this.editor.context.ready;
    }
    console.log(this.document_path, 'ready for connection');

    this.init_virtual();

    // connect the document, but do not open it as the adapter will handle this
    // after registering all features
    this.connect_document(this.virtualDocument, false).catch(console.warn);

    this.editor.model.mimeTypeChanged.connect(this.reload_connection, this);
  }

  get editors(): CodeEditor.IEditor[] {
    return [this.editor.editor];
  }

  create_virtual_document() {
    return new VirtualDocument({
      language: this.language,
      path: this.document_path,
      file_extension: this.language_file_extension,
      // notebooks are continuous, each cell is dependent on the previous one
      standalone: true,
      // notebooks are not supported by LSP servers
      has_lsp_supported_file: true
    });
  }

  get_editor_index_at(position: IVirtualPosition): number {
    return 0;
  }

  get_editor_index(ce_editor: CodeEditor.IEditor): number {
    return 0;
  }

  get_editor_wrapper(ce_editor: CodeEditor.IEditor): HTMLElement {
    return this.wrapper_element;
  }

}

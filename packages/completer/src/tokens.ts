// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { CodeEditor } from '@jupyterlab/codeeditor';
import { Token } from '@lumino/coreutils';
import { CompletionHandler } from './handler';
import { Session } from '@jupyterlab/services';
import { Completer } from './widget';
import { IDocumentWidget } from '@jupyterlab/docregistry';
import { CodeConsole } from '@jupyterlab/console';

export interface ICompletionContext {
  widget: IDocumentWidget | CodeConsole;
  editor?: CodeEditor.IEditor | null;
  session?: Session.ISessionConnection | null;
}


export interface ICompletionProvider<T extends CompletionHandler.ICompletionItem = CompletionHandler.ICompletionItem > {
  /**
   * Unique identifier of the provider
   */
  identifier: string;

  fetch(options: {
    request: CompletionHandler.IRequest,
    context: ICompletionContext
  }) : Promise<CompletionHandler.ICompletionItemsReply<T>>;

  renderer: Completer.IRenderer | null | undefined;
}

export const ICompletionProviderManager = new Token<ICompletionProviderManager>(
  '@jupyterlab/completer:ICompletionProviderManager'
);

export interface ICompletionProviderManager {
  registerProvider(provider: ICompletionProvider): void;
}

export interface IConnectorProxy<T extends CompletionHandler.ICompletionItem = CompletionHandler.ICompletionItem> {
  fetch(
    request: CompletionHandler.IRequest
  ): Promise<Array<{ [id: string]: CompletionHandler.ICompletionItemsReply<T> }>>;
}

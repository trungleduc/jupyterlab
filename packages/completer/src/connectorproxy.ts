import { ICompletionContext, ICompletionProvider } from '.';
import { CompletionHandler } from './handler';
import { IConnectorProxy } from './tokens';
export class ConnectorProxy implements IConnectorProxy {
  constructor(completerContext: ICompletionContext, providers: Array<ICompletionProvider> ) {
    this._providers = providers;
    this._context = completerContext
  }

  public async fetch(
    request: CompletionHandler.IRequest
  ): Promise<Array<{ [id: string]: CompletionHandler.ICompletionItemsReply }>> {
    let promises: Promise<{
      [id: string]: CompletionHandler.ICompletionItemsReply;
    }>[] = [];
    for (const provider of this._providers) {
      const id = provider.identifier;
      let promise = provider.fetch({request, context: this._context}).then(reply => ({ [id]: reply }));
      promises.push(promise.catch(p => p));
    }
    const combinedPromise = Promise.all(promises);
    return combinedPromise;
  }

  private _providers: Array<ICompletionProvider>;
  private _context: ICompletionContext
}

export namespace ConnectorProxy {
  export type IConnectorMap = Map<
    string,
    CompletionHandler.ICompletionItemsConnector
  >;
}

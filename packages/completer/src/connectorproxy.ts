import { ICompletionContext, ICompletionProvider } from '.';
import { CompletionHandler } from './handler';
import { IConnectorProxy } from './tokens';
export class ConnectorProxy implements IConnectorProxy {
  constructor(
    completerContext: ICompletionContext,
    providers: Array<ICompletionProvider>,
    timeout: number
  ) {
    this._providers = providers;
    this._context = completerContext;
    this._timeout = timeout;
  }

  public async fetch(
    request: CompletionHandler.IRequest
  ): Promise<Array<CompletionHandler.ICompletionItemsReply | null>> {
    let promises: Promise<CompletionHandler.ICompletionItemsReply | null>[] = [];
    for (const provider of this._providers) {
      let promise:  Promise<
      CompletionHandler.ICompletionItemsReply| null
    >;
      promise = provider
        .fetch(request, this._context)
        .then(reply => ({ ...reply, provider: provider.identifier }));

      const timeoutPromise = new Promise<
        CompletionHandler.ICompletionItemsReply| null
      >(resolve => {
        return setTimeout(
          () => resolve(null),
          this._timeout
        );
      });
      promise = Promise.race([promise, timeoutPromise]);
      promises.push(promise.catch(p => p));
    }

    const combinedPromise = Promise.all(promises);
    return combinedPromise;
  }

  private _providers: Array<ICompletionProvider>;
  private _context: ICompletionContext;
  private _timeout: number
}

export namespace ConnectorProxy {
  export type IConnectorMap = Map<
    string,
    CompletionHandler.ICompletionItemsConnector
  >;
}

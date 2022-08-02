import { WebSocketAdapter, Logger } from '@nestjs/common';
import { MessageMappingProperties } from '@nestjs/websockets';
import * as UWS from 'uWebSockets.js';
import { Observable, fromEvent, EMPTY } from 'rxjs';
import { mergeMap, filter } from 'rxjs/operators';
import * as events from 'events';

const logger = new Logger('UWS');

export class UWebSocketAdapter implements WebSocketAdapter {
  private instance: UWS.TemplatedApp = null;
  private listenSocket: string = null;

  constructor(args: {
    sslKey?: string;
    sslCert?: string;
  } = {}) {
    // @ts-ignore
    if (args.sslKey) {
      this.instance = UWS.SSLApp({
        cert_file_name: args.sslCert,
        key_file_name: args.sslKey,
      });
    } else {
      this.instance = UWS.App();
    }
  }

  bindClientConnect(server: UWS.TemplatedApp, callback: Function): any {
    this.instance.ws('/*', {
      open: (socket) => {
        Object.defineProperty(socket, 'emitter', {
          configurable: false,
          value: new events.EventEmitter(),
        });
        callback(socket);
      },
      message: (socket, message, isBinary) => {
        socket['emitter'].emit('message', { message, isBinary });
      },
    }).any('/*', (res, req) => {
      res.end('Nothing to see here!');
    });
  }

  bindMessageHandlers(client: UWS.WebSocket, handlers: MessageMappingProperties[], process: (data: any) => Observable<any>): any {
    fromEvent(client['emitter'], 'message')
      .pipe(
        mergeMap((data: { message: ArrayBuffer, isBinary: boolean }) => this.bindMessageHandler(data, handlers, process)),
        filter(result => result),
      )
      .subscribe(response => client.send(JSON.stringify(response)));
  }

  bindMessageHandler(
    buffer: { message: ArrayBuffer, isBinary: boolean },
    handlers: MessageMappingProperties[],
    process: (data: any) => Observable<any>,
  ): Observable<any> {
    const stringMessageData = Buffer.from(buffer.message).toString('utf-8');
    const message = JSON.parse(stringMessageData);
    const messageHandler = handlers.find(
      handler => handler.message === message.event,
    );
    if (!messageHandler) {
      return EMPTY;
    }

    return process(messageHandler.callback(message.data));
  }

  close(): any {
    UWS.us_listen_socket_close(this.listenSocket);
    this.instance = null;
  }

  async create(port: number): Promise<UWS.TemplatedApp> {
    return new Promise((resolve, reject) => {
      this.instance.listen(port, (token) => {
        if (token) {
          logger.log(`Listening to port ${port}`)
          this.listenSocket = token;
          resolve(this.instance);
        } else {
          reject('Can\'t start listening...');
        }
      })
    });
  }
}

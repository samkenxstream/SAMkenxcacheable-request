// Type definitions for cacheable-request 6.0
// Project: https://github.com/lukechilds/cacheable-request#readme
// Definitions by: BendingBender <https://github.com/BendingBender>
//                 Paul Melnikow <https://github.com/paulmelnikow>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped
// TypeScript Version: 2.3

/// <reference types="node" />

import {request, RequestOptions, ClientRequest, ServerResponse} from 'node:http';
import {URL} from 'node:url';
import {EventEmitter} from 'node:events';
import {Store} from 'keyv';
import {Options as CacheSemanticsOptions} from 'http-cache-semantics';
import ResponseLike from 'responselike';

export type RequestFn = typeof request;

export type CacheableRequestFunction = (
	options: (CacheableRequest.Options & RequestOptions & CacheSemanticsOptions) | URL,
	cb?: (response: ServerResponse | ResponseLike) => void
) => EventEmitter;

interface CacheableRequest {
	new (requestFn: RequestFn, storageAdapter?: string | CacheableRequest.StorageAdapter): CacheableRequestFunction;

	RequestError: typeof RequestErrorCls;
	CacheError: typeof CacheErrorCls;
}

namespace CacheableRequest {
    export type StorageAdapter = Store<any>;

    export interface Options {
    	/**
         * If the cache should be used. Setting this to `false` will completely bypass the cache for the current request.
         * @default true
         */
    	cache?: boolean | undefined;

    	/**
         * If set to `true` once a cached resource has expired it is deleted and will have to be re-requested.
         *
         * If set to `false`, after a cached resource's TTL expires it is kept in the cache and will be revalidated
         * on the next request with `If-None-Match`/`If-Modified-Since` headers.
         * @default false
         */
    	strictTtl?: boolean | undefined;

    	/**
         * Limits TTL. The `number` represents milliseconds.
         * @default undefined
         */
    	maxTtl?: number | undefined;

    	/**
         * When set to `true`, if the DB connection fails we will automatically fallback to a network request.
         * DB errors will still be emitted to notify you of the problem even though the request callback may succeed.
         * @default false
         */
    	automaticFailover?: boolean | undefined;

    	/**
         * Forces refreshing the cache. If the response could be retrieved from the cache, it will perform a
         * new request and override the cache instead.
         * @default false
         */
    	forceRefresh?: boolean | undefined;

     url?: string | undefined;

     headers?: any;

     hooks?: any;

     body?: any;
    }

    export interface Emitter extends EventEmitter {
    	addListener(event: 'request', listener: (request: ClientRequest) => void): this;
    	addListener(
    		event: 'response',
    		listener: (response: ServerResponse | ResponseLike) => void
    	): this;
    	addListener(event: 'error', listener: (error: RequestError | CacheError) => void): this;
    	on(event: 'request', listener: (request: ClientRequest) => void): this;
    	on(event: 'response', listener: (response: ServerResponse | ResponseLike) => void): this;
    	on(event: 'error', listener: (error: RequestError | CacheError) => void): this;
    	once(event: 'request', listener: (request: ClientRequest) => void): this;
    	once(event: 'response', listener: (response: ServerResponse | ResponseLike) => void): this;
    	once(event: 'error', listener: (error: RequestError | CacheError) => void): this;
    	prependListener(event: 'request', listener: (request: ClientRequest) => void): this;
    	prependListener(
    		event: 'response',
    		listener: (response: ServerResponse | ResponseLike) => void
    	): this;
    	prependListener(event: 'error', listener: (error: RequestError | CacheError) => void): this;
    	prependOnceListener(event: 'request', listener: (request: ClientRequest) => void): this;
    	prependOnceListener(
    		event: 'response',
    		listener: (response: ServerResponse | ResponseLike) => void
    	): this;
    	prependOnceListener(
    		event: 'error',
    		listener: (error: RequestError | CacheError) => void
    	): this;
    	removeListener(event: 'request', listener: (request: ClientRequest) => void): this;
    	removeListener(
    		event: 'response',
    		listener: (response: ServerResponse | ResponseLike) => void
    	): this;
    	removeListener(event: 'error', listener: (error: RequestError | CacheError) => void): this;
    	off(event: 'request', listener: (request: ClientRequest) => void): this;
    	off(event: 'response', listener: (response: ServerResponse | ResponseLike) => void): this;
    	off(event: 'error', listener: (error: RequestError | CacheError) => void): this;
    	removeAllListeners(event?: 'request' | 'response' | 'error'): this;
    	listeners(event: 'request'): Array<(request: ClientRequest) => void>;
    	listeners(event: 'response'): Array<(response: ServerResponse | ResponseLike) => void>;
    	listeners(event: 'error'): Array<(error: RequestError | CacheError) => void>;
    	rawListeners(event: 'request'): Array<(request: ClientRequest) => void>;
    	rawListeners(event: 'response'): Array<(response: ServerResponse | ResponseLike) => void>;
    	rawListeners(event: 'error'): Array<(error: RequestError | CacheError) => void>;
    	emit(event: 'request', request: ClientRequest): boolean;
    	emit(event: 'response', response: ServerResponse | ResponseLike): boolean;
    	emit(event: 'error', error: RequestError | CacheError): boolean;
    	eventNames(): Array<'request' | 'response' | 'error'>;
    	listenerCount(type: 'request' | 'response' | 'error'): number;
    }

    export type RequestError = RequestErrorCls;
    export type CacheError = CacheErrorCls;
}

declare class RequestErrorCls extends Error {
	readonly name: 'RequestError';

	constructor(error: Error);
}
declare class CacheErrorCls extends Error {
	readonly name: 'CacheError';

	constructor(error: Error);
}

export default CacheableRequest;

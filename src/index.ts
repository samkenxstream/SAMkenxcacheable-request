import EventEmitter from 'node:events';
import urlLib from 'node:url';
import crypto from 'node:crypto';
import stream, {PassThrough as PassThroughStream} from 'node:stream';
import {RequestOptions, ServerResponse, IncomingMessage} from 'node:http';
import normalizeUrl from 'normalize-url';
import getStream from 'get-stream';
import CachePolicy, {Options as CacheSemanticsOptions} from 'http-cache-semantics';
import Response from 'responselike';
import Keyv from 'keyv';
import mimicResponse from 'mimic-response';
import CacheableRequests, {RequestFn} from './types.js';

type Func = (...args: any[]) => any;

class CacheableRequest {
	/* eslint-disable-next-line @typescript-eslint/naming-convention */
	static CacheError = class extends Error {
		constructor(error: any) {
			super(error.message);
			Object.assign(this, error);
		}
	};

	/* eslint-disable-next-line @typescript-eslint/naming-convention */
	static RequestError = class extends Error {
		constructor(error: any) {
			super(error.message);
			Object.assign(this, error);
		}
	};

	cache: CacheableRequests.StorageAdapter;
	request: RequestFn;
	hooks: Map<string, Func> = new Map<string, any>();
	constructor(request: RequestFn, cacheAdapter?: CacheableRequests.StorageAdapter | string) {
		if (cacheAdapter instanceof Keyv) {
			this.cache = cacheAdapter;
		} else if (typeof cacheAdapter === 'string') {
			this.cache = new Keyv({
				uri: cacheAdapter,
				namespace: 'cacheable-request',
			});
		} else {
			this.cache = new Keyv({
				store: cacheAdapter,
				namespace: 'cacheable-request',
			});
		}

		this.createCacheableRequest = this.createCacheableRequest.bind(this);
		this.request = request;
	}

	createCacheableRequest = () => (options: (CacheableRequests.Options & RequestOptions & CacheSemanticsOptions) | string | URL,
		cb?: (response: ServerResponse | Response) => void): EventEmitter => {
		let url;
		if (typeof options === 'string') {
			url = normalizeUrlObject(urlLib.parse(options));
			options = {};
		} else if (options instanceof urlLib.URL) {
			url = normalizeUrlObject(urlLib.parse(options.toString()));
			options = {};
		} else {
			const [pathname, ...searchParts] = (options.path ?? '').split('?');
			const search = searchParts.length > 0
				? `?${searchParts.join('?')}`
				: '';
			url = normalizeUrlObject({...options, pathname, search});
		}

		options = {
			headers: {},
			method: 'GET',
			cache: true,
			strictTtl: false,
			automaticFailover: false,
			...options,
			...urlObjectToRequestOptions(url),
		};
		options.headers = Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value]));
		const ee = new EventEmitter();
		const normalizedUrlString = normalizeUrl(urlLib.format(url), {
			stripWWW: false, // eslint-disable-line @typescript-eslint/naming-convention
			removeTrailingSlash: false,
			stripAuthentication: false,
		});
		let key = `${options.method}:${normalizedUrlString}`;
		// POST, PATCH, and PUT requests may be cached, depending on the response
		// cache-control headers. As a result, the body of the request should be
		// added to the cache key in order to avoid collisions.
		if (options.body && options.method !== undefined && ['POST', 'PATCH', 'PUT'].includes(options.method)) {
			if (options.body instanceof stream.Readable) {
				// Streamed bodies should completely skip the cache because they may
				// or may not be hashable and in either case the stream would need to
				// close before the cache key could be generated.
				options.cache = false;
			} else {
				key += `:${crypto.createHash('md5').update(options.body).digest('hex')}`;
			}
		}

		let revalidate: any = false;
		let madeRequest = false;
		const makeRequest = (options_: any) => {
			madeRequest = true;
			let requestErrored = false;
			let requestErrorCallback: (...args: any[]) => void = () => {/* do nothing */};

			const requestErrorPromise = new Promise<void>(resolve => {
				requestErrorCallback = () => {
					if (!requestErrored) {
						requestErrored = true;
						resolve();
					}
				};
			});
			const handler = (response: any) => {
				if (revalidate) {
					response.status = response.statusCode;
					const revalidatedPolicy = CachePolicy.fromObject(revalidate.cachePolicy).revalidatedPolicy(options_, response);
					if (!revalidatedPolicy.modified) {
						const headers = convertHeaders(revalidatedPolicy.policy.responseHeaders());
						response = new Response({statusCode: revalidate.statusCode, headers, body: revalidate.body, url: revalidate.url});
						response.cachePolicy = revalidatedPolicy.policy;
						response.fromCache = true;
					}
				}

				if (!response.fromCache) {
					response.cachePolicy = new CachePolicy(options_, response, options_);
					response.fromCache = false;
				}

				let clonedResponse;
				if (options_.cache && response.cachePolicy.storable()) {
					clonedResponse = cloneResponse(response);
					(async () => {
						try {
							const bodyPromise = getStream.buffer(response);
							await Promise.race([
								requestErrorPromise,
								new Promise(resolve => response.once('end', resolve)), // eslint-disable-line no-promise-executor-return
							]);
							const body = await bodyPromise;
							const value = {
								cachePolicy: response.cachePolicy.toObject(),
								url: response.url,
								statusCode: response.fromCache ? revalidate.statusCode : response.statusCode,
								body,
							};
							let ttl = options_.strictTtl ? response.cachePolicy.timeToLive() : undefined;
							if (options_.maxTtl) {
								ttl = ttl ? Math.min(ttl, options_.maxTtl) : options_.maxTtl;
							}

							if (this.hooks.size > 0) {
								/* eslint-disable no-await-in-loop */
								for (const key_ of this.hooks.keys()) {
									value.body = await this.runHook(key_, cloneResponse);
								}
								/* eslint-enable no-await-in-loop */
							}

							await this.cache.set(key, value, ttl);
						} catch (error: unknown) {
							ee.emit('error', new CacheableRequest.CacheError(error));
						}
					})();
				} else if (options_.cache && revalidate) {
					(async () => {
						try {
							await this.cache.delete(key);
						} catch (error: unknown) {
							ee.emit('error', new CacheableRequest.CacheError(error));
						}
					})();
				}

				ee.emit('response', clonedResponse ?? response);
				if (typeof cb === 'function') {
					cb(clonedResponse ?? response);
				}
			};

			try {
				const request_ = this.request(options_, handler);
				request_.once('error', requestErrorCallback);
				request_.once('abort', requestErrorCallback);
				ee.emit('request', request_);
			} catch (error: unknown) {
				ee.emit('error', new CacheableRequest.RequestError(error));
			}
		};

		(async () => {
			const get = async (options_: any) => {
				await Promise.resolve();
				const cacheEntry = options_.cache ? await this.cache.get(key) : undefined;

				if (typeof cacheEntry === 'undefined' && !options_.forceRefresh) {
					makeRequest(options_);
					return;
				}

				const policy = CachePolicy.fromObject(cacheEntry.cachePolicy);
				if (policy.satisfiesWithoutRevalidation(options_) && !options_.forceRefresh) {
					const headers = convertHeaders(policy.responseHeaders());
					const response: any = new Response({statusCode: cacheEntry.statusCode, headers, body: cacheEntry.body, url: cacheEntry.url});
					response.cachePolicy = policy;
					response.fromCache = true;
					ee.emit('response', response);
					if (typeof cb === 'function') {
						cb(response);
					}
				} else if (policy.satisfiesWithoutRevalidation(options_) && Date.now() >= policy.timeToLive() && options_.forceRefresh) {
					await this.cache.delete(key);
					options_.headers = policy.revalidationHeaders(options_);
					makeRequest(options_);
				} else {
					revalidate = cacheEntry;
					options_.headers = policy.revalidationHeaders(options_);
					makeRequest(options_);
				}
			};

			const errorHandler = (error: Error) => ee.emit('error', new CacheableRequest.CacheError(error));
			if (this.cache instanceof Keyv) {
				const cachek = this.cache;
				cachek.once('error', errorHandler);
				ee.on('error', () => cachek.removeListener('error', errorHandler));
			}

			try {
				await get(options);
			} catch (error: unknown) {
				if (options.automaticFailover && !madeRequest) {
					makeRequest(options);
				}

				ee.emit('error', new CacheableRequest.CacheError(error));
			}
		})();

		return ee;
	};

	addHook = (name: string, fn: Func) => {
		if (!this.hooks.has(name)) {
			this.hooks.set(name, fn);
		}
	};

	removeHook = (name: string) => this.hooks.delete(name);

	getHook = (name: string) => this.hooks.get(name);

	runHook = async (name: string, response: any) => {
		if (!response) {
			return new CacheableRequest.CacheError(new Error('runHooks requires response argument'));
		}

		return this.hooks.get(name)?.(response);
	};
}

const cloneResponse = (response: IncomingMessage) => {
	const clone = new PassThroughStream({autoDestroy: false});
	mimicResponse(response, clone);

	return response.pipe(clone);
};

const urlObjectToRequestOptions = (url: any) => {
	interface Option {
		path: string;
		pathname?: string;
		search?: string;
	}
	const options: Option = {...url};
	options.path = `${url.pathname || '/'}${url.search || ''}`;
	delete options.pathname;
	delete options.search;
	return options;
};

const normalizeUrlObject = (url: any) =>
	// If url was parsed by url.parse or new URL:
	// - hostname will be set
	// - host will be hostname[:port]
	// - port will be set if it was explicit in the parsed string
	// Otherwise, url was from request options:
	// - hostname or host may be set
	// - host shall not have port encoded
	({
		protocol: url.protocol,
		auth: url.auth,
		hostname: url.hostname || url.host || 'localhost',
		port: url.port,
		pathname: url.pathname,
		search: url.search,
	});

const convertHeaders = (headers: CachePolicy.Headers) => {
	const result: any = [];
	for (const name of Object.keys(headers)) {
		result[name.toLowerCase()] = headers[name];
	}

	return result;
};

export default CacheableRequest;

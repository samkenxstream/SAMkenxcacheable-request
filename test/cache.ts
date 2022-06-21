import anyTest, {TestFn} from 'ava';
import { request } from 'node:http';
import url from 'node:url';
import util from 'node:util';
import getStream from 'get-stream';
import createTestServer from 'create-test-server';
import delay from 'delay';
import sqlite3 from 'sqlite3';
import Keyv from 'keyv';
import pify from 'pify';
import CacheableRequest from '../dist/index.js';

const test = anyTest as TestFn<{s: any}>;
// Promisify cacheableRequest
const promisify = (cacheableRequest: any) => (options: any) => {
	return new Promise((resolve, reject) => {
		cacheableRequest(options, async (response: any) => {
			const body = await getStream(response);
			response.body = body;
			// Give the cache time to update
			await delay(100);
			resolve(response);
		})
			.on('request', (request_: any) => request_.end())
			.once('error', reject);
	});
}
test.before('setup', async (t) => {
	let s = await createTestServer();
	let noStoreIndex = 0;
	s.get('/no-store', (request_, response_) => {
		noStoreIndex++;
		response_.setHeader('Cache-Control', 'public, no-cache, no-store');
		response_.end(noStoreIndex.toString());
	});
	let cacheIndex = 0;
	s.get('/cache', (request_, response_) => {
		cacheIndex++;
		response_.setHeader('Cache-Control', 'public, max-age=60');
		response_.end(cacheIndex.toString());
	});
	s.get('/last-modified', (request_, response_) => {
		response_.setHeader('Cache-Control', 'public, max-age=0');
		response_.setHeader('Last-Modified', 'Wed, 21 Oct 2015 07:28:00 GMT');
		let responseBody: string | null = 'last-modified';
		if (
			request_.headers['if-modified-since'] === 'Wed, 21 Oct 2015 07:28:00 GMT'
		) {
			response_.statusCode = 304;
			responseBody = null;
		}

		response_.end(responseBody);
	});
	let calledFirstError = false;
	s.get('/first-error', (request_, response_) => {
		if (calledFirstError) {
			response_.end('ok');
			return;
		}

		calledFirstError = true;
		response_.statusCode = 502;
		response_.end('received 502');
	});
	s.get('/etag', (request_, response_) => {
		response_.setHeader('Cache-Control', 'public, max-age=0');
		response_.setHeader('ETag', '33a64df551425fcc55e4d42a148795d9f25f89d4');
		let responseBody: string | null = 'etag';
		if (
			request_.headers['if-none-match']
						=== '33a64df551425fcc55e4d42a148795d9f25f89d4'
		) {
			response_.statusCode = 304;
			responseBody = null;
		}

		response_.end(responseBody);
	});
	s.get('/revalidate-modified', (request_, response_) => {
		response_.setHeader('Cache-Control', 'public, max-age=0');
		response_.setHeader('ETag', '33a64df551425fcc55e4d42a148795d9f25f89d4');
		let responseBody = 'revalidate-modified';
		if (
			request_.headers['if-none-match']
						=== '33a64df551425fcc55e4d42a148795d9f25f89d4'
		) {
			response_.setHeader('ETag', '0000000000000000000000000000000000');
			responseBody = 'new-body';
		}

		response_.end(responseBody);
	});
	let cacheThenNoStoreIndex = 0;
	s.get('/cache-then-no-store-on-revalidate', (request_, response_) => {
		const cc
						= cacheThenNoStoreIndex === 0
							? 'public, max-age=0'
							: 'public, no-cache, no-store';
		cacheThenNoStoreIndex++;
		response_.setHeader('Cache-Control', cc);
		response_.end('cache-then-no-store-on-revalidate');
	});
	s.get('/echo', (request_, response_) => {
		const { headers, query, path, originalUrl, body } = request_;
		response_.json({
			headers,
			query,
			path,
			originalUrl,
			body,
		});
	});
	t.context = {s: s}
});
test.after('cleanup', async (t) => {
	//await t.context.s.close();
});

test('Non cacheable responses are not cached', async t => {
	const endpoint = '/no-store';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const firstResponseIntBody: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	const firstResponseInt = Number(firstResponseIntBody.body);
	const secondResponseIntBody: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	const secondResponseInt = Number(secondResponseIntBody.body);
	t.is(cache.size, 0);
	t.true(firstResponseInt < secondResponseInt);
	t.true(true);
});
test('Cacheable responses are cached', async t => {
	const endpoint = '/cache';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const firstResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	const secondResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	t.is(cache.size, 1);
	t.is(firstResponse.body, secondResponse.body);
});
test('Cacheable responses have unique cache key', async t => {
	const endpoint = '/cache';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const firstResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint + '?foo');
	const secondResponse: any = await cacheableRequestHelper(
		t.context.s.url + endpoint + '?bar',
	);
	t.is(cache.size, 2);
	t.not(firstResponse.body, secondResponse.body);
});

const testCacheKey = async (t: any, input: any, expected: any) => {
	const expectKey = `cacheable-request:${expected}`;
	const okMessage = `OK ${expectKey}`;
	const cache = {
		get(key: any) {
			t.is(key, expectKey);
			throw new Error(okMessage);
		},
	};
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	await t.throwsAsync(cacheableRequestHelper(input), undefined, okMessage);
};

testCacheKey.title = (providedTitle: any, input: any) =>
	util.format(
		'Cache key is http.request compatible for arg %s(%j)%s',
		input.constructor.name,
		input,
		providedTitle ? ` (${providedTitle})` : '',
	);
test('return with GET', testCacheKey, 'http://www.example.com', 'GET:http://www.example.com');
test(
	'strips default path',
	testCacheKey,
	'http://www.example.com/',
	'GET:http://www.example.com',
);
test(
	'keeps trailing /',
	testCacheKey,
	'http://www.example.com/test/',
	'GET:http://www.example.com/test/',
);
test(
	'return with GET.',
	testCacheKey,
	new url.URL('http://www.example.com'),
	'GET:http://www.example.com',
);
test('no requried properties', testCacheKey, {}, 'GET:http://localhost');
test(
	'return without slash',
	testCacheKey,
	{
		protocol: 'http:',
		host: 'www.example.com',
		port: 80,
		path: '/',
	},
	'GET:http://www.example.com',
);
test(
	'return without port',
	testCacheKey,
	{
		hostname: 'www.example.com',
		port: 80,
		path: '/',
	},
	'GET:http://www.example.com',
);
test(
	'return with url and port',
	testCacheKey,
	{
		hostname: 'www.example.com',
		port: 8080,
		path: '/',
	},
	'GET:http://www.example.com:8080',
);
test('return with protocol', testCacheKey, { host: 'www.example.com' }, 'GET:http://www.example.com');
test(
	'hostname over host',
	testCacheKey,
	{
		host: 'www.example.com',
		hostname: 'xyz.example.com',
	},
	'GET:http://xyz.example.com',
);
test(
	'hostname defaults to localhost',
	testCacheKey,
	{ path: '/' },
	'GET:http://localhost',
);
test(
	'ignores pathname',
	testCacheKey,
	{
		path: '/foo',
		pathname: '/bar',
	},
	'GET:http://localhost/foo',
);
test(
	'ignores search',
	testCacheKey,
	{
		path: '/?foo=bar',
		search: '?bar=baz',
	},
	'GET:http://localhost/?foo=bar',
);
test(
	'ignores query',
	testCacheKey,
	{
		path: '/?foo=bar',
		query: { bar: 'baz' },
	},
	'GET:http://localhost/?foo=bar',
);
test('auth should be in url', testCacheKey, { auth: 'user:pass' }, 'GET:http://user:pass@localhost');
test('should return default url', testCacheKey, { method: 'POST' }, 'POST:http://localhost');
test('request options path query is passed through', async t => {
	const cacheableRequest = CacheableRequest(request);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const argString = `${t.context.s.url}/echo?foo=bar`;
	const argURL = new url.URL(argString);
	const urlObject = url.parse(argString);
	const argOptions = {
		hostname: urlObject.hostname,
		port: urlObject.port,
		path: urlObject.path,
	};
	const inputs = [argString, argURL, argOptions];
	for (const input of inputs) {
		// eslint-disable-next-line no-await-in-loop
		const response: any = await cacheableRequestHelper(input);
		const body = JSON.parse(response.body);
		const message = util.format(
			'when request arg is %s(%j)',
			input.constructor.name,
			input,
		);
		// eslint-disable-next-line ava/assertion-arguments
		t.is(body.query.foo, 'bar', message);
	}
});
test('Setting opts.cache to false bypasses cache for a single request', async t => {
	const endpoint = '/cache';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const options = url.parse(t.context.s.url + endpoint);
	const optionsNoCache = { cache: false, ...options };
	const firstResponse: any = await cacheableRequestHelper(options);
	const secondResponse: any = await cacheableRequestHelper(options);
	const thirdResponse: any = await cacheableRequestHelper(optionsNoCache);
	const fourthResponse: any = await cacheableRequestHelper(options);
	t.false(firstResponse.fromCache);
	t.true(secondResponse.fromCache);
	t.false(thirdResponse.fromCache);
	t.true(fourthResponse.fromCache);
});
test('TTL is passed to cache', async t => {
	const endpoint = '/cache';
	const store = new Map();
	const cache = {
		get: store.get.bind(store),
		set(key: any, value: any, ttl: number) {
			t.is(typeof ttl, 'number');
			t.true(ttl > 0);
			return store.set(key, value);
		},
		delete: store.delete.bind(store),
	};
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const options = { strictTtl: true, ...url.parse(t.context.s.url + endpoint) };
	t.plan(2);
	await cacheableRequestHelper(options);
});
test('TTL is not passed to cache if strictTtl is false', async t => {
	const endpoint = '/cache';
	const store = new Map();
	const cache = {
		get: store.get.bind(store),
		set(key: any, value: any, ttl: number) {
			t.true(typeof ttl === 'undefined');
			return store.set(key, value);
		},
		delete: store.delete.bind(store),
	};
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const options = { strictTtl: false, ...url.parse(t.context.s.url + endpoint) };
	t.plan(1);
	await cacheableRequestHelper(options);
});
test('Setting opts.maxTtl will limit the TTL', async t => {
	const endpoint = '/cache';
	const store = new Map();
	const cache = {
		get: store.get.bind(store),
		set(key: any, value: any, ttl: number) {
			t.is(ttl, 1000);
			return store.set(key, value);
		},
		delete: store.delete.bind(store),
	};
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const options = {
		...url.parse(t.context.s.url + endpoint),
		maxTtl: 1000,
	};
	t.plan(1);
	await cacheableRequestHelper(options);
});
test('Setting opts.maxTtl when opts.strictTtl is true will use opts.maxTtl if it\'s smaller', async t => {
	const endpoint = '/cache';
	const store = new Map();
	const cache = {
		get: store.get.bind(store),
		set(key: any, value: any, ttl: number) {
			t.true(ttl === 1000);
			return store.set(key, value);
		},
		delete: store.delete.bind(store),
	};
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const options = {
		...url.parse(t.context.s.url + endpoint),
		strictTtl: true,
		maxTtl: 1000,
	};
	t.plan(1);
	await cacheableRequestHelper(options);
});
test('Setting opts.maxTtl when opts.strictTtl is true will use remote TTL if it\'s smaller', async t => {
	const endpoint = '/cache';
	const store = new Map();
	const cache = {
		get: store.get.bind(store),
		set(key: any, value: any, ttl: number) {
			t.true(ttl < 100_000);
			return store.set(key, value);
		},
		delete: store.delete.bind(store),
	};
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const options = {
		...url.parse(t.context.s.url + endpoint),
		strictTtl: true,
		maxTtl: 100_000,
	};
	t.plan(1);
	await cacheableRequestHelper(options);
});
test('Stale cache entries with Last-Modified headers are revalidated', async t => {
	const endpoint = '/last-modified';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const firstResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	const secondResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	t.is(cache.size, 1);
	t.is(firstResponse.statusCode, 200);
	t.is(secondResponse.statusCode, 200);
	t.false(firstResponse.fromCache);
	t.true(secondResponse.fromCache);
	t.is(firstResponse.body, 'last-modified');
	t.is(firstResponse.body, secondResponse.body);
});
test('Stale cache entries with ETag headers are revalidated', async t => {
	const endpoint = '/etag';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const firstResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	const secondResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	t.is(cache.size, 1);
	t.is(firstResponse.statusCode, 200);
	t.is(secondResponse.statusCode, 200);
	t.false(firstResponse.fromCache);
	t.true(secondResponse.fromCache);
	t.is(firstResponse.body, 'etag');
	t.is(firstResponse.body, secondResponse.body);
});
test('Stale cache entries that can\'t be revalidate are deleted from cache', async t => {
	const endpoint = '/cache-then-no-store-on-revalidate';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const firstResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	t.is(cache.size, 1);
	const secondResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	t.is(cache.size, 0);
	t.is(firstResponse.statusCode, 200);
	t.is(secondResponse.statusCode, 200);
	t.is(firstResponse.body, 'cache-then-no-store-on-revalidate');
	t.is(firstResponse.body, secondResponse.body);
});
test('Response objects have fromCache property set correctly', async t => {
	const endpoint = '/cache';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const response: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	const cachedResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	t.false(response.fromCache);
	t.true(cachedResponse.fromCache);
});
test('Revalidated responses that are modified are passed through', async t => {
	const endpoint = '/revalidate-modified';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const firstResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	const secondResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	t.is(firstResponse.statusCode, 200);
	t.is(secondResponse.statusCode, 200);
	t.is(firstResponse.body, 'revalidate-modified');
	t.is(secondResponse.body, 'new-body');
});
test('Undefined callback parameter inside cache logic is handled', async t => {
	const endpoint = '/cache';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	await cacheableRequestHelper(t.context.s.url + endpoint);
	cacheableRequest(t.context.s.url + endpoint, undefined);
	await delay(500);
	t.pass();
});
test('Custom Keyv instance adapters used', async t => {
	const cache = new Keyv();
	const endpoint = '/cache';
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const response: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	const cached = await cache.get(`GET:${t.context.s.url + endpoint}`);
	t.is(response.body, cached.body.toString());
});
test('Keyv cache adapters load via connection uri', async t => {
	const endpoint = '/cache';
	const cacheableRequest = CacheableRequest(
		request,
		'sqlite://test/testdb.sqlite',
	);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const db = new sqlite3.Database('test/testdb.sqlite');
	const query = await pify(db.all.bind(db));
	const firstResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	await delay(1000);
	const secondResponse: any = await cacheableRequestHelper(t.context.s.url + endpoint);
	const cacheResult = await query(
		`SELECT * FROM keyv WHERE "key" = "cacheable-request:GET:${
			t.context.s.url + endpoint
		}"`,
	);
	t.false(firstResponse.fromCache);
	t.true(secondResponse.fromCache);
	t.is(cacheResult.length, 1);
	await query('DELETE FROM keyv');
});
test('ability to force refresh', async t => {
	const endpoint = '/cache';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const options = url.parse(t.context.s.url + endpoint);
	const firstResponse: any = await cacheableRequestHelper(options);
	const secondResponse: any = await cacheableRequestHelper({
		...options,
		forceRefresh: true,
	});
	const thirdResponse: any = await cacheableRequestHelper(options);
	t.not(firstResponse.body, secondResponse.body);
	t.is(secondResponse.body, thirdResponse.body);
});
test('checks status codes when comparing cache & response', async t => {
	const endpoint = '/first-error';
	const cache = new Map();
	const cacheableRequest = CacheableRequest(request, cache);
	const cacheableRequestHelper = promisify(cacheableRequest);
	const options = url.parse(t.context.s.url + endpoint);
	const firstResponse: any = await cacheableRequestHelper(options);
	const secondResponse: any = await cacheableRequestHelper(options);
	t.is(firstResponse.body, 'received 502');
	t.is(secondResponse.body, 'ok');
});

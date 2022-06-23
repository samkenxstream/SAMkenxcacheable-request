import { request } from 'node:http';
import test from 'ava';
import Keyv from 'keyv';
import CacheableRequest from '../src/index.js';

test('CacheableRequest is a function', t => {
	t.is(typeof CacheableRequest, 'function');
});
test('CacheableRequest cannot be invoked without \'new\'', t => {
	t.notThrows(() => CacheableRequest(request, {}));
});
test('CacheableRequest accepts Keyv instance', t => {
	t.notThrows(() => CacheableRequest(request, new Keyv()));
});

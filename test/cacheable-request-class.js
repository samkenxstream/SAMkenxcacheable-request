import { request } from 'node:http';
import test from 'ava';
import Keyv from 'keyv';
import CacheableRequest from '../dist/index.js';

test('CacheableRequest is a function', t => {
	t.is(typeof CacheableRequest, 'function');
});
test('CacheableRequest cannot be invoked without \'new\'', t => {
	t.notThrows(() => new CacheableRequest(request));
});
test('CacheableRequest throws TypeError if request fn isn\'t passed in', t => {
	const error = t.throws(() => {
		new CacheableRequest(); // eslint-disable-line no-new
	}, undefined);
	t.is(error.message, 'Parameter `request` must be a function');
});
test('CacheableRequest accepts Keyv instance', t => {
	t.notThrows(() => new CacheableRequest(request, new Keyv()));
});

import { request } from 'node:http';
import Keyv from 'keyv';
import CacheableRequest from '../src/index'; // eslint-disable-line import/extensions

test('CacheableRequest is a function', () => {
	expect(typeof CacheableRequest).toBe('function');
});
test('CacheableRequest cannot be invoked without \'new\'', () => {
	expect(() => CacheableRequest(request, {})).not.toThrow();
});
test('CacheableRequest accepts Keyv instance', () => {
	expect(() => CacheableRequest(request, new Keyv())).not.toThrow();
});

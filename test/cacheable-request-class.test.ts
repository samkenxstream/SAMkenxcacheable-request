import {request} from 'node:http';
import Keyv from 'keyv';
import CacheableRequest from '../src/index.js';

test('CacheableRequest is a function', () => {
	expect(typeof CacheableRequest).toBe('function');
});
test('CacheableRequest accepts Keyv instance', () => {
	expect(() => CacheableRequest(request, new Keyv())).not.toThrow();
});

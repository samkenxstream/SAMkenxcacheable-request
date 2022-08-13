import {request} from 'node:http';
import Keyv from 'keyv';
import CacheableRequest from '../src/index.js';

test('CacheableRequest is a function', () => {
	expect(typeof CacheableRequest).toBe('function');
});
test('CacheableRequest cannot be invoked without \'new\'', () => {
	expect(() => CacheableRequest(request, {})).not.toThrow();
});
test('CacheableRequest accepts Keyv instance', () => {
	expect(() => CacheableRequest(request, new Keyv())).not.toThrow();
});

test('CacheableRequest should accept hook', () => {
	CacheableRequest.addHook('response', (response: any) => response);
	expect(CacheableRequest.getHook('response')).not.toBeUndefined();
	expect(CacheableRequest.getHook('not')).toBeUndefined();
});

test('CacheableRequest should remove hook', () => {
	CacheableRequest.addHook('response', (response: any) => response);
	expect(CacheableRequest.getHook('response')).not.toBeUndefined();
	CacheableRequest.removeHook('response');
	expect(CacheableRequest.getHook('response')).toBeUndefined();
});

test('CacheableRequest should run hook', async () => {
	CacheableRequest.addHook('response', (response: any) => response);
	expect(CacheableRequest.getHook('response')).not.toBeUndefined();
	const value = await CacheableRequest.runHook('response', 10);
	expect(value).toBe(10);
});

test('CacheableRequest should not run hook if response is not provided', async () => {
	CacheableRequest.addHook('response', (response: any) => response);
	expect(CacheableRequest.getHook('response')).not.toBeUndefined();
	const value = await CacheableRequest.runHook('response', undefined);
	expect(value.message).toBe('runHooks requires response argument');
	expect(value).toBeInstanceOf(CacheableRequest.CacheError);
});

/* eslint-disable */
'use strict';

import http from 'node:http';
import https from 'node:https';
import express from 'express';
import pify from 'pify';
import bodyParser from 'body-parser';
import pem from 'pem';
import devcert from 'devcert';

const createTestServer = (opts = {}) => createCert(opts.certificate)
	.then(keys => {
		const server = express();
		server.http = http.createServer(server);
		
		server.set('etag', false);

		if (opts.bodyParser !== false) {
			server.use(bodyParser.json(Object.assign({ limit: '1mb', type: 'application/json' }, opts.bodyParser)));
			server.use(bodyParser.text(Object.assign({ limit: '1mb', type: 'text/plain' }, opts.bodyParser)));
			server.use(bodyParser.urlencoded(Object.assign({ limit: '1mb', type: 'application/x-www-form-urlencoded', extended: true }, opts.bodyParser)));
			server.use(bodyParser.raw(Object.assign({ limit: '1mb', type: 'application/octet-stream' }, opts.bodyParser)));
		}

		const send = fn => (req, res, next) => {
			const cb = typeof fn === 'function' ? fn(req, res, next) : fn;

			Promise.resolve(cb).then(val => {
				if (val) {
					res.send(val);
				}
			});
		};

		const get = server.get.bind(server);
		server.get = function () {
			const [path, ...handlers] = [...arguments];

			for (const handler of handlers) {
				get(path, send(handler));
			}
		};

		server.listen = () => Promise.all([
			pify(server.http.listen.bind(server.http))().then(() => {
				server.port = server.http.address().port;
				server.url = `http://localhost:${server.port}`;
			})
		]);

		server.close = () => Promise.all([
			pify(server.http.close.bind(server.http))().then(() => {
				server.port = undefined;
				server.url = undefined;
			})
		]);

		return server.listen().then(() => server);
	});

	const createCert = opts => {
		opts = Object.assign({
			days: 365,
			commonName: 'example.com'
		}, typeof opts === 'string' ? { commonName: opts } : opts);
	
		return pify(pem.createCertificate)({
			days: opts.days,
			selfSigned: true
		}).then(caKeys => pify(pem.createCertificate)(Object.assign({
			serviceCertificate: caKeys.certificate,
			serviceKey: caKeys.serviceKey,
			serial: Date.now()
		}, opts)).then(keys => ({
			key: keys.clientKey,
			cert: keys.certificate,
			caCert: caKeys.certificate
		})));
	};

export default createTestServer;
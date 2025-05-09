import assert from 'node:assert/strict';
import {once} from 'node:events';
import {type AddressInfo, createServer} from 'node:net';
import {describe, test} from 'node:test';
import {KaitoServer, type ServeUserOptions} from './index.ts';

async function getPort(): Promise<number> {
	const server = createServer();
	server.listen(0);
	await once(server, 'listening');
	const port = (server.address() as AddressInfo).port;
	server.close();
	return port;
}

async function createTestServer(options: Partial<ServeUserOptions> = {}) {
	const port = await getPort();
	const server = await KaitoServer.serve({
		port,
		fetch: options.fetch ?? (async () => new Response('ok')),
		...options,
	});
	return server;
}

describe('KaitoServer', () => {
	test('basic GET request', async () => {
		const server = await createTestServer({
			fetch: async req => {
				assert.equal(req.method, 'GET');
				return new Response('ok');
			},
		});

		try {
			const res = await fetch(server.url);
			assert.equal(await res.text(), 'ok');
		} finally {
			server.close();
		}
	});

	test('request with query parameters', async () => {
		const server = await createTestServer({
			fetch: async req => {
				const url = new URL(req.url);
				assert.equal(url.searchParams.get('foo'), 'bar');
				assert.equal(url.searchParams.get('baz'), 'qux');
				return new Response('ok');
			},
		});

		try {
			const res = await fetch(`${server.url}/?foo=bar&baz=qux`);
			assert.equal(await res.text(), 'ok');
		} finally {
			server.close();
		}
	});

	test('POST request with JSON body', async () => {
		const testData = {hello: 'world'};

		const server = await createTestServer({
			fetch: async req => {
				assert.equal(req.method, 'POST');
				assert.equal(req.headers.get('content-type'), 'application/json');
				const body = await req.json();
				assert.deepEqual(body, testData);
				return new Response('ok');
			},
		});

		try {
			const res = await fetch(server.url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(testData),
			});
			assert.equal(await res.text(), 'ok');
		} finally {
			server.close();
		}
	});

	test('POST request with large body (streaming)', async () => {
		const largeData = Buffer.alloc(100_000).fill('x').toString();

		const server = await createTestServer({
			fetch: async req => {
				assert.equal(req.method, 'POST');
				const body = await req.text();
				assert.equal(body, largeData);
				return new Response('ok');
			},
		});

		try {
			const res = await fetch(server.url, {
				method: 'POST',
				body: largeData,
			});
			assert.equal(await res.text(), 'ok');
		} finally {
			server.close();
		}
	});

	test('custom headers', async () => {
		const server = await createTestServer({
			fetch: async req => {
				assert.equal(req.headers.get('x-custom-header'), 'test-value');
				return new Response('ok', {
					headers: {
						'x-response-header': 'response-value',
					},
				});
			},
		});

		try {
			const res = await fetch(server.url, {
				headers: {
					'x-custom-header': 'test-value',
				},
			});
			assert.equal(res.headers.get('x-response-header'), 'response-value');
		} finally {
			server.close();
		}
	});

	test('streaming response', async () => {
		const chunks = ['Hello', ' ', 'World'];
		const encoder = new TextEncoder();

		const server = await createTestServer({
			fetch: async () => {
				const stream = new ReadableStream({
					async start(controller) {
						for (const chunk of chunks) {
							controller.enqueue(encoder.encode(chunk));
						}
						controller.close();
					},
				});

				return new Response(stream);
			},
		});

		try {
			const res = await fetch(server.url);
			const text = await res.text();
			assert.equal(text, chunks.join(''));
		} finally {
			server.close();
		}
	});

	test('response status codes', async () => {
		const server = await createTestServer({
			fetch: async () => {
				return new Response('not found', {
					status: 404,
					statusText: 'Not Found',
				});
			},
		});

		try {
			const res = await fetch(server.url);
			assert.equal(res.status, 404);
			assert.equal(res.statusText, 'Not Found');
			assert.equal(await res.text(), 'not found');
		} finally {
			server.close();
		}
	});

	test('multiple concurrent requests', async () => {
		let requestCount = 0;

		const server = await createTestServer({
			fetch: async () => {
				requestCount++;
				return new Response('ok');
			},
		});

		try {
			const requests = Array.from({length: 10}, () => fetch(server.url));
			await Promise.all(requests);
			assert.equal(requestCount, 10);
		} finally {
			server.close();
		}
	});

	test('request with non-default host', async () => {
		const port = await getPort();
		const server = await KaitoServer.serve({
			port,
			host: '127.0.0.1',
			fetch: async req => {
				const url = new URL(req.url);
				assert.equal(url.hostname, '127.0.0.1');
				return new Response('ok');
			},
		});

		try {
			const res = await fetch(server.url);
			assert.equal(await res.text(), 'ok');
		} finally {
			server.close();
		}
	});

	test('binary data handling', async () => {
		const binaryData = new Uint8Array([1, 2, 3, 4, 5]);

		const server = await createTestServer({
			fetch: async req => {
				const body = new Uint8Array(await req.arrayBuffer());
				assert.deepEqual(body, binaryData);
				return new Response(body);
			},
		});

		try {
			const res = await fetch(server.url, {
				method: 'POST',
				body: binaryData,
			});
			const responseData = new Uint8Array(await res.arrayBuffer());
			assert.deepEqual(responseData, binaryData);
		} finally {
			server.close();
		}
	});

	// test('static routes', async () => {
	// 	const server = await createTestServer({
	// 		static: {
	// 			'/static/file.txt': new Response('Hello, world!'),
	// 			'/static/stream': new Response(
	// 				new ReadableStream({
	// 					async start(controller) {
	// 						controller.enqueue(new TextEncoder().encode('Hello, world!'));
	// 						controller.close();
	// 					},
	// 				}),
	// 			),
	// 		},
	// 	});

	// 	try {
	// 		const res = await fetch(server.url + '/static/file.txt');
	// 		assert.equal(await res.text(), 'Hello, world!');

	// 		const streamed = await fetch(server.url + '/static/file.txt');
	// 		assert.equal(await streamed.text(), 'Hello, world!');
	// 	} finally {
	// 		server.close();
	// 	}
	// });
});

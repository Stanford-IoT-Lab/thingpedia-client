// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2018 The Board of Trustees of the Leland Stanford Junior University
//                Google LLC
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details
"use strict";

const assert = require('assert');
const Tp = require('thingpedia');
const qs = require('qs');
const Url = require('url');
const tough = require('tough-cookie');

const { toClassDef, mockClient, mockPlatform, mockEngine, State } = require('./mock');
const { ImplementationError } = require('../lib/errors');

const Modules = require('../lib/loaders');
const ModuleDownloader = require('../lib/downloader');

async function testPoll(instance, fn) {
    await new Promise((resolve, reject) => {
        let finished = false;
        setTimeout(() => {
            if (finished)
                resolve();
            else
                reject(new assert.AssertionError('Timed out'));
        }, 20000);

        const stream = instance['subscribe_' + fn]({}, new State);
        let count = 0;
        stream.on('data', (data) => {
            try {
                if (finished)
                    assert.fail('too many results');
                delete data.__timestamp;
                assert.deepStrictEqual(data, {
                    url: new Tp.Value.Entity('https://httpbin.org/get', null),
                    user_agent: new Tp.Value.Entity("Thingpedia/1.0.0 nodejs/" + process.version, null)
                });
                count++;
                if (count === 2) {
                    stream.destroy();
                    finished = true;
                }
            } catch(e) { reject(e); }
        });
        stream.on('end', () => {
            reject(new assert.AssertionError('Stream ended unexpected'));
        });
    });
}

async function testBasic() {
    const metadata = toClassDef(await mockClient.getDeviceCode('org.httpbin'));

    const downloader = new ModuleDownloader(mockPlatform, mockClient);
    const module = new (Modules['org.thingpedia.generic_rest.v1'])('org.httpbin', metadata, downloader);

    assert.strictEqual(module.id, 'org.httpbin');
    assert.strictEqual(module.version, 1);

    const factory = await module.getDeviceClass();

    assert(factory.prototype instanceof Tp.BaseDevice);
    assert.strictEqual(typeof factory.prototype.get_get, 'function');
    assert.strictEqual(typeof factory.prototype.subscribe_get, 'function');

    const instance = new factory(mockEngine, {});
    assert.deepStrictEqual(await instance.get_get({}), [{
        url: new Tp.Value.Entity('https://httpbin.org/get', null),
        user_agent: new Tp.Value.Entity("Thingpedia/1.0.0 nodejs/" + process.version, null),
    }]);
    await testPoll(instance, 'get');

    assert.deepStrictEqual(await instance.get_get_nomonitor({}), [{
        url: new Tp.Value.Entity('https://httpbin.org/get', null),
        user_agent: new Tp.Value.Entity("Thingpedia/1.0.0 nodejs/" + process.version, null),
    }]);
    assert.strictEqual(typeof factory.prototype.subscribe_get_nomonitor, 'function');
    assert.throws(() => instance.subscribe_get_nomonitor({}, new State));

    assert.deepStrictEqual(await instance.get_get_args({ input: 'foo' }), [{
        output: 'foo'
    }]);
    assert.deepStrictEqual(await instance.get_get_args({ input: 'bar' }), [{
        output: 'bar'
    }]);

    assert.deepStrictEqual(await instance.get_post_query({ input: 'foo' }), [{
        url: new Tp.Value.Entity('https://httpbin.org/post', null),
        output: 'foo'
    }]);
    assert.deepStrictEqual(await instance.get_post_query({ input: 'bar' }), [{
        url: new Tp.Value.Entity('https://httpbin.org/post', null),
        output: 'bar'
    }]);

    await instance.do_post_action({ input: 'foo' });
    await instance.do_put_action({ input: 'foo' });
}

function assertIsGetter(object, prop, { configurable, enumerable }) {
    const descriptor = Object.getOwnPropertyDescriptor(object, prop);
    assert.strictEqual(typeof descriptor.value, 'undefined');
    assert.strictEqual(typeof descriptor.get, 'function');
    assert.strictEqual(descriptor.configurable, configurable);
    assert.strictEqual(descriptor.enumerable, enumerable);
}

async function testOAuth() {
    const metadata = toClassDef(await mockClient.getDeviceCode('org.httpbin.oauth'));

    const downloader = new ModuleDownloader(mockPlatform, mockClient);
    const module = new (Modules['org.thingpedia.generic_rest.v1'])('org.httpbin.oauth', metadata, downloader);

    assert.strictEqual(module.id, 'org.httpbin.oauth');
    assert.strictEqual(module.version, 1);

    const factory = await module.getDeviceClass();

    assertIsGetter(factory.prototype, 'accessToken', {
        configurable: false,
        enumerable: true
    });
    assertIsGetter(factory.prototype, 'refreshToken', {
        configurable: false,
        enumerable: true
    });

    const instance = new factory(mockEngine, { accessToken: 'my-example-token' });
    assert.deepStrictEqual(await instance.get_get({}), [{
        authenticated: true,
        token: 'my-example-token',
    }]);
}

function browserRequest(url, method, data, session, options = {}) {
    if (method === 'POST') {
        if (data !== null && typeof data !== 'string')
            data = qs.stringify(data);
        if (data)
            data += '&_csrf=' + session.csrfToken;
        else
            data = '_csrf=' + session.csrfToken;
        options.dataContentType = 'application/x-www-form-urlencoded';
    } else {
        if (data !== null && typeof data !== 'string') {
            url += '?' + qs.stringify(data);
            data = null;
        }
    }
    if (!options.extraHeaders)
        options.extraHeaders = {};
    options.extraHeaders.Cookie = session.cookie;

    return Tp.Helpers.Http.request(url, method, data, options);
}

function assertRedirect(request, redirect) {
    return request.then(() => {
        assert.fail(new Error(`Expected HTTP redirect`));
    }, (err) => {
        if (!err.detail || !err.code)
            throw err;
        if (err.code < 300 || err.code >= 400)
            throw err;

        return err.redirect;
    });
}

function accumulateStream(stream) {
    return new Promise((resolve, reject) => {
        const buffers = [];
        let length = 0;
        stream.on('data', (buf) => {
            buffers.push(buf);
            length += buf.length;
        });
        stream.on('end', () => resolve(Buffer.concat(buffers, length)));
        stream.on('error', reject);
    });
}

async function startSession(url) {
    const loginStream = await Tp.Helpers.Http.getStream(url);
    const cookieHeader = loginStream.headers['set-cookie'][0];
    assert(cookieHeader);
    const cookie = tough.Cookie.parse(cookieHeader);

    const loginResponse = (await accumulateStream(loginStream)).toString();
    const match = / data-csrf-token="([^"]+)"/.exec(loginResponse);
    const csrfToken = match[1];
    return { csrfToken, cookie: cookie.cookieString() };
}

async function testAlmondOAuth() {
    const metadata = toClassDef(await mockClient.getDeviceCode('edu.stanford.almond-dev'));

    const downloader = new ModuleDownloader(mockPlatform, mockClient);
    const module = new (Modules['org.thingpedia.generic_rest.v1'])('edu.stanford.almond-dev', metadata, downloader);

    assert.strictEqual(module.id, 'edu.stanford.almond-dev');
    assert.strictEqual(module.version, 1);

    const factory = await module.getDeviceClass();

    assertIsGetter(factory.prototype, 'accessToken', {
        configurable: false,
        enumerable: true
    });
    assertIsGetter(factory.prototype, 'refreshToken', {
        configurable: false,
        enumerable: true
    });

    console.log('start run oauth');
    const [redirectToAlmond, oauthSession] = await factory.runOAuth2(mockEngine, null);

    assert.strictEqual(typeof oauthSession['oauth2-state-edu.stanford.almond-dev'], 'string');
    assert.strictEqual(redirectToAlmond, `https://almond-dev.stanford.edu/me/api/oauth2/authorize?response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fdevices%2Foauth2%2Fcallback%2Fedu.stanford.almond-dev&state=${oauthSession['oauth2-state-edu.stanford.almond-dev']}&scope=profile&client_id=5524304f0ce9cb5c`);

    console.log('login + authorize');
    // login to almond-dev
    const browserSession = await startSession('https://almond-dev.stanford.edu/user/login');
    await browserRequest('https://almond-dev.stanford.edu/user/login', 'POST', {
        username: 'testuser',
        password: '12345678',
    }, browserSession);

    // get almond-dev to issue an access token...
    // note the client ID we use has special test ability skips authorization
    const redirectToUs = await assertRedirect(browserRequest(redirectToAlmond, 'GET', '', browserSession, {
        followRedirects: false
    }));

    console.log('obtained redirect with code');
    assert(redirectToUs.startsWith('http://127.0.0.1:3000/devices/oauth2/callback/edu.stanford.almond-dev'));
    const parsedRedirect = Url.parse(redirectToUs, { parseQueryString: true });
    const req = {
        httpVersion: 1.0,
        headers: [],
        rawHeaders: [],

        method: 'GET',
        url: redirectToUs,
        query: parsedRedirect.query,
        session: oauthSession
    };

    console.log('second run oauth');

    const mockDevices = {
        loadOneDevice(state, addToDB) {
            assert.strictEqual(state.kind, 'edu.stanford.almond-dev');
            assert.strictEqual(addToDB, true);
            return new factory(mockEngine, state);
        }
    };
    const mockEngineWithDevices = Object.create(mockEngine, {
        devices: {
            configurable: true,
            enumerable: true,
            value: mockDevices,
            writable: false
        }
    });
    const instance = await factory.runOAuth2(mockEngineWithDevices, req);

    //assert.strictEqual(instance.uniqueId, 'edu.stanford.almond-dev-517e033d9b977261');
    assert.strictEqual(typeof instance.accessToken, 'string');
    assert.strictEqual(typeof instance.refreshToken, 'string');

    assert.deepStrictEqual(await instance.get_user_info({}), [{
        username: 'testuser',
        email: new Tp.Value.Entity('me@gcampax.com', null),
        full_name: 'Test User',
        locale: 'en-US',
        model_tag: null,
        timezone: 'America/Los_Angeles'
    }]);
}

async function testBasicAuth() {
    const metadata = toClassDef(await mockClient.getDeviceCode('org.httpbin.basicauth'));

    const downloader = new ModuleDownloader(mockPlatform, mockClient);
    const module = new (Modules['org.thingpedia.generic_rest.v1'])('org.httpbin.basicauth', metadata, downloader);

    assert.strictEqual(module.id, 'org.httpbin.basicauth');
    assert.strictEqual(module.version, 1);

    const factory = await module.getDeviceClass();

    const instance1 = new factory(mockEngine, { username: 'fake-user', password: 'fake-password1' });
    assert.deepStrictEqual(await instance1.get_get({ input: 'fake-password1' }), [{
        authenticated: true,
        user: 'fake-user',
    }]);

    const instance2 = new factory(mockEngine, { username: 'fake-user', password: 'fake-password2' });
    assert.deepStrictEqual(await instance2.get_get({ input: 'fake-password2' }), [{
        authenticated: true,
        user: 'fake-user',
    }]);
}

async function testBroken() {
    // test that devices with developer errors report sensible, localized and easy to
    // understand errors

    const downloader = new ModuleDownloader(mockPlatform, mockClient);

    const metadata = toClassDef(await mockClient.getDeviceCode('org.httpbin.broken'));
    const module = new (Modules['org.thingpedia.generic_rest.v1'])('org.httpbin.broken', metadata, downloader);

    // assert that we cannot actually load this device
    await assert.rejects(() => module.getDeviceClass(), ImplementationError);
}

async function main() {
    await testBasic();
    await testOAuth();
    await testAlmondOAuth();
    await testBasicAuth();
    await testBroken();
}

module.exports = main;
if (!module.parent)
    main();

// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details
"use strict";

const assert = require('assert');
const child_process = require('child_process');

const Modules = require('../lib/modules');
const ModuleDownloader = require('../lib/downloader');
const { ImplementationError } = require('../lib/modules/errors');

const MyDevice = require('./device-classes/org.thingpedia.test.mydevice');
const { toClassDef, mockClient, mockPlatform, mockEngine, State } = require('./mock');

async function testDownloader() {
    const metadata = toClassDef(await mockClient.getDeviceCode('org.thingpedia.test.mydevice'));

    const downloader = new ModuleDownloader(mockPlatform, mockClient);
    const module = await downloader.getModule('org.thingpedia.test.mydevice');

    assert.strictEqual(module.id, 'org.thingpedia.test.mydevice');
    assert.strictEqual(module.version, 1);
    assert.deepStrictEqual(module.manifest, metadata);
}

async function testPreloaded() {
    const metadata = toClassDef(await mockClient.getDeviceCode('org.thingpedia.test.mydevice'));

    const downloader = new ModuleDownloader(mockPlatform, mockClient);
    const module = new (Modules['org.thingpedia.v2'])('org.thingpedia.test.mydevice', metadata, downloader);

    assert.strictEqual(module.id, 'org.thingpedia.test.mydevice');
    assert.strictEqual(module.version, 1);
    assert.strictEqual(module.manifest, metadata);

    const factory = await module.getDeviceFactory();

    assert.strictEqual(factory, MyDevice);
    //assert.strictEqual(factory.metadata, metadata);
    assert.deepStrictEqual(factory.require('package.json'), {"name":"org.thingpedia.test.mydevice",
        "main": "index.js",
        "thingpedia-version":1
    });

    const d = new factory(mockEngine, { kind: 'org.thingpedia.test.mydevice' });
    assert.strictEqual(typeof d.get_something, 'function');
    assert.strictEqual(typeof d.get_something_poll, 'function');
    assert.strictEqual(typeof d.subscribe_something, 'function');
    assert.strictEqual(typeof d.subscribe_something_poll, 'function');
    assert.strictEqual(typeof d.history_something, 'function');
    assert.strictEqual(typeof d.history_something_poll, 'function');
    assert.strictEqual(typeof d.sequence_something, 'function');
    assert.strictEqual(typeof d.sequence_something_poll, 'function');
    assert.strictEqual(typeof d.do_something_else, 'function');

    assert.deepStrictEqual(await d.get_something(), [
        {v1: 'foo', v2: 42}
    ]);
    await new Promise((resolve, reject) => {
        let finished = false;
        setTimeout(() => {
            if (finished)
                resolve();
            else
                reject(new assert.AssertionError('Timed out'));
        }, 5000);

        const stream = d.subscribe_something({}, new State);
        let expect = 42;
        stream.on('data', (data) => {
            try {
                if (finished)
                    assert.fail('too many results');
                delete data.__timestamp;
                assert.deepStrictEqual(data, {
                    v1: 'foo',
                    v2: expect
                });
                expect ++;
                if (expect === 44) {
                    stream.destroy();
                    finished = true;
                }
            } catch(e) { reject(e); }
        });
        stream.on('end', () => {
            reject(new assert.AssertionError('Stream ended unexpected'));
        });
    });
    await new Promise((resolve, reject) => {
        let finished = false;
        setTimeout(() => {
            if (finished)
                resolve();
            else
                reject(new assert.AssertionError('Timed out'));
        }, 5000);

        const stream = d.subscribe_something_poll({}, new State);
        let count = 0;
        stream.on('data', (data) => {
            try {
                if (finished)
                    assert.fail('too many results');
                delete data.__timestamp;
                assert.deepStrictEqual(data, {
                    v1: 'foo',
                    v2: 42
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
    assert.throws(() => {
        d.subscribe_something_nomonitor();
    });

    await module.clearCache();

    const factory2 = await module.getDeviceFactory();
    assert(factory2 !== MyDevice);
}

async function testSubdevice() {
    const collectionMetadata = toClassDef(await mockClient.getDeviceCode('org.thingpedia.test.collection'));
    //const subMetadata = toClassDef(await mockClient.getDeviceCode('org.thingpedia.test.subdevice'));

    const downloader = new ModuleDownloader(mockPlatform, mockClient);

    const collectionModule = new (Modules['org.thingpedia.v2'])('org.thingpedia.test.collection',
                                                                collectionMetadata,
                                                                downloader);
    assert.strictEqual(collectionModule.id, 'org.thingpedia.test.collection');

    // this will also load the subdevices
    const collectionFactory = await collectionModule.getDeviceFactory();

    assert.strictEqual(typeof collectionFactory.prototype.get_get_data, 'undefined');
    assert.strictEqual(typeof collectionFactory.prototype.do_eat_data, 'undefined');

    const subFactory = collectionFactory.subdevices['org.thingpedia.test.subdevice'];

    //assert.deepStrictEqual(subFactory.metadata, subMetadata);

    assert.strictEqual(typeof subFactory.prototype.get_get_data, 'function');
    assert.strictEqual(typeof subFactory.prototype.do_eat_data, 'function');
}

async function testBrokenDevices() {
    // test that devices with developer errors report sensible, localized and easy to
    // understand errors

    const downloader = new ModuleDownloader(mockPlatform, mockClient);

    for (let err of ['noaction', 'noquery', 'nosubscribe']) {
        const metadata = toClassDef(await mockClient.getDeviceCode('org.thingpedia.test.broken.' + err));
        const module = new (Modules['org.thingpedia.v2'])('org.thingpedia.test.broken.' + err,
                                                          metadata, downloader);

        // assert that we cannot actually load this device
        await assert.rejects(() => module.getDeviceFactory(), ImplementationError);
    }

    // now load a device where the error is at runtime
    const metadata = toClassDef(await mockClient.getDeviceCode('org.thingpedia.test.broken'));
    const module = new (Modules['org.thingpedia.v2'])('org.thingpedia.test.broken',
                                                      metadata, downloader);
    // this should load correctly
    const factory = await module.getDeviceFactory();
    const instance = new factory(mockEngine, { kind: 'org.thingpedia.test.broken' });

    // the methods in this class don't throw an error, but they
    // also don't return the correct result
    await assert.rejects(() => instance.get_something_poll1(), ImplementationError);
    await assert.rejects(() => instance.get_something_poll2(), ImplementationError);
    await assert.rejects(() => instance.get_something_poll3(), ImplementationError);
    await assert.rejects(() => instance.get_something_poll4(), ImplementationError);
    await assert.throws(() => instance.subscribe_something(), ImplementationError);
}

async function testThingpedia() {
    child_process.spawnSync('rm', ['-rf', mockPlatform.getCacheDir() + '/device-classes/com.xkcd']);

    const metadata = toClassDef(await mockClient.getDeviceCode('com.xkcd'));
    const downloader = new ModuleDownloader(mockPlatform, mockClient);

    const module = new (Modules['org.thingpedia.v2'])('com.xkcd', metadata, downloader);

    assert.strictEqual(module.id, 'com.xkcd');
    assert(module.version >= 91);
    assert.strictEqual(module.manifest, metadata);

    const factory = await module.getDeviceFactory();

    //assert.strictEqual(factory.metadata, metadata);
    assert.strictEqual(typeof factory.prototype.get_get_comic, 'function');
    assert.strictEqual(typeof factory.prototype.subscribe_get_comic, 'function');
    assert.strictEqual(typeof factory.prototype.get_random_comic, 'function');
    assert.strictEqual(typeof factory.prototype.subscribe_random_comic, 'function');
}

async function testPkgVersion() {
    const downloader = new ModuleDownloader(mockPlatform, mockClient);
    const module = await downloader.getModule('org.thingpedia.test.pkgversion');

    assert.strictEqual(module.id, 'org.thingpedia.test.pkgversion');
    assert.strictEqual(module.version, 2);
    assert.strictEqual(module.package_version, 0);

    await module.getDeviceFactory();
}

async function main() {
    await testPreloaded();
    await testSubdevice();
    await testBrokenDevices();
    await testThingpedia();
    await testDownloader();
    await testPkgVersion();
}
module.exports = main;
if (!module.parent)
    main();

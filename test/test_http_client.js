// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2018 Google LLC
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details
"use strict";

require('./mock');

const assert = require('assert');
const ThingTalk = require('thingtalk');

const HttpClient = require('../lib/http_client');

const _mockPlatform = {
    getDeveloperKey() {
        return null;
    },

    get locale() {
        return 'en-US';
    }
};
const _mockDeveloperPlatform = {
    getDeveloperKey() {
        if (!process.env.THINGENGINE_DEVELOPER_KEY)
            throw new Error('Invalid test setup: missing THINGENGINE_DEVELOPER_KEY');
        return process.env.THINGENGINE_DEVELOPER_KEY;
    },

    get locale() {
        return 'en-US';
    }
};
const THINGPEDIA_URL = process.env.THINGPEDIA_URL || 'https://almond-dev.stanford.edu/thingpedia';

const _httpClient = new HttpClient(_mockPlatform, THINGPEDIA_URL);
const _schemaRetriever = new ThingTalk.SchemaRetriever(_httpClient, null, true);
const _developerHttpClient = new HttpClient(_mockDeveloperPlatform, THINGPEDIA_URL);
//const _developerSchemaRetriever = new ThingTalk.SchemaRetriever(_developerHttpClient, null, true);

async function checkValidManifest(manifest, moduleType) {
    const parsed = await ThingTalk.Grammar.parseAndTypecheck(manifest, _schemaRetriever);
    assert(parsed.isMeta);
    assert.strictEqual(parsed.classes.length, 1);
    assert.strictEqual(parsed.datasets.length, 0);

    const classDef = parsed.classes[0];
    assert.strictEqual(classDef.loader.module, moduleType);
    assert(classDef.annotations.version.isNumber);
}

async function testGetDeviceCode() {
    const nytimes = await _httpClient.getDeviceCode('com.nytimes');
    await checkValidManifest(nytimes, 'org.thingpedia.rss');

    const bing = await _httpClient.getDeviceCode('com.bing');
    await checkValidManifest(bing, 'org.thingpedia.v2');

    const test = await _httpClient.getDeviceCode('org.thingpedia.builtin.test');
    await checkValidManifest(test, 'org.thingpedia.builtin');

    await assert.rejects(async () => {
        await _httpClient.getDeviceCode('org.thingpedia.builtin.test.invisible');
    });
    const invisibleTest = await _developerHttpClient.getDeviceCode('org.thingpedia.builtin.test.invisible');
    await checkValidManifest(invisibleTest, 'org.thingpedia.builtin');

    await assert.rejects(async () => {
        await _httpClient.getDeviceCode('org.thingpedia.builtin.test.nonexistent');
    });
}

async function testGetModuleLocation() {
    const test = await _httpClient.getModuleLocation('com.bing');
    assert(/^.*\/com\.bing-v[0-9]+\.zip$/.test(test),
          'Invalid response, got ' + test);

    // builtin.test is not downloadable
    await assert.rejects(async () => {
        await _httpClient.getModuleLocation('org.thingpedia.builtin.test');
    });

    await assert.rejects(async () => {
        await _httpClient.getModuleLocation('org.thingpedia.builtin.test.invisible');
    });

    await assert.rejects(async () => {
        await _httpClient.getModuleLocation('org.thingpedia.builtin.test.nonexistent');
    });
}

async function testGetSchemas(withMetadata) {
    const bing = await _httpClient.getSchemas(['com.bing'], withMetadata);
    const bingparsed = ThingTalk.Grammar.parse(bing);
    assert(bingparsed.isMeta);
    assert.strictEqual(bingparsed.classes.length, 1);
    assert.strictEqual(bingparsed.classes[0].kind, 'com.bing');

    const multiple = await _httpClient.getSchemas(['com.bing', 'com.twitter'], withMetadata);
    const mparsed = ThingTalk.Grammar.parse(multiple);
    assert(mparsed.isMeta);
    assert.strictEqual(mparsed.classes.length, 2);
    assert.strictEqual(mparsed.classes[0].kind, 'com.bing');
    assert.strictEqual(mparsed.classes[1].kind, 'com.twitter');

    assert(multiple.startsWith(bing));

    const invisible = await _httpClient.getSchemas(['org.thingpedia.builtin.test.invisible'], withMetadata);
    assert.deepStrictEqual(invisible, ``);

    const invisible2 = await _developerHttpClient.getSchemas(['org.thingpedia.builtin.test.invisible'], withMetadata);
    const invparsed = ThingTalk.Grammar.parse(invisible2);
    assert(invparsed.isMeta);
    assert.strictEqual(invparsed.classes.length, 1);
    assert.strictEqual(invparsed.classes[0].kind, 'org.thingpedia.builtin.test.invisible');

    const nonexistent = await _httpClient.getSchemas(['org.thingpedia.builtin.test.nonexistent'], withMetadata);
    assert.deepStrictEqual(nonexistent, ``);

    const mixed = await _httpClient.getSchemas(['com.bing', 'org.thingpedia.builtin.test.invisible', 'org.thingpedia.builtin.test.nonexistent'], withMetadata);
    assert.deepStrictEqual(mixed, bing);
}

function assertNonEmptyString(what) {
    assert(typeof what === 'string' && what, 'Expected a non-empty string, got ' + what);
}

async function testGetDeviceList(klass) {
    const publicDevices = new Set;

    const page0 = await _httpClient.getDeviceList(klass);

    // weird values for page are the same as ignored
    const pageMinusOne = await _httpClient.getDeviceList(klass, -1);
    assert.deepStrictEqual(pageMinusOne, page0);
    const pageInvalid = await _httpClient.getDeviceList(klass, 'invalid');
    assert.deepStrictEqual(pageInvalid, page0);

    for (let i = 0; ; i++) {
        const page = await _httpClient.getDeviceList(klass, i, 10);
        if (i === 0)
            assert.deepStrictEqual(page, page0);
        for (let j = 0; j < Math.min(page.length, 10); j++) {
            const device = page[j];
            assertNonEmptyString(device.name);
            assertNonEmptyString(device.description);
            assertNonEmptyString(device.primary_kind);
            assertNonEmptyString(device.category);
            assertNonEmptyString(device.subcategory);
            if (klass)
                assert.deepStrictEqual(device.category, klass);

            // no duplicates
            assert(!publicDevices.has(device.primary_kind));
            publicDevices.add(device.primary_kind);
        }
        if (page.length <= 10)
            break;
    }

    const developerDevices = new Set;

    for (let i = 0; ; i++) {
        const page = await _developerHttpClient.getDeviceList(klass, i, 10);
        for (let j = 0; j < Math.min(page.length, 10); j++) {
            const device = page[j];
            assert(!developerDevices.has(device.primary_kind));
            developerDevices.add(device.primary_kind);
        }
        if (page.length <= 10)
            break;
    }

    // every public device should be a developer device
    // this is a quick and dirty way to catch pagination errors
    for (let pubDevice of publicDevices) {
        assert(developerDevices.has(pubDevice),
               'Lost device ' + pubDevice);
    }
}

function objectEqual(o1, o2) {
    if (typeof o1 !== typeof o2)
        return false;
    if (typeof o1 !== 'object') {
        if (o1 === 'URL' && o2 === 'Entity(tt:url)')
            return true;
        if (o1 !== o2)
            console.log(o1, o2);
        return o1 === o2;
    }
    let fields = Object.keys(o1);
    for (let i = 0; i < fields.length; i++) {
        let field = fields[i];
        if (field === 'confirmation_remote' || field === 'API Endpoint URL')
            continue;
        if (!(field in o2)) {
            console.log(`missing field ${field}`);
            return false;
        }
        if (Array.isArray(o1[field]) && !arrayEqual(o1[field], o2[field]))
            return false;
        if (!objectEqual(o1[field], o2[field]))
            return false;
    }
    return true;
}

function arrayEqual(a1, a2) {
    if (!Array.isArray(a1) || !Array.isArray(a2))
        return false;
    if (a1.length !== a2.length)
        return false;
    for (let i = 0; i < a1.length; i++) {
        if (!objectEqual(a1[i], a2[i]))
            return false;
    }
    return true;
}

async function testGetDeviceListErrorCases() {
    await assert.rejects(() => _httpClient.getDeviceList('foo'));
}

async function testGetDeviceFactories(klass) {
    const devices = await _httpClient.getDeviceFactories(klass);

    for (let factory of devices) {
        assertNonEmptyString(factory.kind);
        assertNonEmptyString(factory.text);
        assert(['none', 'discovery', 'interactive', 'form', 'oauth2'].indexOf(factory.type) >= 0, 'Invalid factory type ' + factory.type + ' for ' + factory.kind);
    }
}

async function testGetDeviceFactoriesErrorCases() {
    await assert.rejects(() => _httpClient.getDeviceFactories('foo'));
}

async function testGetDeviceSetup() {
    const single = await _httpClient.getDeviceSetup(['com.bing']);

    assert.deepStrictEqual(single, {
        'com.bing': {
            kind: 'com.bing',
            category: 'data',
            type: 'none',
            text: "Bing Search"
        }
    });

    const multiple = await _httpClient.getDeviceSetup(['com.bing', 'com.twitter']);
    assert.deepStrictEqual(multiple, {
        'com.bing': {
            kind: 'com.bing',
            category: 'data',
            type: 'none',
            text: "Bing Search"
        },
        'com.twitter': {
            kind: 'com.twitter',
            category: 'online',
            type: 'oauth2',
            text: "Twitter Account"
        }
    });

    const nosetup = await _httpClient.getDeviceSetup(['com.bing', 'org.thingpedia.builtin.test']);
    assert.deepStrictEqual(nosetup, {
        'com.bing': {
            kind: 'com.bing',
            category: 'data',
            type: 'none',
            text: "Bing Search"
        },
        'org.thingpedia.builtin.test': {
            type: 'multiple',
            choices: []
        }
    });

    const nonexistent = await _httpClient.getDeviceSetup(['org.thingpedia.builtin.test.nonexistent']);
    assert.deepStrictEqual(nonexistent, {
        'org.thingpedia.builtin.test.nonexistent': {
            type: 'multiple',
            choices: []
        }
    });
}

async function testGetKindByDiscovery() {
    // malformed requests
    await assert.rejects(() => _httpClient.getKindByDiscovery({}));
    await assert.rejects(() => _httpClient.getKindByDiscovery({
        kind: 'invalid'
    }));
    await assert.rejects(() => _httpClient.getKindByDiscovery({
        kind: 'bluetooth',
        uuids: null,
        class: null
    }));

    const bluetoothSpeaker = await _httpClient.getKindByDiscovery({
        kind: 'bluetooth',
        uuids: ['0000110b-0000-1000-8000-00805f9b34fb'],
        class: 0
    });
    assert.deepStrictEqual(bluetoothSpeaker, 'org.thingpedia.bluetooth.speaker.a2dp');

    const genericBluetooth = await _httpClient.getKindByDiscovery({
        kind: 'bluetooth',
        uuids: [],
        class: 0
    });
    assert.deepStrictEqual(genericBluetooth, 'org.thingpedia.builtin.bluetooth.generic');

    const lgTv = await _httpClient.getKindByDiscovery({
        kind: 'upnp',
        name: '',
        deviceType: '',
        modelUrl: null,
        st: ['urn:lge:com:service:webos:second-screen-1'],
        class: 0
    });
    assert.deepStrictEqual(lgTv, 'com.lg.tv.webos2');

    assert.rejects(() => _httpClient.getKindByDiscovery({
        kind: 'upnp',
        name: '',
        deviceType: '',
        modelUrl: null,
        st: ['urn:thingpedia.com:invalid'],
        class: 0
    }));
}

async function testGetExamples() {
    function checkKinds(program, kinds) {
        for (let [, prim] of program.iteratePrimitives()) {
            if (prim.selector.isBuiltin)
                continue;
            assert(kinds.indexOf(prim.selector.kind) >= 0);
        }
    }

    const byKey = ThingTalk.Grammar.parse(await _httpClient.getExamplesByKey('twitter'));
    assert(byKey.isMeta);
    assert.strictEqual(byKey.classes.length, 0);
    assert.strictEqual(byKey.datasets.length, 1);

    for (let ex of byKey.datasets[0].examples) {
        assert.deepStrictEqual(typeof ex.id, 'number');
        assert(ex.utterances.length > 0);
        ex.utterances.forEach((u) => assertNonEmptyString(u));
        assert.strictEqual(ex.utterances.length, ex.preprocessed.length);
        ex.preprocessed.forEach((p) => assertNonEmptyString(p));
    }

    const byKindsSingle = ThingTalk.Grammar.parse(await _httpClient.getExamplesByKinds(['com.twitter']));
    assert(byKindsSingle.isMeta);
    assert.strictEqual(byKindsSingle.classes.length, 0);
    assert.strictEqual(byKindsSingle.datasets.length, 1);

    for (let ex of byKindsSingle.datasets[0].examples) {
        assert.deepStrictEqual(typeof ex.id, 'number');
        assert(ex.utterances.length > 0);
        ex.utterances.forEach((u) => assertNonEmptyString(u));
        assert.strictEqual(ex.utterances.length, ex.preprocessed.length);
        ex.preprocessed.forEach((p) => assertNonEmptyString(p));
        checkKinds(ex.value, ['com.twitter']);
    }

    const byKindsMultiple = ThingTalk.Grammar.parse(await _httpClient.getExamplesByKinds(['com.twitter', 'com.bing']));
    assert(byKindsMultiple.isMeta);
    assert.strictEqual(byKindsMultiple.classes.length, 0);
    assert.strictEqual(byKindsMultiple.datasets.length, 1);

    for (let ex of byKindsMultiple.datasets[0].examples) {
        assert.deepStrictEqual(typeof ex.id, 'number');
        assert(ex.utterances.length > 0);
        ex.utterances.forEach((u) => assertNonEmptyString(u));
        assert.strictEqual(ex.utterances.length, ex.preprocessed.length);
        ex.preprocessed.forEach((p) => assertNonEmptyString(p));
        checkKinds(ex.value, ['com.twitter', 'com.bing']);
    }
}

async function main() {
    await testGetDeviceCode();
    await testGetModuleLocation();
    await testGetSchemas(false);
    await testGetSchemas(true);

    await testGetDeviceList();
    await testGetDeviceList('online');
    await testGetDeviceList('physical');
    await testGetDeviceList('data');
    await testGetDeviceList('system');
    await testGetDeviceListErrorCases();

    await testGetDeviceFactories();
    await testGetDeviceFactories('online');
    await testGetDeviceFactories('physical');
    await testGetDeviceFactories('data');
    await testGetDeviceFactories('system');
    await testGetDeviceFactoriesErrorCases();

    await testGetDeviceSetup();
    await testGetKindByDiscovery();
    await testGetExamples();
}

module.exports = main;
if (!module.parent)
    main();

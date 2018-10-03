// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Mixins = require('./mixins.json');

module.exports = class ThingpediaClientBase {
    constructor(platform) {
        this.platform = platform;
    }

    get developerKey() {
        return this.platform.getDeveloperKey();
    }

    get locale() {
        return this.platform.locale;
    }

    /* istanbul ignore next */
    getModuleLocation(id) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    getDeviceCode(id) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    getSchemas(kinds) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    getMetas(kinds) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    getDeviceList(klass, page, page_size) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    getDeviceFactories(klass) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    getDeviceSetup2(kinds) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    getDeviceSetup(kinds) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    getKindByDiscovery(publicData) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    getExamplesByKey(key) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    getExamplesByKinds(kinds) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    clickExample(exampleId) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    lookupEntity(entityType, searchTerm) {
        throw new Error('not implemented');
    }

    getMixins() {
        let mixins = {};
        for (let mixin of Mixins.data)
            mixins[mixin.kind] = mixin;
        return Promise.resolve(mixins);
    }
};

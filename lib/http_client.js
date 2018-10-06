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

const Tp = require('thingpedia');
const qs = require('querystring');

const ClientBase = require('./base_client');

module.exports = class ThingpediaClientHttp extends ClientBase {
    constructor(platform, url) {
        super(platform);
        this._url = url + '/api/v3';
    }

    getModuleLocation(id) {
        var to = this._url + '/devices/package/' + id;
        if (this.developerKey)
            to += '?developer_key=' + this.developerKey;
        return Tp.Helpers.Http.get(to, { followRedirects: false }).then((res) => {
            throw new Error(`Expected a redirect downloading device ${id}`);
        }, (err) => {
            if (err.code >= 400)
                throw new Error(`Unexpected HTTP status ${err.code} downloading device ${id}`);

            return err.redirect;
        });
    }

    async _simpleRequest(to, params = {}, accept = 'application/json', options = { extractData: true, method: 'GET' }) {
        params.locale = this.locale;
        if (this.developerKey)
            params.developer_key = this.developerKey;
        to += '?' + qs.stringify(params);
        const response = await Tp.Helpers.Http.request(this._url + to, options.method || 'GET', '', { accept });
        if (accept === 'application/json') {
            const parsed = JSON.parse(response);
            if (parsed.result !== 'ok')
                throw new Error(`Operation failed: ${parsed.error || parsed.result}`);
            if (options.extractData)
                return parsed.data;
            else
                return parsed;
        } else {
            return response;
        }
    }

    // raw manifest code
    getDeviceCode(kind) {
        return this._simpleRequest('/devices/code/' + kind, {}, 'application/x-thingtalk');
    }

    getSchemas(kinds, withMetadata) {
        return this._simpleRequest('/schema/' + kinds.join(','), {
            meta: withMetadata ? '1' : '0'
        }, 'application/x-thingtalk');
    }

    getDeviceList(klass, page, page_size) {
        const params = { page, page_size };
        if (klass)
            params.class = klass;
        return this._simpleRequest('/devices/all', params);
    }

    getDeviceFactories(klass) {
        const params = {};
        if (klass)
            params.class = klass;
        return this._simpleRequest('/devices/setup', params);
    }

    getDeviceSetup(kinds) {
        return this._simpleRequest('/devices/setup/' + kinds.join(','));
    }

    async getKindByDiscovery(publicData) {
        let to = this._url + '/devices/discovery';
        const params = { locale: this.locale };
        if (this.developerKey)
            params.developer_key = this.developerKey;
        const response = await Tp.Helpers.Http.post(to + '?' + qs.stringify(params), JSON.stringify(publicData), { dataContentType: 'application/json' });
        const parsed = JSON.parse(response);
        if (parsed.result !== 'ok')
            throw new Error(`Operation failed: ${parsed.error || parsed.result}`);
        return parsed.data.kind;
    }

    getExamplesByKey(key) {
        return this._simpleRequest('/examples/search', { q: key }, 'application/x-thingtalk');
    }

    getExamplesByKinds(kinds) {
        return this._simpleRequest('/examples/by-kinds/' + kinds.join(','), {}, 'application/x-thingtalk');
    }

    clickExample(exampleId) {
        return this._simpleRequest('/examples/click/' + exampleId, {}, 'application/x-thingtalk',
            { method: 'POST' });
    }

    lookupEntity(entityType, searchTerm) {
        return this._simpleRequest('/entities/lookup/' + encodeURIComponent(entityType),
            { q: searchTerm }, 'application/json', { extractData: false }).then((result) => {
                const array = result.data;
                array.meta = result.meta;
                return array;
            });
    }
};

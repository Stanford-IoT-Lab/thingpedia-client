// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const url = require('url');

const THINGPEDIA_URL = 'https://thingengine.stanford.edu/thingpedia';

function getModule(parsed) {
    if (parsed.protocol === 'https:')
        return https;
    else
        return http;
}

module.exports = class ThingPediaClientHttp {
    getModuleLocation(id) {
        var to = THINGPEDIA_URL + '/download/devices/' + id + '.zip';
        if (this.developerKey)
            to += '?developer_key=' + this.developerKey;

        var parsed = url.parse(to);
        return Q.Promise(function(callback, errback) {
            getModule(parsed).get(parsed, function(res) {
                if (res.statusCode != 301) {
                    return errback(new Error('Unexpected HTTP status ' +
                                             res.statusCode +
                                             ' downloading channel ' + id));
                }

                callback(res.headers['location']);
            }).on('error', function(error) {
                errback(error);
            });
        });
    }

    _simpleRequest(to) {
        if (this.developerKey)
            to += '?developer_key=' + this.developerKey;

        var parsed = url.parse(to);
        return Q.Promise(function(callback, errback) {
            getModule(parsed).get(parsed, function(res) {
                if (res.statusCode != 200)
                    return errback(new Error('Unexpected HTTP error ' + res.statusCode));

                var data = '';
                res.setEncoding('utf8');
                res.on('data', function(chunk) {
                    data += chunk;
                });
                res.on('end', function() {
                    try {
                        callback(JSON.parse(data));
                    } catch(e) {
                        errback(e);
                    }
                });
            }).on('error', function(error) {
                errback(error);
            });
        });
    }

    getDeviceCode(id) {
        var to = THINGPEDIA_URL + '/api/code/devices/' + id;
        return this._simpleRequest(to);
    }

    getSchemas(kinds) {
        var to = THINGPEDIA_URL + '/api/schema/' + kinds.join(',');
        return this._simpleRequest(to);
    }

    getKindByDiscovery(publicData) {
        var to = THINGPEDIA_URL + '/api/discovery';
        if (this.developerKey)
            to += '?developer_key=' + this.developerKey;

        var parsed = url.parse(to);
        parsed.method = 'POST';
        parsed.headers = {};
        parsed.headers['Content-Type'] = 'application/json';

        return Q.Promise(function(callback, errback) {
            var req = getModule(parsed).request(parsed, function(res) {
                if (res.statusCode == 404)
                    return errback(new Error('No such device'));
                if (res.statusCode != 200)
                    return errback(new Error('Unexpected HTTP error ' + res.statusCode));

                var data = '';
                res.setEncoding('utf8');
                res.on('data', function(chunk) {
                    data += chunk;
                });
                res.on('end', function() {
                    callback(data);
                });
            });
            req.on('error', errback);
            req.end(JSON.stringify(blob));
        });
    }
}

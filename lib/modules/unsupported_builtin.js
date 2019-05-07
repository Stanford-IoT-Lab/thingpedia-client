// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details
"use strict";

const Tp = require('thingpedia');
const Utils = require('./utils');
const { UnsupportedError } = require('./errors');

module.exports = class UnsupportedBuiltinModule {
    constructor(id, manifest, loader) {
        // version does not matter for builtin modules
        manifest.version = 0;
        this._id = id;
        this._manifest = manifest;

        this._loaded = class UnsupportedDevice extends Tp.BaseDevice {
            constructor(engine, state) {
                super(engine, state);

                this.uniqueId = this.kind;
                this.name = Utils.formatString(this.constructor.metadata.name, this.state);
                if (this.constructor.metadata.description)
                    this.description = Utils.formatString(this.constructor.metadata.description, this.state);
            }

            checkAvailable() {
                return Tp.BaseDevice.Availability.OWNER_UNAVAILABLE;
            }
        };

        for (let action in manifest.actions) {
            this._loaded.prototype['do_' + action] = function(params) {
                throw new UnsupportedError();
            };
        }
        for (let query in manifest.queries) {
            this._loaded.prototype['get_' + query] = function(params, filter, count) {
                throw new UnsupportedError();
            };
            this._loaded.prototype['subscribe_' + query] = function(params, state, filter) {
                throw new UnsupportedError();
            };
            this._loaded.prototype['history_' + query] = function(params, base, delta, filters) {
                return null; // no history
            };
            this._loaded.prototype['sequence_' + query] = function(params, base, limit, filters) {
                return null; // no sequence history
            };
        }

        this._loaded.metadata = manifest;
    }

    get id() {
        return this._id;
    }
    get manifest() {
        return this._manifest;
    }
    get version() {
        return this._manifest.version;
    }

    clearCache() {
        // nothing to do here
    }

    getDeviceFactory() {
        return Promise.resolve(this._loaded);
    }
};

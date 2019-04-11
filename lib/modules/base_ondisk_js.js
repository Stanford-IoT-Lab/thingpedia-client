// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details
"use strict";

const Tp = require('thingpedia');
const path = require('path');
const fs = require('fs');
const tmp = require('tmp');
const Module = require('module');

const BaseJavascriptModule = require('./base_js');

function resolve(mainModule) {
    if (!mainModule.startsWith('/'))
        throw new Error('Invalid relative module path');
    if (require.resolve)
        return require.resolve(mainModule);
    else
        return Module._resolveFilename(mainModule, module, false);
}

function clearRequireCache(mainModule) {
    try {
        var fileName = resolve(mainModule);
        console.log(mainModule + ' was cached as ' + fileName);

        delete require.cache[fileName];

        var prefix = path.dirname(fileName) + '/';
        for (var key in require.cache) {
            if (key.startsWith(prefix))
                delete require.cache[key];
        }
    } catch(e) {
        // do nothing
    }
}

// base class of all JS modules loaded from Thingpedia and cached on disk
// this differs from BaseJavascriptModule because the latter covers BuiltinModules too
module.exports = class BaseOnDiskJavascriptModule extends BaseJavascriptModule {
    constructor(id, manifest, loader) {
        super(id, manifest, loader);

        this._platform = loader.platform;
        this._cacheDir = loader.platform.getCacheDir() + '/device-classes';
        this._modulePath = null;
    }
    
    get package_version() {
        return this._manifest.package_version;
    }
    
    clearCache() {
        this._loading = null;

        if (this._modulePath)
            clearRequireCache(this._modulePath);
    }
    
    async _loadJsModule(id) {
        var modulePath = this._modulePath;
        var version = JSON.parse(fs.readFileSync(modulePath + '/package.json').toString('utf8'))['thingpedia-version'];
        if (version !== this._manifest.package_version) {
            console.log(`Cached module ${this.id} is out of date (found ${version}, want ${this._manifest.package_version})`);
            return null;
        }

        var deviceClass = require(modulePath);
        deviceClass.require = function(subpath) {
            return require(path.resolve(modulePath, subpath));
        };
        return this._completeLoading(deviceClass);
    }

    async _doGetDeviceFactory() {
        this._modulePath = path.resolve(process.cwd(), this._cacheDir + '/' + this._id);

        try {
            if (fs.existsSync(this._modulePath))
                return await this._loadJsModule();

            const redirect = await this._client.getModuleLocation(this._id, this._manifest.version);
            const response = await Tp.Helpers.Http.getStream(redirect);

            const [path, fd] = await new Promise((resolve, reject) => {
                tmp.file({ mode: 0o600,
                           keep: true,
                           dir: this._platform.getTmpDir(),
                           prefix: 'thingengine-' + this._id + '-',
                           postfix: '.zip' }, (err, path, fd, cleanup) => {
                    if (err)
                        reject(err);
                    else
                        resolve([path, fd, cleanup]);
                });
            });
            const stream = fs.createWriteStream('', { fd, flags: 'w' });
            const zipPath = await new Promise((callback, errback) => {
                response.pipe(stream);
                stream.on('finish', () => {
                    callback(path);
                });
                stream.on('error', errback);
            });
            try {
                fs.mkdirSync(this._modulePath);
            } catch(e) {
                if (e.code !== 'EEXIST')
                    throw e;
            }

            var unzip = this._platform.getCapability('code-download');
            await unzip.unzip(zipPath, this._modulePath);
            fs.unlinkSync(zipPath);
            return await this._loadJsModule();
        } catch (e) {
            this._loading = null;
            throw e;
        }
    }
};

// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const fs = require('fs');
const path = require('path');
const lang = require('lang');
const Q = require('q');
const tmp = require('tmp');
const http = require('http');
const https = require('https');
const url = require('url');

const GenericDeviceFactory = require('./generic');

function safeMkdir(dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

function clearRequireCache(mainModule) {
    try {
        var fileName = require.resolve(mainModule);
        console.log(mainModule + ' was cached as ' + fileName);

        delete require.cache[fileName];

        var prefix = path.dirname(fileName) + '/';
        for (var key in require.cache) {
            if (key.startsWith(prefix))
                delete require.cache[key];
        }
    } catch(e) {}
}

function getModule(parsed) {
    if (parsed.protocol === 'https:')
        return https;
    else
        return http;
}

module.exports = new lang.Class({
    Name: 'ModuleDownloader',

    _init: function(client) {
        this._client = client;
        this._cacheDir = platform.getCacheDir() + '/device-classes';
        this._cachedModules = {};
        this._moduleRequests = {};

        safeMkdir(this._cacheDir);
        safeMkdir(this._cacheDir + '/node_modules');
        try {
            platform.makeVirtualSymlink(path.dirname(require.resolve('thingpedia')),
                                        this._cacheDir + '/node_modules/thingpedia');
        } catch(e) {
            if (e.code !== 'EEXIST')
                throw e;
        }
    },

    getCachedMetas: function() {
        return Q.nfcall(fs.readdir, this._cacheDir).then(function(files) {
            return Q.all(files.map(function(name) {
                return Q.try(function() {
                    if (name === 'node_modules')
                        return null;
                    var file = path.resolve(this._cacheDir, name);
                    if (name.endsWith('.json')) {
                        return Q.nfcall(fs.readFile, file).then(function(buffer) {
                            var json = JSON.parse(buffer.toString());

                            return ({ name: name.substr(0, name.length-5),
                                      version: json.version,
                                      generic: true });
                        });
                    } else {
                        return Q.nfcall(fs.readFile, path.resolve(file, 'package.json')).then(function(buffer) {
                            var json = JSON.parse(buffer.toString());

                            return ({ name: name,
                                      version: json['thingpedia-version'],
                                      generic: false });
                        });
                    }
                }.bind(this)).catch(function(e) {
                    return ({ name: name,
                              version: 'Error: ' + e.message,
                              generic: false });
                });
            }, this));
        }.bind(this)).then(function(objs) {
            return objs.filter(function(o) { return o !== null; });
        });
    },

    updateModule: function(id) {
        delete this._moduleRequests[id];
        clearRequireCache(this._cacheDir + '/' + id);
        return this._getModuleRequest(id, id).then(function(module) {
            if (!module.isGeneric) {
                var prefix = id + '/';
                for (var key in this._cachedModules) {
                    if (key.startsWith(prefix))
                        delete this._cachedModules[key];
                }
            }
        }.bind(this));
    },

    _getModuleFull: function(id, subId) {
        var fullId;
        if (subId)
            fullId = id + '/' + subId;
        else
            fullId = id;

        if (fullId in this._cachedModules)
            return Q(this._cachedModules[fullId]);
        else if (id in this._cachedModules && this._cachedModules[id].getSubmodule)
            return Q(this._cachedModules[id].getSubmodule(subId));
        else
            return this._createModule(fullId, id);
    },

    getModule: function(id) {
        return this._getModuleFull(id);
    },

    getSubmodule: function(id, subId) {
        return this._getModuleFull(id, subId);
    },

    _createModuleFromBuiltin: function(fullId) {
        var builtinId;
        if (fullId.startsWith('org.thingpedia.builtin.'))
            builtinId = fullId.substr('org.thingpedia.builtin.'.length);
        else
            builtinId = fullId; // we should reject it right away but we keep it for compat

        try {
            this._cachedModules[fullId] = require('thingpedia-builtins/' + builtinId);
            this._cachedModules[fullId].isGeneric = false;
            console.log('Module ' + fullId + ' loaded as builtin');
            return this._cachedModules[fullId];
        } catch(e) {
            return null;
        }
    },

    _createModuleFromCache: function(fullId, silent) {
        try {
            var module = path.resolve(process.cwd(), this._cacheDir + '/' + fullId);
            this._cachedModules[fullId] = require(module);
            this._cachedModules[fullId].isGeneric = false;
            console.log('Module ' + fullId + ' loaded as cached');
            return this._cachedModules[fullId];
        } catch(e) {
            if (!silent)
                throw e;
            return null;
        }
    },

    _createModuleFromCachedCode: function(fullId, id) {
        var code;
        try {
            code = fs.readFileSync(this._cacheDir + '/' + id + '.json').toString('utf8');
        } catch(e) {
            if (e.code != 'ENOENT')
                throw e;
            return null;
        }

        console.log('Module ' + fullId + ' loaded as cached code');
        this._cachedModules[id] = GenericDeviceFactory(id, code);
        this._cachedModules[id].isGeneric = true;
        if (fullId === id)
            return this._cachedModules[id];
        else
            return this._cachedModules[id].getSubmodule(fullId.substr(id.length + 1));
    },

    _ensureModuleRequest: function(id) {
        if (id in this._moduleRequests)
            return;

        var codeTmpPath = this._cacheDir + '/' + id + '.json.tmp';
        var codePath = this._cacheDir + '/' + id + '.json';

        this._moduleRequests[id] = this._client.getDeviceCode(id).then(function(codeObj) {
            var stream = fs.createWriteStream(codeTmpPath, { flags: 'wx', mode: 0600 });

            return Q.Promise(function(callback, errback) {
                stream.write(JSON.stringify(codeObj));
                stream.end();
                stream.on('finish', callback);
                stream.on('error', errback);
            });
        }.bind(this)).then(function() {
            fs.renameSync(codeTmpPath, codePath);
            return 'code';
        }.bind(this)).catch(function(e) {
            return this._client.getModuleLocation(id).then(function(redirect) {
                return Q.Promise(function(callback, errback) {
                    var parsed = url.parse(redirect);
                    getModule(parsed).get(parsed, function(res) {
                        if (res.statusCode != 200) {
                            return errback(new Error('Unexpected HTTP error ' +
                                                     res.statusCode +
                                                     ' downloading channel ' + id));
                        }

                        callback(res);
                    }).on('error', function(error) {
                        errback(error);
                    });
                });
            }.bind(this)).then(function(response) {
                return Q.nfcall(tmp.file, { mode: 0600,
                                            keep: true,
                                            dir: platform.getTmpDir(),
                                            prefix: 'thingengine-' + id + '-',
                                            postfix: '.zip' })
                    .then(function(result) {
                        var stream = fs.createWriteStream('', { fd: result[1], flags: 'w' });

                        return Q.Promise(function(callback, errback) {
                            response.pipe(stream);
                            stream.on('finish', function() {
                                callback(result[0]);
                            });
                            stream.on('error', errback);
                        });
                    });
            }.bind(this)).then(function(zipPath) {
                var dir = this._cacheDir + '/' + id;
                try {
                    fs.mkdirSync(dir);
                } catch(e) {
                    if (e.code != 'EEXIST')
                        throw e;
                }

                var unzip = platform.getCapability('code-download');
                return unzip.unzip(zipPath, dir).then(function() {
                    fs.unlinkSync(zipPath);
                });
            }.bind(this)).then(function() {
                return 'zip';
            });
        }.bind(this));
    },

    _getModuleRequest: function(fullId, id) {
        this._ensureModuleRequest(id);

        return this._moduleRequests[id].then(function(how) {
            if (how === 'code')
                return this._createModuleFromCachedCode(fullId, id);
            else
                return this._createModuleFromCache(fullId, false);
        }.bind(this));
    },

    _createModule: function(fullId, id) {
        console.log('Loading device module ' + fullId);

        module = this._createModuleFromBuiltin(fullId);
        if (module)
            return Q(module);
        module = this._createModuleFromCachedCode(fullId, id);
        if (module)
            return Q(module);
        module = this._createModuleFromCache(fullId, true);
        if (module)
            return Q(module);
        if (!platform.hasCapability('code-download'))
            return Q.reject(new Error('Code download is not allowed on this platform'));

        return this._getModuleRequest(fullId, id);
    },
});

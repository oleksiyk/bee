/** @module Hive */

"use strict";

var os = require("os");

var Hive = require('./hive');

var uuid = require('node-uuid');

var Q = require('q');

/**
 * Create new Hive object
 *
 * @param {Object} [options]
 * @returns {Hive}
 */
module.exports.createHive = function (options) {
    var id = os.hostname() + ':' + process.pid + ':' + uuid.v1();
    return new Hive(id, options);
};

/**
 * Creates new Hive object and returns a promise that will be resolved when its ready
 * @param {Object} [options]
 * @returns {Promise} Promise for Hive object
 */
module.exports.createHivePromised = function (options) {
    var deferred = Q.defer();
    var hive = module.exports.createHive(options);

    hive.on('ready', function () {
        deferred.resolve(hive);
    })

    return deferred.promise;
};



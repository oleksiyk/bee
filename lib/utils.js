"use strict";

var Promise = require('bluebird')

var delay = exports.PromiseDelay = function (ms) {
    return new Promise(function (v) {
        setTimeout(v, ms);
    });
}

var timeout = exports.PromiseTimeout = function (promise, time, message) {
    var timeout = delay(time).then(function () {
        throw new Promise.TimeoutError(message || ("Operation timed out after " + time + " ms"));
    });

    return Promise.race([promise, timeout]);
}

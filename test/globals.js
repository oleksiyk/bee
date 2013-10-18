"use strict";

global.hivelib = (process && process.env && process.env.BEE_COV)
    ? require('../lib-cov')
    : require('../lib');


global.sinon = require("sinon");
global.chai = require("chai");

global.assert = global.chai.assert;
global.should = global.chai.should();

// https://github.com/domenic/mocha-as-promised
require("mocha-as-promised")();

// https://github.com/domenic/chai-as-promised
var chaiAsPromised = require("chai-as-promised");
global.chai.use(chaiAsPromised);

// https://github.com/domenic/sinon-chai
var sinonChai = require("sinon-chai");
global.chai.use(sinonChai);

global.hive = global.hivelib.createHive({
    redis: {
        log: true
    }
})

global.hive.on('error', function(err) {
    console.error(require('util').inspect(err, true, 10, true))
})


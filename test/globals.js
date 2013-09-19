"use strict";

global.hivelib = (process && process.env && process.env.BEE_COV)
    ? require('../lib-cov')
    : require('../lib');


global.sinon = require("sinon");
global.chai = require("chai");

global.assert = chai.assert;
global.should = chai.should();

// https://github.com/domenic/mocha-as-promised
require("mocha-as-promised")();

// https://github.com/domenic/chai-as-promised
var chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);

// https://github.com/domenic/sinon-chai
var sinonChai = require("sinon-chai");
chai.use(sinonChai);

global.hiveError = null;


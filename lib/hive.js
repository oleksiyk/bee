"use strict";

var _ = require('lodash');
var path = require('path');
var events = require('events');
var util = require('util');
var uuid = require('node-uuid');
var Redis = require('./redis');
var Job = require('./job');
var Bee = require('./bee');
var Q = require('q');

/**
 *
 * @param id
 * @param options
 * @returns {Hive}
 * @constructor
 */
var Hive = function (id, options) {

    var self = this;

    /**
     * @private
     */
    this.options = _.partialRight(_.merge, _.defaults)(options || {}, {
        redis: {
            host: '127.0.0.1',
            port: 6379,
            options: {},
            log: false
        }
    });

    this.id = id;

    /**
     * Bees collection
     * @private
     */
    this.swarm = {};

    this.redis = new Redis(this.options.redis, this.id);

    this.redis
        .once('ready', function () {
            self.emit('ready');
        })
        .on('error', function (err) {
            self.log('error', err)
        })
        .on('debug', function (msg) {
            self.log('debug', msg)
        })

    this._saveHiveOptions();
};

util.inherits(Hive, events.EventEmitter);

module.exports = Hive;

/**
 * Fire 'log' event with specified log level
 *
 * @param {String} level
 * @param {String|Object} message
 */
Hive.prototype.log = function (level, message) {
    this.emit('log', {
        level: level,
        message: message
    })
};

/**
 *
 * @private
 */
Hive.prototype._saveHiveOptions = function () {
    this.redis.saveOptions({
        log: this.options.redis.log
    })
};

/**
 * Creates and registers new Bee
 *
 * @param {String} name Bee name
 * @param {Object} beeSpec
 * @returns {Bee} Bee
 */
Hive.prototype.bee = function (name, beeSpec) {
    if (this.swarm[name] === undefined) {

        beeSpec = _.partialRight(_.merge, _.defaults)(beeSpec, {
            concurrency: false, // concurrency limit
            hash: null, // hash function
            timeout: 1000 * 30 * 60 // 30 mins, maximum time a worker can do the job
        })

        this.redis.queue_subscribe(name);

        this.swarm[name] = new Bee(this, name, beeSpec);
    }

    return this.swarm[name];
};

/**
 * Get Job handle instance by JID
 *
 * @param {String} jid
 * @returns {Promise} Promise for Job instance
 */
Hive.prototype.job = function (jid) {

    var self = this;

    return this.redis.job_load(jid)
        .then(function (data) {
            return new Job(self, data)
        })
}

/**
 * DO THE JOB!
 *
 * @param {String|Object} name Bee name or job options object
 * @param {...Mixed} workload
 * @returns {Promise} Promise for Job instance
 */
Hive.prototype.do = function (name /*, workloadParam1, workloadParam2, ...*/) {

    var options = {}, data = _.toArray(arguments).slice(1), job, parent, tags;

    if (typeof name === 'object') {
        options = _.pick(name, // valid client options are: delay, priority, timeout
            'delay',
            'priority',
            'timeout'
        )
        tags = name.tags;
        parent = name.parent;
        name = name.name;
    }

    if(parent && typeof parent === 'object'){
        parent = parent.jid;
    }

    // merge with default job options
    options = _.partialRight(_.merge, _.defaults)(options || {}, {
        // client options:
        priority: 0,
        timeout: 3 * 60 * 1000, // to save up resources, job handle will timeout after timeout ms (not including delay).
        delay: 0,
        // worker options
        retries: 5, // maximum number of retries
        retryDelay: 30 * 1000, // 30 seconds,
        progressiveDelay: false,
        ttl: 30 * 60 * 1000 // 30 mins, time to keep job result as valid
    })

    job = new Job(this, {
        jid: uuid.v1(),
        parent: parent || null,
        tags: tags || [],
        queue: name,
        data: data,
        options: options
    });

    return this.redis.job_put(job).then(function () {
        return job;
    })
};

/**
 * Search for jobs by tag(s)
 *
 * @param {...String|Array} tags
 * @returns {Promise} Promise for array of JIDs
 */
Hive.prototype.search = function () {
    var tags = _.toArray(arguments);
    if(tags.length == 1) tags = tags[0];
    return this.redis.job_search(tags)
};

/**
 * Cancel the job
 *
 * @param {Job|String} Job handle or JID
 * @return {Promise}
 */
Hive.prototype.cancel = function (job) {
    if (typeof job === 'object'){
        job = job.jid;
    }

    return this.redis.job_cancel(job)
};
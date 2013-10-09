"use strict";

var crypto = require('crypto');
var _ = require('lodash');
var Q = require('q');

var Bee = function (hive, queue, spec) {

    var self = this;

    /**
     * @private
     */
    this.hive = hive;

    /**
     * @private
     */
    this.queue = queue;

    /**
     * @private
     */
    this.spec = spec;

    this.id = this.hive.id + ':' + this.queue;

    /**
     * Counter of occupied workers
     *
     * @private
     */
    this.workersCount = 0;

    this.hive.redis.on('queue:' + this.queue, function (event) {

        if (event && event.type) {
            if (event.type == 'new') {
                self._pullJobs();
            }
        }

    });

    this._pullJobs();

    this._sendHeartbeat();

    this._checkExpired();
};


module.exports = Bee;

/**
 * pull new jobs from Redis
 *
 * @private
 */
Bee.prototype._pullJobs = function () {

    var self = this;
    var promise = Q();

    clearTimeout(this._pullJobsTimeout);

    if (self.spec.concurrency === false || self.workersCount < self.spec.concurrency) { // only get jobs if we didn't reach concurrency limit

        var max = self.spec.concurrency ? (self.spec.concurrency - self.workersCount) : 5;

        self.workersCount += max;

        promise = self.hive.redis.jobPop(self, max)
            .then(function (results) {
                // adjust workersCount
                self.workersCount = self.workersCount - max + results.length;

                results.forEach(function (result) {

                    var job = JSON.parse(result);

                    job.tags = _.toArray(job.tags); // redis returns an empty object instead of array if there are no tags

                    self._duplicate(job)
                        .then(function (isDuplicate) {
                            if (!isDuplicate) {
                                return self._do(job)
                            }
                        })
                        // process error
                        .fail(function (err) {
                            self.hive.redis.jobFailed(job, self, err)
                        })
                        // cleanup
                        .finally(function () {
                            self.workersCount--;
                        })

                })

            })
            .fail(function () {
                self.workersCount -= max;
            })

    }

    // periodically check for jobs
    promise.finally(function() {
        clearTimeout(self._pullJobsTimeout);
        self._pullJobsTimeout = setTimeout(function() {
            self._pullJobs()
        }, 500);
    })
};

/**
 * Decide if the job is duplicate
 *
 * @param  {Job} job
 * @returns {Promise} If the Job is duplicate
 * @private
 */
Bee.prototype._duplicate = function (job) {

    var self = this;

    if (self.spec.hash === false || job.hash) { // hashing function is disabled or hash is already calculated
        return Q(false);
    }

    return Q.fapply(typeof self.spec.hash === 'function' ? self.spec.hash : self._defaultHashFunc, [job].concat(job.data))
        .timeout(self.spec.timeout, 'Hash method timed out after ' + self.spec.timeout + ' ms') // force the job to fail after timeout
        .then(function (hash) {

            if (typeof hash === 'string') {
                if (hash.length < 2) {
                    throw new Error('Hash string is too short: "' + hash + '"')
                }
            } else if (typeof hash !== 'number') {
                throw new Error('Hash can only be a number or string and not ' + (typeof hash))
            }

            job.hash = hash;

            return self.hive.redis.jobHash(job, self)
                .then(function (res) {
                    return res !== false; // true if the job is duplicate
                });

        })

};

/**
 * Calculate SHA1 hash of all job data
 *
 * @param job
 * @returns {String} SHA1 hash
 * @private
 */
Bee.prototype._defaultHashFunc = function (job) {
    return crypto.createHash('sha1').update(JSON.stringify(job.data)).digest("hex")
};

/**
 * do the job
 *
 * @param  {Job} job
 * @private
 */
Bee.prototype._do = function (job) {

    var self = this;

    /**
     * Send job progress
     *
     * @param {Number} Progress (usually 0-100)
     * @type {function}
     */
    job.progress = function (progress) {
        return self.hive.redis.jobProgress(job, progress);
    }

    /**
     * Set job tags
     * @param tags
     */
    job.setTags = function (tags) {
        tags = _.toArray(arguments);

        if (tags.length == 1) {
            tags = tags[0];
        }

        if (!_.isArray(tags)) {
            tags = [ tags ]
        }

        return self.hive.redis.jobSetTags(job, tags).then(function () {
            job.tags = tags;
        })
    }

    /**
     * Wrap hive.do() and pass itself as parent job
     */
    job.sub = function () {
        var args = Array.prototype.slice.call(arguments)

        if (typeof args[0] === 'string') {
            args[0] = {
                name: args[0],
                parent: this.jid
            }
        } else if (typeof args[0] === 'object') {
            args[0].parent = this.jid;
        }

        return self.hive.do.apply(self.hive, args)
    }

    // apply the worker function
    return Q.fapply(self.spec.worker, [job].concat(job.data))

        .timeout(self.spec.timeout, 'Worker method timed out after ' + self.spec.timeout + ' ms') // force the job to fail after timeout

        // process result
        .then(function (result) {
            /*
            if (typeof result === 'undefined') {
                throw new Error('Worker returned undefined')
            }
            */
            return self.hive.redis.jobDone(job, self, result);
        })

        // send job progress
        .progress(function (progress) {
            job.progress(progress)
        })
};

/**
 * send heartbeat to tell we are alive
 *
 * @private
 */
Bee.prototype._sendHeartbeat = function () {
    var self = this;

    this.hive.redis.beeHeartbeat(this)
        .finally(function() {
            return Q.delay(30*1000)
        })
        .then(function() {
            self._sendHeartbeat()
        })
};

/**
 * Check for expired jobs and job locks
 *
 * @private
 */
Bee.prototype._checkExpired = function () {
    var self = this;

    this.hive.redis.beeExpired(this)
        .finally(function() {
            return Q.delay(1000)
        })
        .then(function() {
            self._checkExpired()
        })
};





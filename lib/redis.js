"use strict";

var _      = require('lodash');
var redis  = require('redis');
var path   = require('path');
var fs     = require('fs');
var events = require('events');
var util   = require('util');
var Q      = require('q');

//Q.longStackSupport = true;

/**
 * Helper class for common Redis tasks
 *
 * @param options
 * @returns {Redis}
 * @constructor
 */
var Redis = function (options, hiveId) {

    var self = this;

    this.ready = Q.defer();

    /**
     * @private
     */
    this.options = options;

    /**
     *
     * @private
     */
    this.hiveId = hiveId;

    /**
     * Pub/Sub client connection
     * @private
     */
    this.pubSub = redis.createClient(this.options.port, this.options.host, this.options.options);

    /**
     * @private
     */
    this.queueSubscriptions = [];

    this.pubSub.on("error", function (err) {
        err.client = 'pub-sub';
        self.emit('error', err);
    });

    this.pubSub.on('message', this._parseMessage.bind(this));

    this.pubSub.setMaxListeners(0);

    if (this.options.log) {
        this.pubSub.subscribe('bee:ch:log');
    }

    /**
     * Command client connection
     * @private
     */
    this.cmd = redis.createClient(this.options.port, this.options.host, this.options.options);

    this.cmd.on("error", function (err) {

        if(!self.ready.promise.isPending()){
            self.ready = Q.defer();
        }

        // console.log(require('util').inspect(err, true, 10, true))

        err.client = 'cmd';
        self.emit('error', err);
    });


    /**
     * List of lua scripts to load, null values will be replaced with SHA hashes
     * @private
     */
    this.scripts = {
        // job scripts
        'job/put': null,
        'job/pop': null,
        'job/done': null,
        'job/load': null,
        'job/hash': null,
        'job/failed': null,
        'job/setTags': null,
        'job/cancel': null,

        // bee (queue) scripts
        'bee/heartbeat': null
    };

    // make promised versions of Redis commands that we use (uppercased and bound to self)
    _.each(['evalsha', 'script', 'publish', 'zrank', 'set', 'hgetall', 'sunion', 'sinter', 'zcard', 'time'], function (command) {

        self[command.toUpperCase()] = function() {

            var args = Array.prototype.slice.call(arguments);

            var deferred = Q.defer();

            self.cmd[command].apply(self.cmd, args.concat([
                function(err, data) {

                    if (err) {

                        if (err.message) {
                            // replace script hash in error reply with script name
                            _.each(self.scripts, function(hash, scriptName) {
                                err.message = err.message.replace(hash, scriptName)
                            })
                        }

                        // emit error event
                        self.emit('error', err)

                        deferred.reject(err);
                    } else {
                        deferred.resolve(data)
                    }
                }
            ]))

            return deferred.promise;
        }
    })

    this.cmd.on('ready', function () {
        self._loadScripts().then(function () {
            self.ready.resolve()
        })
    })

};

util.inherits(Redis, events.EventEmitter);

module.exports = Redis;

/**
 * Parse PubSub message and trigger Queue [and Job] event
 *
 * @param channel
 * @param message
 * @private
 */
Redis.prototype._parseMessage = function (channel, message) {
    var matches, event;

    if (channel == 'bee:ch:log') {
        this.emit('debug', JSON.parse(message));

    } else if (matches = channel.match(/^bee:ch:q:(.*)$/)) {

        event = JSON.parse(message);

        this.emit('queue:' + matches[1], event); // queue event

        if (event.jid) {
            this.emit('job:' + event.jid, event); // job event

            /*
            // these are the last events for the job, so we can cleanup here
            if (/completed|failed|duplicate|canceled/.test(event.type)) {
                this.removeAllListeners('job:' + event.jid);
            }
            */
        }
    }
};

/**
 * Load Lua scripts into Redis recursively resolving includes
 *
 * @returns {Promise}
 * @private
 */
Redis.prototype._loadScripts = function () {

    var self = this;

    var loadFileFromDisk = function (filename) {
        return Q.nfbind(fs.readFile)(path.resolve(__dirname + '/scripts', filename), { encoding: 'utf8'})
            .then(function (data) {
                var matches, includes = [], re = /--\s+include\s*'(.+?)'/g;

                while ((matches = re.exec(data)) != null) {
                    includes.push(loadFileFromDisk(matches[1])
                        .then(function (replacement, includeData) {
                            data = data.replace(replacement, includeData);
                        }.bind(null, matches[0])))
                }

                if (includes.length) {
                    return Q.all(includes).then(function () {
                        return data
                    })
                } else {
                    return data;
                }
            })
    }

    // now load all the scripts to Redis server (processing include directives)
    return Q.all(_.map(this.scripts, function (sha, scriptName) {
        return loadFileFromDisk(scriptName + '.lua')
            .then(function (data) {
                return self.SCRIPT('load', data)
                    .then(function (resSHA) {
                        return self.scripts[scriptName] = resSHA;
                    })
            })
    }))

};

/**
 * Subscribe to pub/sub events for this queue on Redis server
 *
 * @param queue Name of queue (bee)
 */
Redis.prototype.queueSubscribe = function (queue) {

    var self = this;

    if (this.queueSubscriptions.indexOf(queue) == -1) { // don't subscribe twice

        self.ready.promise.then(function() {
            self.pubSub.subscribe('bee:ch:q:' + queue, function (err) {
                if (!err) {
                    self.queueSubscriptions.push(queue);
                } else {
                    self.emit('error', err);
                }
            });
        })
    }
};

/**
 *
 * @private
 */
Redis.prototype._callScript = function () {

    var args = Array.prototype.slice.call(arguments);
    var self = this;

    return self.ready.promise.then(function() {
        return self.TIME()
            .then(function (time) {
                return Math.floor((time[0] * 1000 + time[1]/1000))
            })
            .then(function (now) {
                return self.EVALSHA(self.scripts[args[0]], 0, self.hiveId, now, args[1])
            })
    })
}

/**
 *
 * @param job
 */
Redis.prototype.jobPut = function (job) {

    var self = this;

    this.queueSubscribe(job.queue);

    return self.ready.promise.then(function() {
        return self._callScript('job/put', JSON.stringify({
                jid: job.jid,
                queue: job.queue,
                options: job.options,
                tags: job.tags,
                parent: job.parent,
                data: job.data
            }))
            .then(function (jid) {

                if (!jid){ // parent job was canceled
                    throw 'Canceled'
                }

                return jid;
            });
    })
};

/**
 *
 * @param bee
 * @param max
 */
Redis.prototype.jobPop = function (bee, max) {

    var self = this;

    return self.ready.promise.then(function() {
        return self._callScript('job/pop', JSON.stringify({
            queue: bee.queue,
            worker: bee.id,
            max: max
        }));
    })
};

/**
 *
 * @param job
 * @param bee
 * @param result
 */
Redis.prototype.jobDone = function (job, bee, result) {

    var self = this;

    return self.ready.promise.then(function() {
        return self._callScript('job/done', JSON.stringify({
                queue: job.queue,
                jid: job.jid,
                worker: bee.id,
                result: result,
                options: job.options
            }));
    })
};

/**
 * Mark the job as failed (the job will be retried unless it reached the limit of retries)
 *
 * @param job
 * @param bee
 * @param delay
 */
Redis.prototype.jobFailed = function (job, bee, err) {

    var self = this;

    if (typeof err !== 'object' || (err instanceof Error)) {
        err = {
            message: err.toString()
        }
    }

    err = _.partialRight(_.merge, _.defaults)(err, {
        message: 'Unknown error',
        retry: true,
        retryDelay: job.options.retryDelay,
        progressiveDelay: job.options.progressiveDelay
    });

    //console.log('[REDIS] Job failed: ', job.jid, err)

    return self.ready.promise.then(function() {
        return self._callScript('job/failed', JSON.stringify({
                queue: job.queue,
                worker: bee.id,
                jid: job.jid,
                exception: err,
                options: job.options
            }));
    })
};


/**
 * Load job data
 *
 * @param jid
 */

Redis.prototype.jobLoad = function (jid) {

    var self = this;

    return self.ready.promise.then(function() {
        return self._callScript('job/load', JSON.stringify({
                jid: jid
            }))
            .then(function (result) {
                if (!result) {
                    throw new Error('Not found')
                }

                result = JSON.parse(result)

                if (result.status == 'expired' || (result.duplicate && result.duplicate.status == 'expired')) {
                    throw new Error('Expired')
                }

                if (result.status == 'canceled' || (result.duplicate && result.duplicate.status == 'canceled')) {
                    throw new Error('Canceled')
                }


                return result;
            });
    })
}

/**
 * Set job hash
 *
 * @param job
 * @param bee
 * @param hash
 */
Redis.prototype.jobHash = function (job, bee) {

    var self = this;

    return self.ready.promise.then(function() {
        return self._callScript('job/hash', JSON.stringify({
                queue: job.queue,
                jid: job.jid,
                hash: job.hash,
                worker: bee.id
            }))
            .then(function (result) {
                return JSON.parse(result)
            })
    })
}

/**
 * Publish job progress event
 *
 * @param job
 * @param progress
 */
Redis.prototype.jobProgress = function (job, progress) {

    var self = this;

    return self.ready.promise.then(function() {
        return self.PUBLISH('bee:ch:q:' + job.queue, JSON.stringify({
            jid: job.jid,
            type: 'progress',
            progress: progress
        }));
    })
}

/**
 * Set job tags
 *
 * @param job
 * @param tags
 */
Redis.prototype.jobSetTags = function (job, tags) {

    var self = this;

    return self.ready.promise.then(function() {
        return self._callScript('job/setTags', JSON.stringify({
            jid: job.jid,
            tags: tags
        }));
    })
}

/**
 * Search jobs with matching tags
 *
 * @param tags
 * @returns {Array} array of matched JIDs
 */
Redis.prototype.jobSearch = function (tags) {

    var tagKeys = [];
    var self = this;

    if (!_.isArray(tags)) {
        tags = [ tags ]
    }

    tags.forEach(function (tag) {
        tagKeys.push('bee:s:tags:' + tag)
    })

    return self.ready.promise.then(function() {
        return self.SINTER(tagKeys);
    })
}


/**
 * Get job rank (position in queue)
 *
 * @param job
 */
Redis.prototype.jobRank = function (job) {
    var self = this;

    return self.ready.promise.then(function() {
        return self.ZRANK('bee:ss:queue:' + job.queue, job.jid)
    })
}

/**
 * Cancel the job
 *
 * @param jid
 */
Redis.prototype.jobCancel = function (jid) {

    var self = this;

    return self.ready.promise.then(function() {
        return self._callScript('job/cancel', JSON.stringify({
                jid: jid
            })).then(function (result) {
            if (!result) {
                throw new Error('Not found')
            }
        })
    })
}

/**
 * Send bee heartbeat
 *
 * @param bee
 */
Redis.prototype.beeHeartbeat = function (bee) {

    var self = this;

    return self.ready.promise.then(function() {
        return self._callScript('bee/heartbeat', JSON.stringify({
            queue: bee.queue,
            worker: bee.id
        }))
    })
}

/**
 * Save hive options
 *
 * @param {Object} opts
 * @returns {*}
 */
Redis.prototype.saveOptions = function (opts) {
    return this.SET('bee:str:hive:options', JSON.stringify(opts))
};

Redis.prototype.queueSize = function (name) {

    var workingQueue = 'bee:ss:queue:' + name;
    var delayedQueue = 'bee:ss:delayed:' + name
    var self = this;

    return self.ready.promise.then(function() {
        return self.ZCARD(workingQueue)
            .then(function (workingCount) {
                return self.ZCARD(delayedQueue)
                    .then(function (delayedCount) {
                        return workingCount + delayedCount;
                    })
            })
    })

};

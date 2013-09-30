"use strict";

var _ = require('lodash');
var redis = require('redis');
var path = require('path');
var fs = require('fs');
var events = require('events');
var util = require('util');
var Q = require('q');

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

    /**
     * @private
     */
    this.options = options;

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
    _.each(['evalsha', 'script', 'publish', 'zrank', 'set', 'hgetall', 'sunion', 'sinter', 'zcard'], function (command) {

        self[command.toUpperCase()] = function () {

            var deferred = Q.defer();
            var args = Array.prototype.slice.call(arguments);

            if (command == 'evalsha') {
                // expand KEYS array (redis evalsha command should receive: (scriptHash, numOfKeys, key1, key2, .., arg1, arg2, ..)
                args.splice.apply(args, [1, 1, args[1].length].concat(args[1]))
                // automatically add hive.id and current timestamp to all scripts as first arguments (right after KEYS)
                args.splice(2 + args[1], 0, hiveId, Date.now())
            }

            self.cmd[command].apply(self.cmd, args.concat([function (err, data) {

                if (err) {

                    if (err.message) {
                        // replace script hash in error reply with script name
                        _.each(self.scripts, function (hash, scriptName) {
                            err.message = err.message.replace(hash, scriptName)
                        })
                    }

                    // emit error event
                    self.emit('error', err)

                    deferred.reject(err);
                } else {
                    deferred.resolve(data)
                }
            }]))

            return deferred.promise;
        }
    })

    this.cmd.on('ready', function () {
        self._loadScripts().then(function () {
            self.emit('ready')
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
Redis.prototype.queue_subscribe = function (queue) {

    var self = this;

    if (this.queueSubscriptions.indexOf(queue) == -1) { // don't subscribe twice
        this.pubSub.subscribe('bee:ch:q:' + queue, function (err) {
            if (!err) {
                self.queueSubscriptions.push(queue);
            } else {
                self.emit('error', err);
            }
        });
    }
};

/**
 *
 * @param job
 */
Redis.prototype.job_put = function (job) {
    var keys = [
        'bee:ss:queue:' + job.queue, // key_queue
        'bee:h:jobs:' + job.jid, // key_jobs
        'bee:ss:delayed:' + job.queue // key_delayed
    ];

    if (job.parent){
        keys.push('bee:h:jobs:' + job.parent) // key_parent
        keys.push('bee:s:' + job.parent + ':children') // key_parent_children
    }

    this.queue_subscribe(job.queue);

    return this.EVALSHA(this.scripts['job/put'], keys, job.queue, job.jid, job.parent, JSON.stringify(job.data), JSON.stringify(job.options), JSON.stringify(job.tags))
        .then(function (jid) {

            if (!jid){ // parent job was canceled
                throw 'Canceled'
            }

            return jid;
        });
};

/**
 *
 * @param bee
 * @param max
 */
Redis.prototype.job_pop = function (bee, max) {

    var keys = [
        'bee:ss:queue:' + bee.queue,
        'bee:ss:locks:' + bee.queue,
        'bee:s:locks:' + bee.id,
        'bee:ss:expires:' + bee.queue,
        'bee:ss:bees:' + bee.queue,
        'bee:ss:delayed:' + bee.queue
    ];

    return this.EVALSHA(this.scripts['job/pop'], keys, bee.queue, bee.id, max);
};

/**
 *
 * @param job
 * @param bee
 * @param result
 */
Redis.prototype.job_done = function (job, bee, result) {

    var keys = [
        'bee:h:jobs:' + job.jid,
        'bee:ss:locks:' + job.queue,
        'bee:ss:expires:' + job.queue,
        'bee:s:locks:' + bee.id
    ];

    return this.EVALSHA(this.scripts['job/done'], keys, job.queue, job.jid, JSON.stringify(result), bee.id, JSON.stringify(job.options));
};

/**
 * Mark the job as failed (the job will be retried unless it reached the limit of retries)
 *
 * @param job
 * @param bee
 * @param delay
 */
Redis.prototype.job_failed = function (job, bee, err) {

    var keys = [
        'bee:h:jobs:' + job.jid,
        'bee:ss:locks:' + job.queue,
        'bee:ss:expires:' + job.queue,
        'bee:s:locks:' + bee.id,
        'bee:ss:delayed:' + job.queue
    ];

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

    return this.EVALSHA(this.scripts['job/failed'], keys, job.jid, JSON.stringify(err), bee.id, JSON.stringify(job.options));
};


/**
 * Load job data
 *
 * @param jid
 */
Redis.prototype.job_load = function (jid) {

    var keys = [
        'bee:h:jobs:' + jid
    ]

    return this.EVALSHA(this.scripts['job/load'], keys).then(function (result) {
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
}

/**
 * Set job hash
 *
 * @param job
 * @param bee
 * @param hash
 */
Redis.prototype.job_hash = function (job, bee) {

    var keys = [
        'bee:h:jobs:' + job.jid,
        'bee:ss:locks:' + job.queue,
        'bee:l:hashes:' + job.queue + ':' + job.hash,
        'bee:s:locks:' + bee.id
    ]

    return this.EVALSHA(this.scripts['job/hash'], keys, job.queue, job.jid, job.hash, bee.id)
        .then(function (result) {
            return JSON.parse(result)
        })

}

/**
 * Publish job progress event
 *
 * @param job
 * @param progress
 */
Redis.prototype.job_progress = function (job, progress) {

    return this.PUBLISH('bee:ch:q:' + job.queue, JSON.stringify({
        jid: job.jid,
        type: 'progress',
        progress: progress
    }));

}

/**
 * Set job tags
 *
 * @param job
 * @param tags
 */
Redis.prototype.job_set_tags = function (job, tags) {

    var keys = [
        'bee:h:jobs:' + job.jid
    ]

    return this.EVALSHA(this.scripts['job/setTags'], keys, job.jid, JSON.stringify(tags));

}

/**
 * Search jobs with matching tags
 *
 * @param tags
 * @returns {Array} array of matched JIDs
 */
Redis.prototype.job_search = function (tags) {

    var tag_keys = [];
    var self = this;

    if (!_.isArray(tags)) {
        tags = [ tags ]
    }

    tags.forEach(function (tag) {
        tag_keys.push('bee:s:tags:' + tag)
    })

    return this.SINTER(tag_keys);

}


/**
 * Get job rank (position in queue)
 *
 * @param job
 */
Redis.prototype.job_rank = function (job) {
    return this.ZRANK('bee:ss:queue:' + job.queue, job.jid)
}

/**
 * Cancel the job
 *
 * @param jid
 */
Redis.prototype.job_cancel = function (jid) {

    var keys = [
        'bee:h:jobs:' + jid
    ]

    return this.EVALSHA(this.scripts['job/cancel'], keys, jid).then(function (result) {
        if (!result) {
            throw new Error('Not found')
        }
    })
}

/**
 * Send bee heartbeat
 *
 * @param bee
 */
Redis.prototype.bee_heartbeat = function (bee) {
    var keys = [
        'bee:ss:locks:' + bee.queue,
        'bee:s:locks:' + bee.id,
        'bee:ss:bees:' + bee.queue
    ]

    return this.EVALSHA(this.scripts['bee/heartbeat'], keys, bee.id)
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

    return self.ZCARD(workingQueue)
        .then(function (workingCount) {
            return self.ZCARD(delayedQueue)
                .then(function (delayedCount) {
                    return workingCount + delayedCount;
                })
        })

};
"use strict";

var _ = require('lodash');
//var events = require('events');
//var util = require('util');
var Q = require('q');


/**
 * Job handle class (as returned from hive.do(), hive.job() )
 *
 * @param hive
 * @param jobData
 * @returns {Job}
 * @constructor
 */
var Job = function (hive, jobData) {
    var self = this;
    this.hive = hive;

    this._processEventBinded = this._processEvent.bind(this);

    /**
     * @private
     */
    this.resultDeferred = Q.defer();

    this._update(jobData);

    /*
    this.resultPromise = this.resultDeferred.promise.timeout(this.options.timeout,
        'Job handle timed out after ' + this.options.timeout + ' ms');
    */

    // register cleanup
    this.resultDeferred.promise.finally(function () {
        self.hive.redis.removeListener('job:' + self.jid, self._processEventBinded)
        if (self.duplicateJid) {
            self.hive.redis.removeListener('job:' + self.duplicateJid, self._processEventBinded)
        }
    })

    if (this.resultDeferred.promise.isPending()) {
        this.hive.redis.on('job:' + this.jid, this._processEventBinded)
    }

};

Job.prototype._makeError = function(message) {
    var err = new Error(message)
    err.queue = this.queue;
    err.jid = this.jid;
    err.history = this.history;

    return err;
}

Job.prototype._update = function (jobData) {

    if(!(this.duplicateJid && this.duplicateJid == jobData.jid)){
        this.queue = jobData.queue;
        this.jid = jobData.jid;
        this.parent = jobData.parent;
        this.tags = _.toArray(jobData.tags);
        this.data = jobData.data;
        this.hash = jobData.hash || null;
        this.status = jobData.status;
        this.options = jobData.options || {};
        this.history = _.toArray(jobData.history);
    }

    if (jobData.duplicate) {
        if(!this.duplicateJid){
            this.duplicateJid = jobData.duplicate.jid;
            this.hive.redis.on('job:' + this.duplicateJid, this._processEventBinded)
        }

        if (jobData.duplicate.status == 'completed') {
            this.resultDeferred.resolve(jobData.duplicate.result);
        } else if (jobData.duplicate.status == 'failed') {
            this.resultDeferred.reject(this._makeError(jobData.duplicate.failedReason));
        } else if (jobData.duplicate.status == 'canceled') {
            this.resultDeferred.reject(this._makeError('Canceled'));
        }
    } else {
        if (jobData.status == 'completed') {
            this.resultDeferred.resolve(jobData.result);
        } else if (jobData.status == 'failed') {
            this.resultDeferred.reject(this._makeError(jobData.failedReason));
        }  else if (jobData.status == 'canceled') {
            this.resultDeferred.reject(this._makeError('Canceled'));
        }
    }

};

Job.prototype.update = function () {
    var self = this;

    return this.hive.redis.jobLoad(this.jid).then(function (jobData) {
        self._update(jobData)
    })

};

Job.prototype.cancel = function () {
    return this.hive.cancel(this)
};


/**
 * Get result promise
 *
 * @returns {Promise}
 */
Job.prototype.result = function () {
    return this.resultDeferred.promise;
};


/**
 *
 * @param event
 * @private
 */
Job.prototype._processEvent = function (event) {

    if (event && event.type) {

        switch (event.type) {
        /**
         * update job data on duplicate, completed and failed events
         */
            case 'duplicate':
            case 'completed':
            case 'failed':
            case 'canceled':
                this._update(event.job)
                break;
            case 'progress':
                this.resultDeferred.notify(event.progress || 0);
                break;
        }

    }
}


module.exports = Job;

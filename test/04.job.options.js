"use strict";

/* global describe, it, before, sinon, hive */

var Promise = require('bluebird')

describe('Job options', function () {
    var ttlSpy, retryDelaySpy, progressiveDelaySpy;

    before(function () {

        // worker for job.delay test
        hive.bee('test.job.options.delay', {
            hash: false,
            worker: function(job, a, b) {
                return a + b;
            }
        })

        // worker for job.ttl default test
        ttlSpy = sinon.spy(function(job, a, b, ttl) {
            job.options.ttl = ttl;
            return a + b;
        })

        hive.bee('test.job.options.ttl', {
            worker: ttlSpy
        })

        // worker for job.ttl test with disabled hash function
        hive.bee('test.job.options.ttl.nohash', {
            hash: false,
            worker: function(job, a, b) {
                job.options.ttl = 2000; // 2 sec
                return a + b;
            }
        })

        // this worker will mark the job as failed, which should than fail after 2 retries
        retryDelaySpy = sinon.spy(function(job) {

            job.options.retries = 2;
            job.options.retryDelay = 3000; // 3 seconds

            // fail any job
            throw 'Bad job'
        })

        hive.bee('test.job.options.retryDelay', {
            worker: retryDelaySpy
        })

        // this worker will mark the job as failed, which should than fail within progressive timeout
        progressiveDelaySpy = sinon.spy(function(job) {

            job.options.retries = 2;
            job.options.retryDelay = 3000; // 3 seconds

            // fail any job
            throw {
                message: 'Bad job',
                progressiveDelay: true
            }
        })

        hive.bee('test.job.options.progressiveDelay', {
            worker: progressiveDelaySpy
        })
    })

    describe('.delay', function () {

        it('delay=3000ms, job must be executed after at least 3 seconds #slow', function () {

            this.timeout(5000);

            var start = Date.now();

            return hive.do({
                name: 'test.job.options.delay',
                delay: 3000
            }, 2, 3)
                .then(function (job) {
                    return job.result()
                })
                .then(function (result) {
                    var end = Date.now();

                    result.should.equal(5);

                    return (end - start).should.be.at.least(3000).and.be.at.most(5000)
                })
        })

        it('delay=0ms (explicitly set), job must be executed immediately', function () {

            var start = Date.now();

            return hive.do({
                name: 'test.job.options.delay',
                delay: 0
            }, 2, 3)
                .then(function (job) {
                    return job.result()
                })
                .then(function (result) {
                    var end = Date.now();

                    result.should.equal(5);

                    return (end - start).should.be.at.most(500)
                })
        })
    })

    describe('.ttl', function () {

        describe('successful job with ttl=2000', function () {
            var originalJob, random = Math.random();

            before(function () {
                // send original job (worker will set ttl = 2000ms)
                return hive.do('test.job.options.ttl', 3, 4, 2000, random).then(function (job) {
                    originalJob = job;
                })
            })

            it('1st duplicate job sent immediately - worker isn\'t called', function () {
                return hive.do('test.job.options.ttl', 3, 4, 2000, random).call('result')
                    .then(function (result) {
                        ttlSpy.should.be.calledOnce;
                        result.should.equal(7);
                    })
            })

            it('original job must exist', function () {
                return hive.job(originalJob.jid).should.be.fulfilled;
            })

            it('and should be expired after ~3 sec', function () {
                this.timeout(5000);

                return Promise.delay(3200).then(function () {
                    return hive.job(originalJob.jid).should.be.rejectedWith(Error, 'Expired')
                })
            })

            it('2nd duplicate job sent after 2.5 sec - worker must be called', function () {

                return hive.do('test.job.options.ttl', 3, 4, 2000, random).call('result')
                    .then(function (result) {
                        ttlSpy.should.be.calledTwice;
                        result.should.equal(7);
                    })
            })

            it('job should be deleted completely after another ~3 sec', function () {
                this.timeout(5000);

                return Promise.delay(3000).then(function () {
                    return hive.job(originalJob.jid).should.be.rejectedWith(Error, 'Not found')
                })
            })
        })

        /**
         * disabled hash will test job expiration code in pop.lua script
         */
        describe('disabled hash function, ttl=2000', function () {
            var originalJob;

            before(function () {
                // send original job (worker has set ttl = 2000ms)
                return hive.do('test.job.options.ttl.nohash', 3, 4).then(function (job) {
                    originalJob = job;
                })
            })

            it('original job must exist', function () {
                return hive.job(originalJob.jid).should.be.fulfilled;
            })

            it('and should be expired after ~3 sec', function () {
                this.timeout(5000);

                return Promise.delay(3200).then(function () {
                    return hive.job(originalJob.jid).should.be.rejectedWith(Error, 'Expired')
                })
            })

            it('job should be deleted completely after another ~3 sec', function () {
                this.timeout(5000);

                return Promise.delay(3000).then(function () {
                    return hive.job(originalJob.jid).should.be.rejectedWith(Error, 'Not found')
                })
            })
        })

    })

    describe('.retryDelay #slow', function () {

        var job, start;

        before(function () {
            start = Date.now();

            return hive.do('test.job.options.retryDelay', 321, Math.random()).then(function (res) {
                job = res;
            })
        })

        it('should be rejected in about 6 seconds', function () {

            this.timeout(10000);

            return job.result()
                .catch(function () {
                    (Date.now() - start).should.be.closeTo(6000, 1000)
                })
        })

        it('should be rejected with Error(No more retries)', function () {
            return job.result()
                .should.be.rejectedWith(Error, 'No more retries');
        })

        it('job.retries should match specified in job options', function () {
            return job.result().catch(function () {
                retryDelaySpy.getCall(0).args[0].retries.should.equal(0);
                retryDelaySpy.getCall(1).args[0].retries.should.equal(1);
                retryDelaySpy.getCall(2).args[0].retries.should.equal(2);

            })
        })

    })

    describe('.progressiveDelay #slow', function () {

        var job, start;

        before(function () {
            start = Date.now();

            return hive.do('test.job.options.progressiveDelay', 321, Math.random()).then(function (res) {
                job = res;
            })
        })

        it('should be rejected in about 9 seconds', function () {

            this.timeout(15000);

            return job.result()
                .catch(function () {
                    (Date.now() - start).should.be.closeTo(9000, 1000)
                })
        })

        it('should be rejected with Error(No more retries)', function () {
            return job.result()
                .should.be.rejectedWith(Error, 'No more retries');
        })

        it('job.retries should match specified in job options', function () {
            return job.result().catch(function () {
                progressiveDelaySpy.getCall(0).args[0].retries.should.equal(0);
                progressiveDelaySpy.getCall(1).args[0].retries.should.equal(1);
                progressiveDelaySpy.getCall(2).args[0].retries.should.equal(2);

            })
        })

    })

})


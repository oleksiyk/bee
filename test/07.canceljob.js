"use strict";

/* global describe, it, before, hive, sinon */

var Promise = require('bluebird');
var _ = require('lodash')

Promise.onPossiblyUnhandledRejection();

var utils = require('../lib/utils')

describe('Job cancel', function () {

    var spyDelayed, spyRunningSuccessful, spyRunningFailed, spyWorkflowParent, spyWorkflowChild;

    before(function () {

        spyDelayed = sinon.spy(function(job, a) {
            return a;
        })

        hive.bee('test.cancel.delayed', {
            worker: spyDelayed
        })

        spyRunningSuccessful = sinon.spy(function(job, a) {
            return utils.PromiseDelay(2000).return(a)
        })

        hive.bee('test.cancel.running.successful', {
            worker: spyRunningSuccessful
        })

        spyRunningFailed = sinon.spy(function(job, a) {
            return utils.PromiseDelay(2000).throw(new Error('Failed!!'))
        })

        hive.bee('test.cancel.running.failed', {
            worker: spyRunningFailed
        })

        hive.bee('test.cancel.finished.successful', {
            worker: function(job, a) {
                return a
            }
        })

        hive.bee('test.cancel.finished.failed', {
            worker: function(job, a) {
                throw {
                    message: 'Failed123!',
                    retry: false
                }
            }
        })

        spyWorkflowParent = sinon.spy(function(job, a, random) {
            job.options.retryDelay = 3000;
            return job.sub({
                name: 'test.cancel.workflow.child'
            }, a, random).call('result')
        })

        spyWorkflowChild = sinon.spy(function(job, a) {
            return utils.PromiseDelay(2000).return(a)
        })

        hive.bee('test.cancel.workflow.single', {
            worker: spyWorkflowParent
        })

        hive.bee('test.cancel.workflow.child', {
            worker: spyWorkflowChild
        })
    })

    describe('delayed job', function () {
        var job;

        before(function () {
            return hive.do({
                name: 'test.cancel.delayed',
                delay: 1000
            }, Math.random())
                .then(function (_job) {
                    job = _job;
                    return utils.PromiseDelay(100).then(function () {
                        job.result().catch(function() {})
                        return job.cancel()
                    })
                })
        })

        it('worker should not be called', function () {
            return spyDelayed.should.not.be.called;
        })

        it('job.result() is rejected with "Canceled"', function () {
            return job.result().should.be.rejectedWith(Error, 'Canceled');
        })

        it('hive.job() is rejected with "Canceled"', function () {
            return hive.job(job.jid).should.be.rejectedWith(Error, 'Canceled');
        })

        it('job hash should have an expire TTL set in Redis', function () {
            return hive.redis.PTTL('bee:h:jobs:' + job.jid)
                .then(function (ttl) {
                    return ttl.should.be.within(1700000, 1800000)
                })
        })
    })

    describe('running eventually successful job', function () {
        var job;

        before(function () {
            return hive.do('test.cancel.running.successful', 123456, Math.random())
                .then(function (_job) {
                    job = _job;
                    return utils.PromiseDelay(500).then(function () {
                        job.result().catch(function() {})
                        return job.cancel()
                    })
                })
        })

        it('worker should be called', function () {
            return spyRunningSuccessful.should.be.called;
        })

        it('worker should return resolved promise', function () {
            this.timeout(3000)
            return spyRunningSuccessful.getCall(0).returnValue.should.eventually.be.equal(123456)
        })

        it('job.result() is rejected with "Canceled"', function () {
            return job.result().should.be.rejectedWith(Error, 'Canceled');
        })

        it('hive.job() is rejected with "Canceled"', function () {
            return hive.job(job.jid).should.be.rejectedWith(Error, 'Canceled');
        })

        it('job hash should have an expire TTL set in Redis', function () {
            return hive.redis.PTTL('bee:h:jobs:' + job.jid)
                .then(function (ttl) {
                    return ttl.should.be.within(1700000, 1800000)
                })
        })
    })

    describe('running eventually failed job', function () {
        var job;

        before(function () {
            return hive.do('test.cancel.running.failed', Math.random())
                .then(function (_job) {
                    job = _job;
                    return utils.PromiseDelay(500).then(function () {
                        job.result().catch(function() {})
                        return job.cancel()
                    })
                })
        })

        it('worker should be called', function () {
            return spyRunningFailed.should.be.called;
        })

        it('worker should return rejected promise', function () {
            this.timeout(3000)
            return spyRunningFailed.getCall(0).returnValue.should.be.rejectedWith(Error, 'Failed!!')
        })

        it('job.result() is rejected with "Canceled"', function () {
            return job.result().should.be.rejectedWith(Error, 'Canceled');
        })

        it('hive.job() is rejected with "Canceled"', function () {
            return hive.job(job.jid).should.be.rejectedWith(Error, 'Canceled');
        })

        it('job hash should have an expire TTL set in Redis', function () {
            return hive.redis.PTTL('bee:h:jobs:' + job.jid)
                .then(function (ttl) {
                    return ttl.should.be.within(1700000, 1800000)
                })
        })
    })

    describe('finished successful job with 1 duplicate before cancel() and 1 after', function () {
        var job, job2, job3, random = Math.random();

        before(function () {
            return Promise.all([
                    hive.do('test.cancel.finished.successful', random)
                        .then(function (_job) {
                            job = _job;
                            return job.result()
                        }),
                    hive.do('test.cancel.finished.successful', random)
                        .then(function (_job) {
                            job2 = _job;
                            return job2.result()
                        })
                ]).then(function () {
                    job.result().catch(function() {})
                    return job.cancel().then(function () {
                        return hive.do('test.cancel.finished.successful', random)
                            .then(function (_job) {
                                job3 = _job;
                                return job3.result()
                            })
                    })
                })

        })

        it('all jobs are finished', function () {
            return Promise.all([
                job.result().should.be.fulfilled,
                job2.result().should.be.fulfilled,
                job3.result().should.be.fulfilled
            ])
        })

        it('job2 is duplicate of job', function () {
            return job2.duplicateJid.should.be.equal(job.jid)
        })

        it('job3 is not duplicate', function () {
            return should.not.exist(job3.duplicateJid)
        })

        it('hive.job(job.jid) is rejected with "Canceled"', function () {
            return hive.job(job.jid).should.be.rejectedWith(Error, 'Canceled');
        })

        it('hive.job(job2.jid) is rejected with "Canceled"', function () {
            return hive.job(job2.jid).should.be.rejectedWith(Error, 'Canceled');
        })

        it('hive.job(job3.jid) is resolved', function () {
            return hive.job(job3.jid).should.be.fulfilled;
        })
    })

    describe('finished failed job with 1 duplicate before cancel() and 1 after', function () {
        var job, job2, job3, random = Math.random();

        before(function () {
            return Promise.all([
                    hive.do('test.cancel.finished.failed', random)
                        .then(function (_job) {
                            job = _job;
                            return job.result().catch(function () {})
                        }),
                    hive.do('test.cancel.finished.failed', random)
                        .then(function (_job) {
                            job2 = _job;
                            return job2.result().catch(function () {})
                        })
                ]).then(function () {
                    return job.cancel().then(function () {
                        return hive.do('test.cancel.finished.failed', random)
                            .then(function (_job) {
                                job3 = _job;
                                return job3.result().catch(function () {})
                            })
                    })
                })

        })

        it('all jobs are finished and failed with "Failed123!"', function () {
            return Promise.all([
                job.result().should.be.rejectedWith(Error, 'Failed123!'),
                job2.result().should.be.rejectedWith(Error, 'Failed123!'),
                job3.result().should.be.rejectedWith(Error, 'Failed123!')
            ])
        })

        it('job2 is duplicate of job', function () {
            return job2.duplicateJid.should.be.equal(job.jid)
        })

        it('job3 is not duplicate', function () {
            return should.not.exist(job3.duplicateJid)
        })

        it('hive.job(job.jid) is rejected with "Canceled"', function () {
            return hive.job(job.jid).should.be.rejectedWith(Error, 'Canceled');
        })

        it('hive.job(job2.jid) is rejected with "Canceled"', function () {
            return hive.job(job2.jid).should.be.rejectedWith(Error, 'Canceled');
        })

        it('hive.job(job3.jid) is resolved', function () {
            return hive.job(job3.jid).should.be.fulfilled;
        })

        it('hive.job(job3.jid).result() is rejected with "Failed123!"', function () {
            return hive.job(job3.jid).call('result').should.be.rejectedWith(Error, "Failed123!");
        })
    })

    describe('single workflow', function () {
        var job;

        before(function () {
            return hive.do('test.cancel.workflow.single', Math.random()).then(function (_job) {
                job = _job;

                return utils.PromiseDelay(300).then(function () {
                    job.result().catch(function() {})
                    return job.cancel()
                })
            })
        })

        it('job.result() should be rejected with "Canceled"', function () {
            return job.result().should.be.rejectedWith(Error, 'Canceled')
        })

        it('child job is canceled', function () {
            return hive.job(spyWorkflowChild.getCall(0).args[0].jid).should.be.rejectedWith(Error, 'Canceled')
        })
    })

    describe('cancel 1 of 2 workflows, both using the same (duplicate) child #slow', function () {
        var job, job2, random = Math.random();

        before(function () {

            spyWorkflowChild.reset();
            spyWorkflowParent.reset();

            return hive.do('test.cancel.workflow.single', 1234, random, Math.random()).then(function (_job) {
                job = _job;

                return hive.do('test.cancel.workflow.single', 1234, random, Math.random()).then(function (_job) {
                    job2 = _job;

                    return utils.PromiseDelay(300).then(function () {
                        job.result().catch(function() {})
                        return job.cancel()
                    })
                })
            })
        })

        it('job.result() should be rejected with "Canceled"', function () {
            return job.result().should.be.rejectedWith(Error, 'Canceled')
        })

        it('job2.result() should be resolved after 1 retry, ~5sec', function () {
            this.timeout(6000)
            return job2.result().should.eventually.be.equal(1234)
        })

        it('job2 history contains submitted, queued, popped, exception, delayed and completed events', function () {
            _.flatten(job2.history, 'event').should.be.an('array')
                .and.include('submitted')
                .and.include('queued')
                .and.include('popped')
                .and.include('exception')
                .and.include('delayed')
                .and.include('completed')
        })

        it('parent job worker called 3 times', function () {
            return spyWorkflowParent.should.be.calledThrice;
        })

        it('child job worker called 2 times', function () {
            return spyWorkflowChild.should.be.calledTwice;
        })
    })


})

"use strict";

/* global describe, it, before, hivelib */

var Q = require('q');
var _ = require('lodash')

describe('Job dependencies', function () {

    var hive = hivelib.createHive();

    before(function () {

        hive.on('error', function(err) {
            global.hiveError = err;
        })

        hive.bee('test.dependencies', {
            worker: function(job, a) {
                return a;
            }
        })

        hive.bee('test.dependencies.1', {
            worker: function(job, a) {
                return a;
            }
        })

        hive.bee('test.dependencies.2', {
            worker: function(job, a) {
                return a;
            }
        })

        hive.bee('test.dependencies.failed', {
            worker: function(job, a) {
                job.options.retries = 2;

                throw {
                    message: 'Bad job',
                    retryDelay: 1000
                }

                return a;
            }
        })

        // worker for job.ttl test with disabled hash function
        hive.bee('test.dependencies.ttl', {
            worker: function(job, a) {
                job.options.ttl = 2000; // 2 sec
                return a;
            }
        })
    })

    describe('Depend on a single job #slow', function () {

        var job, depJob, random = Math.random();

        before(function () {

            return hive.do({
                    name: 'test.dependencies.1',
                    delay: 2000
                }, 7, random)
                .then(function (_job) {
                    job = _job;
                })
        })

        it('should execute after dependencies satisfied (>2secs)', function () {

            this.timeout(3000)

            var start = Date.now()

            return hive.do({
                name: 'test.dependencies',
                dependencies: [job.jid]
            }, 7, random)
                .then(function (_job) {
                    depJob = _job;
                    return _job.result()
                        .then(function () {
                            return (Date.now()-start).should.be.closeTo(2000, 510)
                        })
                })
        })

        it('job history should contain dependencyWaiting', function () {
            _.flatten(depJob.history, 'event').should.be.an('array')
                .and.include('dependancyWaiting')
        })

        it('should execute immediately because dependency already resolved', function () {

            var start = Date.now()

            return hive.do({
                name: 'test.dependencies',
                dependencies: [job.jid]
            }, 7, random)
                .post('result').then(function () {
                    return start.should.be.closeTo(Date.now(), 10)
                })
        })

    })

    describe('Depend on a multiple jobs #slow', function () {

        var job, job2, random = Math.random();

        before(function () {

            return Q.all([
                // job 1
                hive.do({
                    name: 'test.dependencies.1',
                    delay: 2000
                }, 7, random)
                    .then(function (_job) {
                        job = _job;
                    }),

                // job 2
                hive.do({
                    name: 'test.dependencies.2',
                    delay: 3000
                }, 7, random)
                    .then(function (_job) {
                        job2 = _job;
                    })
            ])

        })

        it('should execute after dependencies satisfied (>3secs)', function () {

            this.timeout(4000)

            var start = Date.now()

            return hive.do({
                name: 'test.dependencies',
                dependencies: [job.jid, job2.jid]
            }, 7, random)
                .post('result').then(function () {
                    return (Date.now()-start).should.be.gte(3000)
                })
        })

        it('should execute immediately because dependency already resolved', function () {

            var start = Date.now()

            return hive.do({
                name: 'test.dependencies',
                dependencies: [job.jid, job2.jid]
            }, 7, random)
                .post('result').then(function () {
                    return start.should.be.closeTo(Date.now(), 10)
                })
        })

    })

    describe('Depend on a already depending job #slow', function () {

        var job, job2, random = Math.random();

        before(function () {

            return hive.do({
                    name: 'test.dependencies.1',
                    delay: 2000
                }, 7, random)
                    .then(function (_job) {
                        job = _job;

                        return hive.do({
                            name: 'test.dependencies.2',
                            dependencies: [job.jid],
                            delay: 1000
                        }, 7, random)
                            .then(function (_job) {
                                job2 = _job
                            })
                    })

        })

        it('should execute after dependencies satisfied (>3.5secs)', function () {

            this.timeout(4500)

            var start = Date.now()

            return hive.do({
                name: 'test.dependencies',
                dependencies: [job.jid, job2.jid]
            }, 7, random)
                .post('result').then(function () {
                    return (Date.now()-start).should.be.gte(3000)
                })
        })

    })

    describe('Depend on a successful and failed jobs #slow', function () {

        var job, job2, random = Math.random();

        before(function () {

            return Q.all([
                // job 1
                hive.do({
                    name: 'test.dependencies.1'
                }, 7, random)
                    .then(function (_job) {
                        job = _job;
                    }),

                // job 2
                hive.do({
                    name: 'test.dependencies.failed'
                }, 7, random)
                    .then(function (_job) {
                        job2 = _job;
                    })
            ])

        })

        it('should execute after dependencies satisfied (>2secs)', function () {

            this.timeout(3500)

            var start = Date.now()

            return hive.do({
                name: 'test.dependencies',
                dependencies: [job.jid, job2.jid]
            }, 7, random)
                .post('result').then(function () {
                    return (Date.now()-start).should.be.gte(2000)
                })
        })

        it('should execute immediately because dependency already resolved', function () {

            var start = Date.now()

            return hive.do({
                name: 'test.dependencies',
                dependencies: [job.jid, job2.jid]
            }, 7, random)
                .post('result').then(function () {
                    return start.should.be.closeTo(Date.now(), 10)
                })
        })

    })

    describe('Depend on a already canceled job #slow', function () {

        var job, random = Math.random();

        before(function () {

            return hive.do({
                name: 'test.dependencies.1',
                delay: 2000
            }, 7, random)
                .then(function (_job) {
                    job = _job;
                    job.cancel()
                })
        })

        it('should execute immediately because dependency already resolved', function () {

            var start = Date.now()

            return hive.do({
                name: 'test.dependencies',
                dependencies: [job.jid]
            }, 7, random)
                .post('result').then(function () {
                    return start.should.be.closeTo(Date.now(), 20)
                })
        })

    })

    describe('Depend on a canceled job #slow', function () {

        var job, random = Math.random();

        before(function () {

            return hive.do({
                name: 'test.dependencies.1',
                delay: 2000
            }, 7, random)
                .then(function (_job) {
                    job = _job;
                })
        })

        it('should execute immediately because dependency already resolved', function () {

            var start = Date.now()

            return hive.do({
                name: 'test.dependencies',
                dependencies: [job.jid]
            }, 7, random)
                .then(function (_job) {
                    job.cancel();
                    return _job.result()
                        .then(function () {
                            return start.should.be.closeTo(Date.now(), 10)
                        })
                })

        })

    })

    describe('Cancel dependant job #slow', function () {

        var job, random = Math.random();

        before(function () {

            return hive.do({
                name: 'test.dependencies.1',
                delay: 2000
            }, 7, random)
                .then(function (_job) {
                    job = _job;
                })
        })

        it('should not execute canceled dependant job', function () {

            this.timeout(4000)

            return hive.do({
                name: 'test.dependencies',
                dependencies: [job.jid]
            }, 7, random)
                .then(function (_job) {
                    _job.cancel();

                    return job.result().then(function () {
                        return Q.all([
                            _job.result().should.be.rejectedWith(Error, 'Canceled'),

                            _.flatten(_job.history, 'event').should.be.an('array')
                                .and.include('dependancyWaiting')
                                .and.include('canceled')
                        ])

                    })
                })

        })

    })

    describe('Depend on already expired job #slow', function () {

        var job, depJob, random = Math.random();

        before(function () {

            return hive.do({
                name: 'test.dependencies.ttl'
            }, 7, random)
                .then(function (_job) {
                    job = _job;
                })
        })

        it('should execute immediately (after dep expired, ~2.5sec)', function () {

            this.timeout(4000)

            var start;

            return Q.delay(2500).then(function () {

                start = Date.now();

                return hive.do({
                    name: 'test.dependencies',
                    dependencies: [job.jid]
                }, 7, random)
                    .then(function (_job) {
                        depJob = _job;
                        return _job.result()
                            .then(function () {
                                return start.should.be.closeTo(Date.now(), 10)
                            })
                    })
            })
        })

        it('job history should not contain dependencyWaiting', function () {
            _.flatten(depJob.history, 'event').should.be.an('array')
                .and.not.include('dependancyWaiting')
        })


    })

    describe('hive.doTagsDependant #slow', function() {
        var job, random = Math.random(), tags = [
            'dependencies.tags.1',
            'dependencies.tags.2',
        ]

        before(function () {

            return hive.doTagsDependant({
                name: 'test.dependencies.1',
                tags: tags,
                delay: 2000
            }, 7, random)
                .then(function (_job) {
                    job = _job;
                })
        })

        it('should execute new job after dependencies matching tags are satisfied ~2sec', function() {
            var start = Date.now()

            this.timeout(3000)

            return hive.doTagsDependant({
                name: 'test.dependencies.2',
                tags: tags
            }, 8, random)
                .post('result')
                .then(function (result) {
                    return Q.all([
                        start.should.be.closeTo(Date.now(), 2500),
                        result.should.be.equal(8)
                    ])
                })
        })

    })


})

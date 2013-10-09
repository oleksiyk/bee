"use strict";

/* global describe, it, before, hivelib, sinon */

var Q = require('q');

describe('Job tags', function () {

    var hive = hivelib.createHive(), spyCLientTags;

    before(function () {

        hive.on('error', function(err) {
            global.hiveError = err;
        })

        hive.bee('test.tags.1', {
            worker: function(job, tags) {
                job.options.ttl = 1500;
                job.setTags(tags)

                return tags;
            }
        })

        spyCLientTags = sinon.spy(function(job, a) {
            job.options.ttl = 1500;
            return a;
        })

        hive.bee('test.tags.client', {
            worker: spyCLientTags
        })

        hive.bee('test.tags.failed', {
            worker: function(job, tag) {
                job.options.ttl = 1500;
                job.options.retries = 2;

                job.setTags(job.tags.concat(tag + job.retries)) // [tag + 0], [tag + 0, tag + 1], [tag + 0, tag + 1, tag + 2]

                throw {
                    message: 'Bad job',
                    retryDelay: 1000
                }

                return tag;
            }
        })

        hive.bee('test.tags.list', {
            worker: function(job) {
                job.options.ttl = 1500;
                job.setTags('tag1', 'tag2')

                return 'ok';
            }
        })
    })

    describe('Set a single string tag: job.setTags(tag123)', function () {

        var job;

        before(function () {
            return hive.do('test.tags.1', 'tag123', Math.random()).then(function (_job) {
                job = _job;

                return job.result()
            })
        })

        it('job is tagged and searchable by this tag', function () {
            return hive.search('tag123').should.eventually.be.a('array').that.include(job.jid)
        })

        it('adding non-existent tag to search should return empty array', function () {
            return hive.search('tag123', 'abracadabra').should.eventually.be.a('array').that.is.empty;
        })

        it('expired job is not searchable (job.ttl=1.5sec) #slow', function () {
            this.timeout(3000);
            return Q.delay(2500).then(function () {
                return hive.search('tag123').should.eventually.be.a('array').that.is.empty;
            })
        })

    })

    describe('Set multiple (2) tags as array: job.setTags([tag123, tag234])', function () {

        var job;

        before(function () {
            return hive.do('test.tags.1', ['tag123', 'tag234'], Math.random()).then(function (_job) {
                job = _job;

                return job.result()
            })
        })

        it('job is tagged and searchable by each of the tags', function () {
            return Q.all([
                hive.search('tag123').should.eventually.be.a('array').that.include(job.jid),
                hive.search('tag234').should.eventually.be.a('array').that.include(job.jid)
            ])
        })

        it('job is searchable by both tags at once', function () {
            return Q.all([
                hive.search(['tag123', 'tag234']).should.eventually.be.a('array').that.include(job.jid),
                hive.search('tag123', 'tag234').should.eventually.be.a('array').that.include(job.jid)
            ])
        })

        it('loaded job has all the tags', function () {
            return hive.search('tag123', 'tag234').then(function (jobs) {
                return hive.job(jobs[0]).then(function (_job) {
                    return _job.tags.should.be.deep.equal(['tag123', 'tag234'])
                })
            })
        })

        it('adding non-existent tag to search should return empty array', function () {
            return hive.search('tag123', 'tag234', 'abracadabra').should.eventually.be.a('array').that.is.empty;
        })

        it('expired job is not searchable by any of the tags (job.ttl=1.5sec) #slow', function () {
            this.timeout(3000);
            return Q.delay(2500).then(function () {
                return Q.all([
                    hive.search('tag123').should.eventually.be.a('array').that.is.empty,
                    hive.search('tag234').should.eventually.be.a('array').that.is.empty
                ])
            })
        })

    })

    describe('Set tags when submitting job', function () {
        var job;

        before(function () {
            return hive.do({
                name: 'test.tags.client',
                tags: ['clientTag1', 'clientTag2']
            }, 123, Math.random()).then(function (_job) {
                    job = _job;

                    return job.result()
                })
        })

        it('job is tagged and searchable by each of the tags', function () {
            return Q.all([
                hive.search('clientTag1').should.eventually.be.a('array').that.include(job.jid),
                hive.search('clientTag2').should.eventually.be.a('array').that.include(job.jid)
            ])
        })

        it('job is searchable by both tags at once', function () {
            return hive.search('clientTag1', 'clientTag2').should.eventually.be.a('array').that.include(job.jid)
        })

        it('loaded job has all the tags', function () {
            return hive.search('clientTag1', 'clientTag2').then(function (jobs) {
                return hive.job(jobs[0]).then(function (_job) {
                    return _job.tags.should.be.deep.equal(['clientTag1', 'clientTag2'])
                })
            })
        })

        it('worker job handle has correct tags', function () {
            return spyCLientTags.getCall(0).args[0].tags.should.be.deep.equal(['clientTag1', 'clientTag2'])
        })

        it('adding non-existent tag to search should return empty array', function () {
            return hive.search('clientTag1', 'clientTag2', 'abracadabra').should.eventually.be.a('array').that.is.empty;
        })

        it('expired job is not searchable by any of the tags (job.ttl=1.5sec) #slow', function () {
            this.timeout(3000);
            return Q.delay(2500).then(function () {
                return Q.all([
                    hive.search('clientTag1').should.eventually.be.a('array').that.is.empty,
                    hive.search('clientTag2').should.eventually.be.a('array').that.is.empty
                ])
            })
        })
    })

    describe('Add tags on failed job with each retry #slow', function () {

        var job;

        before(function () {
            return hive.do('test.tags.failed', 'X', Math.random()).then(function (_job) {
                job = _job;
            })
        })

        it('job should fail with "No more retries"', function () {
            this.timeout(3500)
            return job.result().should.be.rejectedWith(Error, 'No more retries')
        })

        it('job is searchable by all the progressive tags', function () {
            return hive.search('X0', 'X1', 'X2').should.eventually.be.a('array').that.include(job.jid)
        })

        it('expired job is not searchable by any of the tags (job.ttl=1.5sec)', function () {
            this.timeout(3000);
            return Q.delay(2500).then(function () {
                return Q.all([
                    hive.search('X0').should.eventually.be.a('array').that.is.empty,
                    hive.search('X1').should.eventually.be.a('array').that.is.empty,
                    hive.search('X2').should.eventually.be.a('array').that.is.empty
                ])
            })
        })

    })

    describe('Set multiple (2) tags as list: job.setTags(tag1, tag2)', function () {

        var job;

        before(function () {
            return hive.do('test.tags.list', Math.random()).then(function (_job) {
                job = _job;

                return job.result()
            })
        })

        it('job is tagged and searchable by each of the tags', function () {
            return Q.all([
                hive.search('tag1').should.eventually.be.a('array').that.include(job.jid),
                hive.search('tag2').should.eventually.be.a('array').that.include(job.jid)
            ])
        })

        it('job is searchable by both tags at once', function () {
            return hive.search('tag1', 'tag2').should.eventually.be.a('array').that.include(job.jid)
        })

    })


})

var Q = require('q');
var _ = require('lodash')

describe('Job history', function () {

    var hive;

    before(function () {

        return hivelib.createHivePromised()
            .then(function (res) {

                hive = res;

                hive
                    .on('log', function (message) {
                        if (message.level == 'error') {
                            global.hiveError = message.message;
                        }
                    })

                hive.bee('test.history.1', {
                    worker: function (job, a) {
                        return a;
                    }
                })

                hive.bee('test.history.failed', {
                    worker: function (job, a) {
                        job.options.retries = 2;

                        throw {
                            message: 'Bad job',
                            retryDelay: 1000
                        }

                        return a;
                    }
                })

            })
    })

    describe('Successful job and its duplicate', function () {

        var job, job2, random = Math.random();

        before(function () {
            return hive.do('test.history.1', 7, random).then(function (_job) {
                job = _job;
                return job.result().then(function () {
                    return hive.do('test.history.1', 7, random).then(function (_job) {
                        job2 = _job;
                        return job2.result();
                    })
                })
            })
        })

        it('original job history contains submitted, queued, popped, completed events', function () {
            _.flatten(job.history, 'event').should.be.an('array')
                .and.include('submitted')
                .and.include('queued')
                .and.include('popped')
                .and.include('completed')
        })

        it('all events should have timestamp property', function () {
            _.flatten(job.history, 'timestamp').should.be.an('array').that.have.length(job.history.length)
        })

        it('all events should have correct hive property', function () {
            _.flatten(job.history, 'hive').should.be.an('array').that.have.length(job.history.length)
            _.each(_.flatten(job.history, 'hive'), function (hiveId) {
                hiveId.should.be.equal(hive.id)
            })
        })

        it('duplicate job history contains submitted, queued, popped and duplicate events', function () {
            _.flatten(job2.history, 'event').should.be.an('array')
                .and.include('submitted')
                .and.include('queued')
                .and.include('popped')
                .and.include('duplicate')
        })

        it('duplicate event contains correct duplicate_jid property', function () {
            _.find(job2.history, {event: 'duplicate'}).should.have.a.property('duplicate_jid').that.is.equal(job.jid)
        })

    })

    describe('Failed job #slow', function () {
        var job, now;

        before(function () {
            return hive.do('test.history.failed', 'X', Math.random()).then(function (_job) {
                now = Date.now();
                job = _job;
            })
        })

        it('job should fail with "No more retries"', function () {
            this.timeout(3500)
            return job.result().should.be.rejectedWith(Error, 'No more retries')
        })

        it('history contains submitted, queued, popped, exception, delayed and failed events', function () {
            _.flatten(job.history, 'event').should.be.an('array')
                .and.include('submitted')
                .and.include('queued')
                .and.include('popped')
                .and.include('exception')
                .and.include('delayed')
                .and.include('failed')
        })

        it('should have 3 exception and queued events', function () {
            _.filter(job.history, {event: 'exception'}).should.be.an('array').that.have.length(3)
            _.filter(job.history, {event: 'queued'}).should.be.an('array').that.have.length(3)
        })

        it('exception events have property message="Bad job"', function () {
            _.find(job.history, {event: 'exception'}).should.have.a.property('message').that.is.equal('Bad job')
        })

        it('delayed event have property till which is a timestamp', function () {
            _.find(job.history, {event: 'delayed'}).should.have.a.property('till').that.is.a('number').and.is.closeTo(now, 3000)
        })

        it('failed event should have message property that contain "No more retries"', function () {
            _.find(job.history, {event: 'failed'}).should.have.a.property('message').that.contain('No more retries')
        })

    })

    describe('Delayed job', function () {
        var job, now;

        before(function () {
            return hive.do({
                name: 'test.history.1',
                delay: 100
            }, 'X', Math.random()).then(function (_job) {
                    now = Date.now();
                    job = _job;
                    return job.result();
                })
        })

        it('history contains submitted, queued, popped, delayed and completed events', function () {
            _.flatten(job.history, 'event').should.be.an('array')
                .and.include('submitted')
                .and.include('queued')
                .and.include('popped')
                .and.include('delayed')
                .and.include('completed')
        })

        it('delayed event have property till which is a timestamp', function () {
            _.find(job.history, {event: 'delayed'}).should.have.a.property('till').that.is.a('number').and.is.closeTo(now+100, 100)
        })

    })

    describe('Canceled delayed job', function () {
        var job;

        before(function () {
            return hive.do({
                name: 'test.history.1',
                delay: 100
            }, 'X', Math.random()).then(function (_job) {
                    job = _job;
                    job.cancel();
                    return job.result().fail(function () {
                        
                    })
                })
        })

        it('history contains submitted, delayed and canceled events', function () {
            _.flatten(job.history, 'event').should.be.an('array')
                .and.include('submitted')
                .and.include('delayed')
                .and.include('canceled')
        })


    })


})
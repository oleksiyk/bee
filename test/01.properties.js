"use strict";

var os = require("os");
var crypto = require('crypto')

var Q = require('q')

/* global describe, it, before, hivelib, sinon */

describe('Objects, methods and properties', function () {

    var bee, workerSpy, hashSpy, job, job2, job2Options, hive, hivePromise, submitted, queueName = 'test.hive.1', random = Math.random();

    job2Options = {
        name: queueName,

        retries: 1, // wont be set
        ttl: 20000, // wont be set
        retryDelay: 4123, // wont be set
        progressiveDelay: true, // wont be set

        priority: 5,
        delay: 10,
        timeout: 1234578
    };

    describe('library', function () {

        describe('#createHive', function () {
            it('should be a function', function () {
                hivelib.should.respondTo('createHive')
            })

            it('should return Hive object', function () {
                hive = hivelib.createHive();

                hive.should.be.a('object').and.have.property('id')
            })
        })
    })

    describe('hive', function () {

        var jobPromise;

        before(function () {

            hive.on('error', function(err) {
                global.hiveError = err;
            })

            // create a spy for worker function
            workerSpy = sinon.spy(function (job, a) {
                return a;
            })

            // create a spy for hash function
            hashSpy = sinon.spy(function (job) {
                return crypto.createHash('sha1').update(JSON.stringify(job.data)).digest("hex")
            })

            bee = hive.bee(queueName, {
                hash: hashSpy,
                worker: workerSpy
            })

        })

        it('should have #id property', function () {
            hive.should.have.property('id')
        })

        describe('#id', function () {
            it('is a string', function () {
                hive.id.should.be.a('string')
            })

            it('is more than 32 characters', function () {
                hive.id.should.have.length.above(32);
            })

            it('contains computer hostname', function () {
                hive.id.should.include(os.hostname())
            })
        })

        describe('#bee()', function () {
            it('is a function', function () {
                hive.should.respondTo('bee')
            })
        })

        describe('#do()', function () {
            it('is a function', function () {
                hive.should.respondTo('do')
            })

            it('returns a promise', function () {
                jobPromise = hive.do(queueName);

                Q.isPromise(jobPromise).should.be.ok;

                return jobPromise.should.be.fulfilled;
            })
        })

        describe('#search()', function () {
            it('is a function', function () {
                hive.should.respondTo('search')
            })

            it('returns a promise', function () {
                var promise = hive.search('some tag');

                Q.isPromise(promise).should.be.ok;

                return promise.should.be.fulfilled;
            })
        })

        describe('#queueSize()', function () {
            it('is a function', function () {
                hive.should.respondTo('queueSize')
            })

            describe('returns a ...', function () {
                var job, promise, queue = queueName + Math.random();

                before(function () {
                    return Q.all([
                        hive.do({
                            name: queue,
                            delay: 500
                        }, 1),
                        hive.do(queue, 2)
                    ])
                })

                it('a promise', function () {
                    promise = hive.queueSize(queue);
                    return Q.isPromise(promise).should.be.ok;
                })

                it('correct value', function () {
                    return promise.should.eventually.be.equal(2)
                })
            })

        })

        describe('#job()', function () {
            it('is a function', function () {
                hive.should.respondTo('job')
            })

            describe('returns a ..', function () {

                var job, promise;

                before(function () {
                    return hive.do(queueName).then(function (_job) {
                        job = _job;
                        promise = hive.job(job.jid);
                    })
                })

                it('promise', function () {
                    Q.isPromise(promise).should.be.ok;
                })

                it('which should resolve for valid JID', function () {
                    return promise.should.be.fulfilled;
                })

                it('and should reject for invalid JID', function () {
                    return hive.job('invalid jid here').should.be.rejectedWith(Error, 'Not found')
                })
            })


        })

    })

    describe('bee', function () {

        it('is an object', function () {
            bee.should.be.a('object')
        })

        describe('#id', function () {
            it('is a string', function () {
                bee.should.have.property('id').that.is.a('string')
            })

            it('is more than 32 characters', function () {
                bee.id.should.have.length.above(32)
            })

            it('contains bee (queue) name', function () {
                bee.id.should.include(queueName)
            })

            it('contains hive.id', function () {
                bee.id.should.include(hive.id)
            })
        })
    })

    describe('client job handle', function () {

        // send the jobs
        before(function () {

            hashSpy.reset();
            workerSpy.reset();

            submitted = Date.now();

            return hive.do(queueName, random).then(function (res) {
                job = res;
            })
        })

        it('is an object', function () {
            job.should.be.a('object')
        })

        it('has #jid property that is a string', function () {
            job.should.have.property('jid').that.is.a('string');
        })

        it('has #queue property that is a string', function () {
            job.should.have.property('queue').that.is.a('string');
        })

        it('has #data property that is an array', function () {
            job.should.have.property('data').that.is.a('array')
        })

        it('has #options property that is an object', function () {
            job.should.have.property('options').that.is.a('object')
        })

        it('has #tags property that is an array', function () {
            job.should.have.property('tags').that.is.a('array')
        })

        it('has #history property that is an array', function () {
            job.should.have.property('history').that.is.a('array')
        })

        it('has method #cancel()', function () {
            job.should.respondTo('cancel');
        })


        describe('#result()', function () {

            it('is a function', function () {
                job.should.respondTo('result')
            })

            it('returns a promise', function () {
                job.result().should.respondTo('then')
            })

        })
    })

    describe('bee methods arguments', function () {

        it('hash args should equal worker args', function () {
            return job.result().then(function () {
                //job.data
                hashSpy.getCall(0).args[0].data.should.equal(workerSpy.getCall(0).args[0].data);
                //job.jid
                hashSpy.getCall(0).args[0].jid.should.equal(workerSpy.getCall(0).args[0].jid);
                //job.options
                hashSpy.getCall(0).args[0].options.should.equal(workerSpy.getCall(0).args[0].options);
                return hashSpy.getCall(0).args[1].should.equal(workerSpy.getCall(0).args[1])
            })
        })
    })

    describe('bee (worker) job handle', function () {

        var workerJob;

        before(function () {
            return job.result().then(function () {
                workerJob = workerSpy.getCall(0).args[0];
            })
        })

        it('is an object', function () {
            return workerJob.should.be.a('object')
        })

        it('has method #progress()', function () {
            workerJob.should.respondTo('progress');
        })

        it('has method #sub()', function () {
            workerJob.should.respondTo('sub');
        })

        it('#sub() returns a promise', function () {
            return Q.isPromise(workerJob.sub(queueName, Math.random()))
        })

        it('has method #setTags()', function () {
            workerJob.should.respondTo('setTags');
        })

        it('has #jid property that is a string', function () {
            workerJob.should.have.property('jid').that.is.a('string')
        })

        it('has #queue property that matches the name of sent job ("' + queueName + '")', function () {
            workerJob.should.have.property('queue').that.is.a('string').and.equal(queueName)
        })

        it('has #worker property that matches worker.id', function () {
            workerJob.should.have.property('worker').that.is.a('string').and.equal(bee.id)
        })

        it('has #data property that is an array', function () {
            workerJob.should.have.property('data').that.is.a('array')
        })

        it('has #options property that is an object', function () {
            workerJob.should.have.property('options').that.is.a('object')
        })

        it('has #tags property that is an array', function () {
            workerJob.should.have.property('tags').that.is.a('array')
        })

        it('has #history property that is an array', function () {
            workerJob.should.have.property('history').that.is.a('array')
        })

        it('has #status property', function () {
            workerJob.should.have.property('status').that.is.a('string')
        })

        it('has #retries property = 0', function () {
            workerJob.should.have.property('retries').that.is.a('number').and.equal(0)
        })

        it('has #submitted property that is close to time of job submission', function () {
            workerJob.should.have.property('submitted').that.is.a('number').and.closeTo(submitted, 50)
        })

        describe('#options (default)', function () {

            it('has #ttl property', function () {
                workerJob.options.should.have.property('ttl').that.is.a('number')
            })

            it('has #priority property', function () {
                workerJob.options.should.have.property('priority').that.is.a('number')
            })

            it('has #retries property', function () {
                workerJob.options.should.have.property('retries').that.is.a('number')
            })

            it('has #delay property', function () {
                workerJob.options.should.have.property('delay').that.is.a('number')
            })

            it('has #retryDelay property', function () {
                workerJob.options.should.have.property('retryDelay').that.is.a('number')
            })

            it('has #progressiveDelay property', function () {
                workerJob.options.should.have.property('progressiveDelay').that.is.a('boolean')
            })
        })

        describe('#options (overide by client)', function () {

            var workerJob2;

            before(function () {

                hashSpy.reset();
                workerSpy.reset();

                submitted = Date.now();

                return hive.do(job2Options, random + random).then(function (res) {
                    job2 = res;
                    return job2.result().then(function () {
                        workerJob2 = workerSpy.getCall(0).args[0];
                    })
                })
            })

            it('#ttl can\'t be set by client', function () {
                workerJob2.options.should.have.property('ttl').that.is.a('number').and.not.equal(job2Options.ttl)
            })

            it('#retries can\'t be set by client', function () {
                workerJob2.options.should.have.property('retries').that.is.a('number').and.not.equal(job2Options.retries)
            })

            it('#retryDelay can\'t be set by client', function () {
                workerJob2.options.should.have.property('retryDelay').that.is.a('number').and.not.equal(job2Options.retryDelay)
            })

            it('#progressiveDelay can\'t be set by client', function () {
                workerJob2.options.should.have.property('progressiveDelay').that.is.a('boolean').and.not.equal(job2Options.progressiveDelay)
            })

            it('#priority', function () {
                workerJob2.options.should.have.property('priority').that.is.a('number').and.equal(job2Options.priority)
            })

            it('#delay', function () {
                workerJob2.options.should.have.property('delay').that.is.a('number').and.equal(job2Options.delay)
            })

        })

    })
})


"use strict";

/* global describe, it, before, hivelib, sinon */

var Q = require('q')

describe('Failed jobs', function () {
    var hive = hivelib.createHive(), failedSpyThrow, failedSpyHashThrowHash, failedSpyHashThrowWorker;

    before(function() {

        hive.on('error', function(err) {
            global.hiveError = err;
        })

        // this worker will permanently reject any negative number
        hive.bee('test.failed.sqrt', {
            worker: function(job, a) {

                if (a < 0) {
                    throw {
                        message: 'Argument must be positive',
                        retry: false
                    }
                }

                return Math.sqrt(a);
            }
        })

        // this worker rejects the job without throwing an exception
        hive.bee('test.failed.rejectedPromise', {
            worker: function(job) {
                var deferred = Q.defer();

                Q.delay(2000).then(function() {
                    deferred.reject({
                        message: 'Rejected promise',
                        retry: false
                    })
                })

                return deferred.promise;
            }
        })

        // this worker will throw a error for a 'fresh' job, which should than be processed in retry after 30s
        failedSpyThrow = sinon.spy(function(job, a) {

            // fail the 'fresh' job
            if (job.submitted > (Date.now() - 500)) {
                throw new Error('Your job is too fresh!')
            }

            return a;
        })

        hive.bee('test.failed.throw', {
            worker: failedSpyThrow
        })


        // this worker will emit error in hash function so the job should eventually fail permanently
        failedSpyHashThrowHash = sinon.spy(function(job, a) {
            job.options.retries = 1;
            eval('abracadabra');
        })

        failedSpyHashThrowWorker = sinon.spy(function(job, a) {
            return a;
        })

        hive.bee('test.failed.hash.throw', {
            hash: failedSpyHashThrowHash,
            worker: failedSpyHashThrowWorker
        })

        // this worker will forget to resolve the promise
        hive.bee('test.failed.timeout', {
            timeout: 3000,
            worker: function(job, a) {

                job.options.retries = 0;

                var deferred = Q.defer();

                return deferred.promise;
            }
        })

        // this worker will forget to resolve the HASH promise
        hive.bee('test.failed.timeout.hash', {
            timeout: 3000,
            hash: function(job, a) {

                job.options.retries = 0;

                var deferred = Q.defer();

                return deferred.promise;
            },
            worker: function(job, a) {
                return a;
            }
        })

        // this worker will permanently reject any negative number after delay
        hive.bee('test.failed.sqrt.slow', {
            worker: function(job, a) {

                return Q.delay(3000).then(function() {
                    if (a < 0) {
                        throw {
                            message: 'Argument must be positive',
                            retry: false
                        }
                    }

                    return Math.sqrt(a)
                });
            }
        })

        // this worker should test hash method
        hive.bee('test.failed.hash.results', {
            hash: function(job, a) {
                job.options.retries = 0;

                if (a === 0) throw 'Exception as string'

                if (a === -1) a = undefined;

                return a;
            },
            worker: function(job, a) {
                return a;
            }
        })

    })

    describe('Invalid Job - rejected with {retry=false} exception in worker', function () {

        var jid;

        it('should be rejected with Error(Argument must be positive) immediately', function () {
            return hive.do('test.failed.sqrt', -100, Math.random()).then(function (job) {
                jid = job.jid;
                return job.result().should.be.rejectedWith(Error, 'Argument must be positive');
            })
        })

        it('should give the same failed reason when job is retrieved with hive.job()', function () {
            return hive.job(jid).post('result').should.be.rejectedWith(Error, 'Argument must be positive');
        })

        it('should work with proper argument (Math.sqrt(16) == 4)', function () {
            return hive.do('test.failed.sqrt', 16, Math.random()).then(function (job) {
                return job.result().should.eventually.equal(4)
            })
        })

    })

    describe('Invalid Job - rejected promise', function () {

        var jid;

        it('should be rejected with Error(Rejected promise) after 2 seconds', function () {
            this.timeout(3000)
            return hive.do('test.failed.rejectedPromise', -100, Math.random()).then(function (job) {
                jid = job.jid;
                return job.result().should.be.rejectedWith(Error, 'Rejected promise');
            })
        })

        it('should give the same failed reason when job is retrieved with hive.job()', function () {
            return hive.job(jid).post('result').should.be.rejectedWith(Error, 'Rejected promise');
        })

    })


    describe('Failed once with thrown Error exception in worker and then resolved in next retry #slow', function () {

        var job;

        before(function () {
            return hive.do('test.failed.throw', 123, Math.random()).then(function (res) {
                job = res;
            })
        })

        it('should resolve in about 30 seconds', function () {

            this.timeout(40 * 1000);

            var start = Date.now();

            return job.result()
                .then(function (result) {
                    result.should.be.equal(123);

                    (Date.now() - start).should.be.closeTo(30 * 1000, 1000)
                })
        })

        it('worker should be called twice', function () {
            return job.result().thenResolve(failedSpyThrow.should.be.calledTwice);
        })

        it('job.retries should match calls count', function () {
            return job.result().then(function () {
                failedSpyThrow.getCall(0).args[0].retries.should.equal(0);
                failedSpyThrow.getCall(1).args[0].retries.should.equal(1);
            })
        })


    })

    describe('ReferenceError exception thrown in hash method (job.options.retries=1) #slow', function () {

        var job, start;

        before(function () {
            start = Date.now();

            return hive.do('test.failed.hash.throw', 321, Math.random()).then(function (res) {
                job = res;
            })
        })

        it('should be rejected in about 30 seconds', function () {

            this.timeout(35 * 1000);

            return job.result()
                .fail(function () {
                    (Date.now() - start).should.be.closeTo(30 * 1000, 1000)
                })
        })

        it('should be rejected with Error(No more retries)', function () {
            return job.result()
                .should.be.rejectedWith(Error, 'No more retries');
        })

        it('worker should not be called', function () {
            return job.result().fail(function () {
                return failedSpyHashThrowWorker.should.not.be.called;
            });
        })

        it('hash function should be called twice', function () {
            return job.result().fail(function () {
                return failedSpyHashThrowHash.should.be.calledTwice;
            });
        })

        it('hash function should throw ReferenceError', function () {
            return job.result().fail(function () {
                return failedSpyHashThrowHash.getCall(0).should.have.thrown('ReferenceError')
            });
        })

        it('job.retries should match specified in job options', function () {
            return job.result().fail(function () {
                failedSpyHashThrowHash.getCall(0).args[0].retries.should.equal(0);
                failedSpyHashThrowHash.getCall(1).args[0].retries.should.equal(1);
            })
        })

    })

    describe('Worker timeout (unfulfilled promise) (bee.timeout=3000, job.options.retries=0) #slow', function () {

        var job, start;

        before(function () {
            start = Date.now();

            return hive.do('test.failed.timeout', 321, Math.random()).then(function (res) {
                job = res;
            })
        })

        it('should be rejected in about 3 seconds', function () {

            this.timeout(5 * 1000);

            return job.result()
                .fail(function () {
                    (Date.now() - start).should.be.closeTo(3 * 1000, 1000)
                })
        })

        it('should be rejected with Error(timed out)', function () {
            return job.result()
                .should.be.rejectedWith(Error, 'Worker method timed out');
        })

    })

    describe('Hash timeout (unfulfilled promise) (bee.timeout=3000, job.options.retries=0) #slow', function () {

        var job, start;

        before(function () {
            start = Date.now();

            return hive.do('test.failed.timeout.hash', 321, Math.random()).then(function (res) {
                job = res;
            })
        })

        it('should be rejected in about 3 seconds', function () {

            this.timeout(5 * 1000);

            return job.result()
                .fail(function () {
                    (Date.now() - start).should.be.closeTo(3 * 1000, 1000)
                })
        })

        it('should be rejected with Error(timed out)', function () {
            return job.result()
                .should.be.rejectedWith(Error, 'Hash method timed out');
        })

    })

    describe('Duplicate sent for already failed job', function () {
        var job1, job2, random = Math.random();
        ;

        before(function () {
            return hive.do('test.failed.sqrt', -124, random).then(function (job) {
                job1 = job;

                return job1.result().fail(function () {
                    return hive.do('test.failed.sqrt', -124, random).then(function (job) {
                        job2 = job;
                    })
                })
            })
        })

        it('original job should fail with error "Argument must be positive"', function () {
            return job1.result().should.be.rejectedWith(Error, 'Argument must be positive')
        })

        it('duplicate job should fail with the same error "Argument must be positive"', function () {
            return job2.result().should.be.rejectedWith(Error, 'Argument must be positive')
        })

        it('second job should be marked as duplicate', function () {
            return job2.duplicateJid.should.equal(job1.jid);
        })

        it('job loaded with hive.job(jid) should be the same', function () {
            return hive.job(job2.jid).then(function (_job) {
                return _job.result().should.be.rejectedWith(Error, 'Argument must be positive')
            })
        })

    })

    describe('Duplicate sent for eventually failed job #slow', function () {
        var job1, job2, job1end, job2end, random = Math.random();
        ;

        before(function () {
            return hive.do('test.failed.sqrt.slow', -124, random).then(function (job) {
                job1 = job;

                job1.result().fail(function () {
                    job1end = Date.now()
                })

                return hive.do('test.failed.sqrt.slow', -124, random).then(function (job) {
                    job2 = job;

                    job2.result().fail(function () {
                        job2end = Date.now()
                    })
                })
            })
        })

        it('original job should fail with error "Argument must be positive" in 3 seconds', function () {
            this.timeout(4000)
            return job1.result().should.be.rejectedWith(Error, 'Argument must be positive')
        })

        it('duplicate job should fail with the same error "Argument must be positive"', function () {
            return job2.result().should.be.rejectedWith(Error, 'Argument must be positive')
        })

        it('second job should be marked as duplicate', function () {
            return job2.duplicateJid.should.equal(job1.jid);
        })

        it('execution time for both jobs should be very close (+-20ms)', function () {
            job1end.should.be.closeTo(job2end, 20)
        })
    })

    describe('Bad hash', function () {
        describe('hash method returns undefined', function () {
            var job;
            before(function () {
                return hive.do('test.failed.hash.results', -1).then(function (_job) {
                    job = _job;
                })
            })

            it('should fail with Error(Hash can only be a number or string and not undefined)', function () {
                return job.result().should.be.rejectedWith(Error, 'Hash can only be a number or string and not undefined')
            })
        })

        describe('hash method returns empty string', function () {
            var job;
            before(function () {
                return hive.do('test.failed.hash.results', '').then(function (_job) {
                    job = _job;
                })
            })

            it('should fail with Error(Hash string is too short)', function () {
                return job.result().should.be.rejectedWith(Error, 'Hash string is too short')
            })
        })

        describe('hash method returns an object', function () {
            var job;
            before(function () {
                return hive.do('test.failed.hash.results', {x: 'y'}).then(function (_job) {
                    job = _job;
                })
            })

            it('should fail with Error(Hash can only be a number or string and not object)', function () {
                return job.result().should.be.rejectedWith(Error, 'Hash can only be a number or string and not object')
            })
        })

        describe('hash method throws exception that is not an object', function () {
            var job;
            before(function () {
                return hive.do('test.failed.hash.results', 0).then(function (_job) {
                    job = _job;
                })
            })

            it('should fail with Error(Exception as string)', function () {
                return job.result().should.be.rejectedWith(Error, 'Exception as string')
            })
        })
    })


})


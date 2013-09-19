describe('Successful job and duplicate', function () {
    var hive, spy, job, random = Math.random(); // use random number for repeated tests

    before(function(){

        return hivelib.createHivePromised()
            .then(function (res) {
                hive = res;

                // create a spy for worker function
                spy = sinon.spy(function(job, a, b){
                    return a+b;
                })

                hive.bee('test.basic.sum', {
                    worker: spy
                })

                hive
                    .on('log', function (message) {
                        if (message.level == 'error') {
                            global.hiveError = message.message;
                        }
                    })
            })



    })

    describe('Calculate sum(2, 3)', function () {

        before(function () {
            return hive.do('test.basic.sum', 2, 3, random).then(function (res) {
                job = res;
            })
        })

        it('arguments received by worker were: (2, 3)', function () {
            return job.result()
                .then(function () {
                    return spy.should.have.been.calledWith(sinon.match.object, 2, 3)
                })
        })

        it('result is 5', function () {
            return job.result().should.eventually.equal(5)
        })

        it('sent JID is the same as received JID', function () {
            return job.result()
                .thenResolve(spy.getCall(0).args[0].jid.should.equal(job.jid))
        })

    })

    describe('Calculate sum(2, 3) - duplicate', function () {

        before(function () {
            return hive.do('test.basic.sum', 2, 3, random).then(function (res) {
                job = res;
            })
        })

        it('worker wasn\'t called the second time', function () {
            return job.result()
                .thenResolve(spy.should.be.calledOnce)
        })

        it('result is 5', function () {
            return job.result().should.eventually.equal(5)
        })

        it('job loaded with hive.job(jid) should be the same', function () {
            return hive.job(job.jid).then(function (_job) {
                return _job.result().should.eventually.equal(5)
            })
        })
    })
})


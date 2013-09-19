var Q = require('q');

describe('Progress notifications', function () {

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

                // will send progress notifications each 100ms until resolved
                hive.bee('test.progress.1', {
                    worker: function (job, a) {
                        var deferred = Q.defer();
                        var progress = 0;

                        var f = function () {

                            progress += 10;

                            deferred.notify(progress);

                            if (progress == 100) {
                                deferred.resolve(a)
                            } else {
                                setTimeout(f, 100);
                            }
                        }

                        f();

                        return deferred.promise;
                    }
                })

                // should bubble the progress from child job
                hive.bee('test.progress.2', {
                    worker: function (job, a) {

                        return hive.do('test.progress.1', a, Math.random()).post('result')
                            .thenResolve(a + a);

                    }
                })

                // should modify child progress by adding 1 (11, 21, 31...)
                hive.bee('test.progress.3', {
                    worker: function (job, a) {

                        return hive.do('test.progress.2', a, Math.random()).post('result')
                            .progress(function (progress) {
                                return progress + 1;
                            })
                            .thenResolve(a + a);

                    }
                })
            })
    })

    describe('Single job progress', function () {

        var result, progressSpy = sinon.spy(function (progress) {

        });

        before(function () {
            result = hive.do('test.progress.1', 123, Math.random()).post('result').progress(progressSpy)

            return result;
        })

        it('progress listener should be called at least 7 times (20,30,40,50,60,70,80)', function () {
            progressSpy.callCount.should.be.at.least(7);
            progressSpy.should.be.calledWith(20);
            progressSpy.should.be.calledWith(30);
            progressSpy.should.be.calledWith(40);
            progressSpy.should.be.calledWith(50);
            progressSpy.should.be.calledWith(60);
            progressSpy.should.be.calledWith(70);
            progressSpy.should.be.calledWith(80);
        })

    })

    describe('Bubbling job progress', function () {

        var result, progressSpy = sinon.spy(function (progress) {

        });

        before(function () {
            result = hive.do('test.progress.2', 123, Math.random()).post('result').progress(progressSpy)

            return result;
        })

        it('progress listener should be called at least 7 times (20,30,40,50,60,70,80)', function () {
            progressSpy.callCount.should.be.at.least(7);
            progressSpy.should.be.calledWith(20);
            progressSpy.should.be.calledWith(30);
            progressSpy.should.be.calledWith(40);
            progressSpy.should.be.calledWith(50);
            progressSpy.should.be.calledWith(60);
            progressSpy.should.be.calledWith(70);
            progressSpy.should.be.calledWith(80);
        })

    })

    describe('Modifying bubbling job progress', function () {

        var result, progressSpy = sinon.spy(function (progress) {

        });

        before(function () {
            result = hive.do('test.progress.3', 123, Math.random()).post('result').progress(progressSpy)

            return result;
        })

        it('progress listener should be called at least 7 times (21,31,41,51,61,71,81)', function () {
            progressSpy.callCount.should.be.at.least(7);
            progressSpy.should.be.calledWith(21);
            progressSpy.should.be.calledWith(31);
            progressSpy.should.be.calledWith(41);
            progressSpy.should.be.calledWith(51);
            progressSpy.should.be.calledWith(61);
            progressSpy.should.be.calledWith(71);
            progressSpy.should.be.calledWith(81);
        })

    })

})
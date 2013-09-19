"use strict";

var _ = require('lodash');
var Path = require('path');
var crypto = require('crypto');
var Q = require('q');

var hive = require('../../lib').createHive({
    redis: {
        log: false
    }
});

hive.on('log', function(log){
    if(log.level == 'error'){
        console.error(log.message)
    } else {
        console.log(log.message)
    }
})

hive.on('ready', function () {

    // setup bees

    hive.bee('Image.create', {

        hash: false,

        worker: function (job, workload) {

            console.log('CREATE: received job:', job.jid, 'workload=', workload);

            job.setTags(['customerId='+workload.customerId, 'tag1'])

            return job.sub('Image.download', workload.largeUrl).post('result')
                .then(function (download) {
                    return job.sub('Image.process', workload.smallWidth, workload.smallHeight, download.path).post('result')
                })
                .then(function (process) {
                    return job.sub('Image.upload', process.slices).post('result')
                        .then(function (upload) {
                            return _.extend(workload, process, upload);
                        })
                })
        }
    });

    hive.bee('Image.download', {

        hash: function (job, url) {
            console.log('Calculating HASH for job: ', job.jid);

            return crypto.createHash('sha1').update(url).digest("hex");
        },

        worker: function (job, url) {

            console.log('DOWNLOAD: received job:', job.jid, 'url=', url, 'hash=', job.hash);

            return {
                path: '/mnt/storage/large.jpg'
            };
        }
    });

    hive.bee('Image.process', {
        worker: function (job, width, height, path) {

            console.log('PROCESS: received job:', job.jid, 'width=', width, 'height=', height, 'path=', path);

            var processProgress = [];

            return Q.all(_.map([1, 2, 3, 4, 5], function (i) {
                    return job.sub('Image.resize', path, width + i * 200, height + i * 200).post('result')
                        .then(function (resize) {
                            return job.sub('Image.slice', resize.slicePath).post('result')
                        })
                        .progress(function (progress) {
                            processProgress[i - 1] = progress;
                            job.progress(_.reduce(processProgress, function (a, b) {
                                return a + b
                            }) / 5)
                        })
                }))
                .then(function (result) {
                    return {
                        slices: result
                    }
                })
        }
    });

    hive.bee('Image.resize', {
        worker: function (job, path, width, height) {

            var deferred = Q.defer();

            console.log('RESIZE: received job:', job.jid, 'path=', path, 'width=', width, 'height=', height);

            //process.exit(0);

            var progress = 0;

            var f = function () {

                deferred.notify(progress++);

                if (progress == 100) {
                    deferred.resolve({
                        slicePath: '/mnt/storage/resized/' + width + 'x' + height + '/image.jpg'
                    });
                } else {
                    setTimeout(f, 300 * Math.random());
                }

            };

            f()

            return deferred.promise;
        }
    });

    hive.bee('Image.slice', {
        worker: function (job, path) {

            console.log('SLICE: received job:', job.jid, 'path=', path);

            return Q.delay(1000 * Math.random()).thenResolve({
                slices: Path.dirname(path)
            })

        },
        wait: 50
    });

    hive.bee('Image.upload', {

        hash: false,

        worker: function (job, slices) {

            console.log('UPLOAD: received job:', job.jid, 'slices=', slices);

            return {
                s3: 's3://bucket/folder/'
            };

        }
    });

}, function(err){
    console.error('Failed to start hive:', err)
})
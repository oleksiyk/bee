"use strict";

//var _ = require('lodash')

// var Q = require('q')

var hive = require('../../lib').createHive({
    redis: {
        log: false
    }
});

hive.on('log', function(log) {
    if (log.level == 'error') {
        console.error(log.message)
    } else {
        console.log(log.message)
    }
})

hive.on('error', function(err) {
    console.error(err)
})

hive.do({
    name: 'Image.create',
    delay: 0
}, {
    customerId: 1234,
    largeUrl: 'http://url.com/image.jpg',
    smallWidth: 100 + Math.round(10 * Math.random()),
    smallHeight: 300
})
    .then(function(job) {

        /*
            Q.delay(2000).then(function () {
                hive.cancel(job);
            })
            */

        job.result()
            .then(function(result) {
                console.log('jid:', job.jid, ', result:', result);
                console.log(job.history);
                //process.exit(0);
            })
            .progress(function(progress) {
                process.stdout.write('\rProcessing progress=' + Number(progress).toFixed(2) + '%')
            })
            .fail(function(err) {
                console.log('jid:', job.jid, ' FAILED:', err)
            })
    })
    .done()

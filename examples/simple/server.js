"use strict";

var hive = require('../../lib').createHive();

// setup bees

hive.bee('test', {
    worker: function (job, workload, i) {

        console.log('Received job:', job.jid);

        setTimeout(function(){

            console.log('Job done:', job.jid);

            job.done({
                'i': i,
                'workload.largeUrl': workload.largeUrl
            });

        }, 1000 * 3)

    },
    concurrency: 5
});


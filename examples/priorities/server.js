"use strict";

var hive = require('../../lib').createHive();

// setup bees

hive.bee('test.priority', {
    worker: function (job, workload) {

        console.log('Received job:', job.jid, job.options.priority);

        setTimeout(function(){

            job.done({
                task: workload,
                priority: job.options.priority
            });

        }, 1000)

    },
    concurrency: 5
});


"use strict";

var hive = require('../../lib').createHive();

var f = function() {

    var job = hive.do({
        name: 'test.priority',
        priority: 9
    }, 'high priority task' + Math.random());

    job.on('completed', function() {

        console.log('COMPLETE JOB:', job.jid, job.result);
    });
}

setInterval(f, 10)

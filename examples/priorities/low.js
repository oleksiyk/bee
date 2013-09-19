"use strict";

var hive = require('../../lib').createHive();

hive.on('ready', function(){

        var job = hive.do({
            name: 'test.priority',
            priority: 0
        }, 'low priority task');

        job.on('completed', function(){
            console.log('COMPLETE JOB:', job.jid, job.result);
        });
})

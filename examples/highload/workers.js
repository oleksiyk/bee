"use strict";

var hive = require('../../lib').createHive();
var crypto = require('crypto')

// var Q = require('q')

hive.on('log', function(log){
    if(log.level == 'error'){
        console.error(log.message)
    } else {
        console.log(log.message)
    }
})

// setup bees

var rcvd = 0;

setInterval(function(){
    console.log('Jobs=', rcvd)
}, 3000)

hive.bee('highload', {

    concurrency: 1000,

    hash: function(job, workload){

        return crypto.createHash('sha1').update(workload.toString()).digest("hex");
    },

    worker: function (job, workload) {

        rcvd++;

        return workload;
    }
});




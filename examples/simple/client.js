"use strict";

var hive = require('../../lib').createHive();

for (var i = 0; i < 1; i++) {

    var job = hive.do('test', {
        largeUrl: 'http://url.com/image' + i + '.jpg',
        smallWidth: 100,
        smallHeight: 300
    }, i);

    job.result().then(function(result) {

        console.log('COMPLETE JOB:', job.jid, result);
    });
}

var hive = require('../../lib').createHive();

hive.on('error', function(err){
    console.error(err)
})

var rcvd = 0;
var sent = 0;

var step = 100;
var toSend = 100*1000;

var start = Date.now();

var sendWorkloadJobs = function(){

    var workload = Math.random();

    sent += step;

    for(var i = 0; i<step; i++){

        setTimeout(function(){
            hive.do('highload', workload).post('result')
                .then(function () {
                    rcvd++;

                    if (rcvd == toSend) {
                        console.log('ALL DONE!, total time=', (Date.now() - start), 'ms, avg.rate=', (1000 * toSend / (Date.now() - start)), 'jobs/s')
                        process.exit(0);
                    }
                });

        }, 2*Math.random())

    }

    if(sent < toSend){
        setTimeout(sendWorkloadJobs, 2*Math.random());
    }
}

hive.on('ready', function(){

    sendWorkloadJobs();

    setInterval(function(){
        console.log('Sent=', sent, ', rcvd=', rcvd)
    }, 3000)

})


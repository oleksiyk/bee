
setFailed = function(jid, message)

    local key_jobs = 'bee:h:jobs:' .. jid

    hivelog({
        event = 'setFailed',
        jid   = jid,
        message = message
    })

    -- get job options
    local queue, options = unpack(redis.call('hmget', key_jobs, 'queue', 'options'))
    local key_expires = 'bee:ss:expires:' .. queue

    options = cjson.decode(options)

    message = message or 'No reason given'

    -- set job status to 'failed'
    redis.call('hmset', key_jobs,
        'failedReason', message,
        'status', 'failed')

    addToHistory(jid, 'failed', {
        message = message
    })

    -- add job to expires queue
    redis.call('zadd', key_expires, NOW + options.ttl, jid)

    -- send failed event
    redis.call('publish', 'bee:ch:q:' .. queue, cjson.encode({
        jid = jid,
        type = 'failed',
        job = getJob(jid)
    }))

    -- Send out a log message
    hivelog({
        jid = jid,
        event = 'failed',
        queue = queue
    })

    notifyDependants(jid)

end


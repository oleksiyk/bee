
setFailed = function(key_jobs, key_expires, message)

    -- get job options
    local jid, queue, options = unpack(redis.call('hmget', key_jobs, 'jid', 'queue', 'options'))

    options = cjson.decode(options)

    message = message or 'No reason given'

    -- set job status to 'failed'
    redis.call('hmset', key_jobs,
        'failed_reason', message,
        'status', 'failed')

    addToHistory(key_jobs, 'failed', {
        message = message
    })

    -- add job to expires queue
    redis.call('zadd', key_expires, NOW + options.ttl, jid)

    -- send failed event
    redis.call('publish', 'bee:ch:q:' .. queue, cjson.encode({
        jid = jid,
        type = 'failed',
        job = getJob(key_jobs)
    }))

    -- Send out a log message
    hivelog({
        jid = jid,
        event = 'failed',
        queue = queue
    })

    notifyDependants(jid)

end


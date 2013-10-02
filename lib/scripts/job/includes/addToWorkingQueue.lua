--- Adds job to working queue with a score calculated based on given priority
-- @param jid JID
addToWorkingQueue = function (jid)

    local queue, options = unpack(redis.call('hmget', 'bee:h:jobs:' .. jid, 'queue', 'options'))

    options = cjson.decode(options)
    local key_queue = 'bee:ss:queue:' .. queue

    hivelog({
        event = 'addToWorkingQueue',
        jid   = jid,
        queue = queue
    })

    -- Add this job to working queue with given score
    redis.call('zadd', key_queue, calculateScore(key_queue, options.priority), jid)

    -- Set status to queued
    redis.call('hset', 'bee:h:jobs:' .. jid, 'status', 'queued')

    addToHistory(jid, 'queued')

    -- Publish put event
    redis.call('publish', 'bee:ch:q:' .. queue, cjson.encode({
        jid = jid,
        type = 'new'
    }))
end

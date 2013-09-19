-- include 'job/includes/calculateScore.lua'

--- Adds job to working queue with a score calculated based on given priority
-- @param jid JID
-- @param queue Queue (bee) name
-- @param key_queue Queue (sorted set) key
-- @param priority Job priority
local addToWorkingQueue = function (jid, queue, key_queue, priority)

    -- Add this job to working queue with given score
    redis.call('zadd', key_queue, calculateScore(key_queue, priority), jid)

    -- Set status to queued
    redis.call('hset', 'bee:h:jobs:' .. jid, 'status', 'queued')

    addToHistory('bee:h:jobs:' .. jid, 'queued')

    -- Publish put event
    redis.call('publish', 'bee:ch:q:' .. queue, cjson.encode({
        jid = jid,
        type = 'new'
    }))

    -- Send out a log message
    hivelog({
        jid   = jid,
        event = 'new',
        queue = queue
    })

end

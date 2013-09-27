local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

-- include 'includes/hive.lua'
-- include 'job/includes/addToHistory.lua'
-- include 'job/includes/addToWorkingQueue.lua'
-- include 'job/includes/dependencies.lua'
-- include 'job/includes/getJob.lua'
-- include 'job/includes/setToDie.lua'
-- include 'job/includes/setExpired.lua'

local key_jobs      = assert(KEYS[1])

local jid    = assert(ARGV[3], 'job/cancel: Arg "jid" missing')

local cancelJob

cancelJob = function(jid)

    local status, queue, jid, worker = unpack(redis.call('hmget', 'bee:h:jobs:' .. jid, 'status', 'queue', 'jid', 'worker'))

    -- redis.log(redis.LOG_NOTICE, 'canceling', queue, status, jid)

    if jid then

        if status == 'running' then -- the job is running on a worker

            -- Remove the lock
            redis.call('zrem', 'bee:ss:locks:' ..  queue, jid)

            -- Remove job from set of jobs running on worker
            redis.call('srem', 'bee:s:locks:' .. worker, jid)

        else -- remove the job from possible sets

            redis.call('zrem', 'bee:ss:delayed:' .. queue, jid)
            redis.call('zrem', 'bee:ss:queue:' .. queue, jid)

        end

        addToHistory('bee:h:jobs:' .. jid, 'canceled')

        setExpired(jid, 'canceled')

        -- cancel all child jobs
        for ind, cjid in ipairs(redis.call('smembers', 'bee:s:' .. jid .. ':children')) do
            cancelJob(cjid)
        end

        -- send canceled event
        redis.call('publish', 'bee:ch:q:' .. queue, cjson.encode({
            jid = jid,
            type = 'canceled',
            job = getJob('bee:h:jobs:' .. jid)
        }))

        -- Send out a log message
        hivelog({
            jid = jid,
            event = 'canceled',
            queue = queue
        })

        notifyDependants(jid)

        return true

    else
        return false
    end

end

return cancelJob(jid)
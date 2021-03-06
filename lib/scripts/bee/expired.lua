local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

local args = assert(cjson.decode(ARGV[3]), 'Script arguments are missing or not JSON: ' .. tostring(ARGV[3]))

-- include 'includes/hive.lua'
-- include 'job/includes/index.lua'

local key_queue     = 'bee:ss:queue:' .. args.queue
local key_locks     = 'bee:ss:locks:' .. args.queue

-- process any expired jobs
for ind, jid  in ipairs(redis.call('zrangebyscore', 'bee:ss:expires:' .. args.queue, 0, NOW)) do

    hivelog({
        event = 'Expired Job',
        jid   = jid,
        queue = args.queue
    })

    -- TODO: we should check the children for completion here (before expiring)

    setExpired(jid, 'expired')

end

-- check for any expired job locks (bee workers that died)
for index, jid in ipairs(redis.call('zrangebyscore', key_locks, 0, NOW)) do

    local old_worker = redis.call('hget', 'bee:h:jobs:' .. jid, 'worker')

    local attempt = tonumber(redis.call('incr', 'bee:str:lock-waits:' .. old_worker .. ':' .. jid) or 1)

    -- set (update) expiration time on lock-waits key for 24 hrs
    redis.call('expire', 'bee:str:lock-waits:' .. old_worker .. ':' .. jid, 24 * 3600)

    hivelog({
        event = 'Expired job lock detected',
        attempt = attempt,
        jid   = jid,
        queue = args.queue,
        worker = old_worker
    })

    -- give worker 3 attempts to remind about itself
    if attempt > 3 then

        hivelog({
            event = 'Job lock expired - no more attempts for worker',
            jid   = jid,
            queue = args.queue,
            old_worker = old_worker
        })

        addToHistory(jid, 'expiredLock', {
            old_worker = old_worker
        })

        -- Remove the lock
        redis.call('zrem', key_locks, jid)

        -- Remove job from set of jobs running on old worker
        redis.call('srem', 'bee:s:locks:' .. old_worker, jid)

        -- check number of retries
        if incrementRetries(jid) then -- job failed all its retries

            setFailed(jid, 'no more retries available')

        else  -- put it back to working queue
            addToWorkingQueue(jid)
        end
    else
        -- increment job lock timeout (score)
        -- this will give worker 45 seconds for each of 3 attempts to notify about itself
        -- redis.call('zincrby', key_locks, 30*1000, jid)
        redis.call('zadd', key_locks, (NOW + 45*1000), jid)
    end

end

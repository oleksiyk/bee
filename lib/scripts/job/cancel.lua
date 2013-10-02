local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

local args = assert(cjson.decode(ARGV[3]), 'Script arguments are missing or not JSON: ' .. tostring(ARGV[3]))

-- include 'includes/hive.lua'
-- include 'job/includes/index.lua'

local cancelJob

cancelJob = function(jid)

    local status, queue, jid, worker = unpack(redis.call('hmget', 'bee:h:jobs:' .. jid, 'status', 'queue', 'jid', 'worker'))

    if jid then

        hivelog({
            event = 'Cancel Job',
            jid   = jid,
            queue = queue,
            status = status
        })

        if status == 'running' then -- the job is running on a worker

            -- Remove the lock
            redis.call('zrem', 'bee:ss:locks:' ..  queue, jid)

            -- Remove job from set of jobs running on worker
            redis.call('srem', 'bee:s:locks:' .. worker, jid)

        else -- remove the job from possible sets

            redis.call('zrem', 'bee:ss:delayed:' .. queue, jid)
            redis.call('zrem', 'bee:ss:queue:' .. queue, jid)

        end

        addToHistory(jid, 'canceled')

        setExpired(jid, 'canceled')

        -- cancel all child jobs
        for ind, cjid in ipairs(redis.call('smembers', 'bee:s:' .. jid .. ':children')) do
            cancelJob(cjid)
        end

        -- send canceled event
        redis.call('publish', 'bee:ch:q:' .. queue, cjson.encode({
            jid = jid,
            type = 'canceled',
            job = getJob(jid)
        }))

        notifyDependants(jid)

        return true

    else
        return false
    end

end

return cancelJob(args.jid)
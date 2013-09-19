local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

-- include 'includes/hive.lua'
-- include 'job/includes/addToHistory.lua'
-- include 'job/includes/addToWorkingQueue.lua'
-- include 'job/includes/incrementRetries.lua'
-- include 'job/includes/setFailed.lua'
-- include 'job/includes/setToDie.lua'
-- include 'job/includes/getJob.lua'
-- include 'job/includes/setExpired.lua'

local key_queue     = assert(KEYS[1])
local key_locks     = assert(KEYS[2])
local key_bee_locks = assert(KEYS[3])
local key_expires   = assert(KEYS[4])
local key_bees      = assert(KEYS[5])
local key_delayed   = assert(KEYS[6])

local queue  = assert(ARGV[3], 'job/pop: Key "queue" missing')
local worker = assert(ARGV[4], 'job/pop: Arg "worker" missing')
local max    = assert(tonumber(ARGV[5]) or 5)

local jids = {}
local response = {}

-- process any expired jobs
for ind, jid  in ipairs(redis.call('zrangebyscore', key_expires, 0, NOW)) do
    -- redis.log(redis.LOG_NOTICE, 'got expired job', jid)

    -- TODO: we should check the children for completion here (before expiring)

    setExpired(jid, 'expired')

end


-- walk through all delayed jobs and put them in the working queue
for index, jid in ipairs(redis.call('zrangebyscore', key_delayed, 0, NOW)) do

    local options = cjson.decode(redis.call('hget', 'bee:h:jobs:' .. jid, 'options'))

    redis.call('zrem', key_delayed, jid)

    addToWorkingQueue(jid, queue, key_queue, options.priority)

end


-- check for any expired job locks (bee workers that died)
for index, jid in ipairs(redis.call('zrangebyscore', key_locks, 0, NOW, 'limit', 0, max)) do

    local old_worker = redis.call('hget', 'bee:h:jobs:' .. jid, 'worker')

    -- redis.log(redis.LOG_NOTICE, 'got expired lock', old_worker, jid)

    addToHistory('bee:h:jobs:' .. jid, 'expiredLock', {
        old_worker = old_worker
    })

    -- Remove the lock
    redis.call('zrem', key_locks, jid)

    -- Remove job from set of jobs running on old worker
    redis.call('srem', 'bee:s:locks:' .. old_worker, jid)

    -- check number of retries
    if incrementRetries('bee:h:jobs:' .. jid) then -- job failed all its retries

        jobFailed('bee:h:jobs:' .. jid, key_expires, 'no more retries available')

    else -- retry it NOW

        -- Send out a log message
        hivelog({
            jid   = jid,
            event = 'lock_expired',
            old_worker = old_worker,
            queue = queue
        })

        table.insert(jids, jid)
    end

end

if #jids < max then

    -- update amount of jobs we can return
    max = max - #jids

    -- don't return more than size_of_queue / number_of_workers
    local workers_count = redis.call('zcount', key_bees, (NOW - 30*1000), NOW)
    local queue_size = redis.call('zcard', key_queue);

    if max > (queue_size / workers_count) then
        max = math.ceil(queue_size / workers_count)
        -- redis.log(redis.LOG_NOTICE, 'max=', max)
    end

    for index, jid in ipairs(redis.call('zrangebyscore', key_queue, '-inf', '+inf', 'limit', 0, max )) do
        table.insert(jids, jid)
    end

end

-- return all collected jobs
for index, jid in ipairs(jids) do

    redis.call('hmset', 'bee:h:jobs:' .. jid,
        'worker', worker,
        'status', 'running')

    -- Send out a log message
    hivelog({
        jid   = jid,
        event = 'running',
        worker = worker,
        queue = queue
    })

    addToHistory('bee:h:jobs:' .. jid, 'popped')

    table.insert(response, cjson.encode(getJob('bee:h:jobs:' .. jid)))

    -- add job to sorted set of job locks (score is time to expire - heartbeat is 30 seconds so lets wait 2*30 seconds)
    redis.call('zadd', key_locks, (NOW + 1000*60), jid)

    -- add job to set of jobs running on this bee (worker)
    redis.call('sadd', key_bee_locks, jid)

    -- remove job from working queue
    redis.call('zrem', key_queue, jid)

end

return response
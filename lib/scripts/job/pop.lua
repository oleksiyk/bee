local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

local args = assert(cjson.decode(ARGV[3]), 'Script arguments are missing or not JSON: ' .. tostring(ARGV[3]))

-- include 'includes/hive.lua'
-- include 'job/includes/index.lua'

local key_queue     = 'bee:ss:queue:' .. args.queue
local key_locks     = 'bee:ss:locks:' .. args.queue
local key_delayed   = 'bee:ss:delayed:' .. args.queue

local jids = {}
local response = {}

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


-- walk through all delayed jobs and put them in the working queue
for index, jid in ipairs(redis.call('zrangebyscore', key_delayed, 0, NOW)) do

    redis.call('zrem', key_delayed, jid)

    addToWorkingQueue(jid)

end

-- check for any expired job locks (bee workers that died)
for index, jid in ipairs(redis.call('zrangebyscore', key_locks, 0, NOW, 'limit', 0, args.max)) do

    local old_worker = redis.call('hget', 'bee:h:jobs:' .. jid, 'worker')

    hivelog({
        event = 'Expired Job lock',
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

    else -- retry it NOW
        table.insert(jids, jid)
    end

end


if #jids < args.max then

    -- update amount of jobs we can return
    args.max = args.max - #jids

    -- don't return more than size_of_queue / number_of_workers
    local workers_count = redis.call('zcount', 'bee:ss:bees:' .. args.queue, (NOW - 30*1000), NOW)
    local queue_size = redis.call('zcard', key_queue);

    if args.max > (queue_size / workers_count) then
        args.max = math.ceil(queue_size / workers_count)
        -- redis.log(redis.LOG_NOTICE, 'max=', args.max)
    end

    for index, jid in ipairs(redis.call('zrangebyscore', key_queue, '-inf', '+inf', 'limit', 0, args.max )) do
        table.insert(jids, jid)
    end

end

-- return all collected jobs
for index, jid in ipairs(jids) do

    redis.call('hmset', 'bee:h:jobs:' .. jid,
        'worker', args.worker,
        'status', 'running')

    -- Send out a log message
    hivelog({
        event = 'Popped',
        jid   = jid,
        worker = args.worker,
        queue = args.queue
    })

    addToHistory(jid, 'popped')

    table.insert(response, cjson.encode(getJob(jid)))

    -- add job to sorted set of job locks (score is time to expire - heartbeat is 30 seconds so lets wait 2*30 seconds)
    redis.call('zadd', key_locks, (NOW + 1000*60), jid)

    -- add job to set of jobs running on this bee (worker)
    redis.call('sadd', 'bee:s:locks:' .. args.worker, jid)

    -- remove job from working queue
    redis.call('zrem', key_queue, jid)

end

return response

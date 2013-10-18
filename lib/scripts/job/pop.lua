local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

local args = assert(cjson.decode(ARGV[3]), 'Script arguments are missing or not JSON: ' .. tostring(ARGV[3]))

-- include 'includes/hive.lua'
-- include 'job/includes/index.lua'

local key_queue     = 'bee:ss:queue:' .. args.queue
local key_locks     = 'bee:ss:locks:' .. args.queue
local key_delayed   = 'bee:ss:delayed:' .. args.queue

local response = {}

-- walk through all delayed jobs and put them in the working queue
for index, jid in ipairs(redis.call('zrangebyscore', key_delayed, 0, NOW)) do

    redis.call('zrem', key_delayed, jid)

    addToWorkingQueue(jid)

end

-- don't return more than size_of_queue / number_of_workers
local workers_count = redis.call('zcount', 'bee:ss:bees:' .. args.queue, (NOW - 30*1000), NOW)
local queue_size = redis.call('zcard', key_queue);

if args.max > (queue_size / workers_count) then
    args.max = math.ceil(queue_size / workers_count)
    -- redis.log(redis.LOG_NOTICE, 'max=', args.max)
end

-- return collected jobs
for index, jid in ipairs(redis.call('zrangebyscore', key_queue, '-inf', '+inf', 'limit', 0, args.max )) do

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

    -- add job to sorted set of job locks (score is time to expire - heartbeat is 30 seconds so lets wait 45 seconds)
    redis.call('zadd', key_locks, (NOW + 45*1000), jid)

    -- add job to set of jobs running on this bee (worker)
    redis.call('sadd', 'bee:s:locks:' .. args.worker, jid)

    -- remove job from working queue
    redis.call('zrem', key_queue, jid)

end

return response

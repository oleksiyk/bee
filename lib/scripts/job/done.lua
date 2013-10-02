local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

local args = assert(cjson.decode(ARGV[3]), 'Script arguments are missing or not JSON: ' .. tostring(ARGV[3]))

-- include 'includes/hive.lua'
-- include 'job/includes/index.lua'

local key_jobs      = 'bee:h:jobs:' .. args.jid

hivelog({
    event = 'Job done',
    jid   = args.jid,
    queue = args.queue
})

if 0 == redis.call('exists', key_jobs) then
    error('Job ' .. args.jid .. ' doesn\'t exist. worker: ' .. args.worker)
end

local status, cur_worker = unpack(redis.call('hmget', key_jobs, 'status', 'worker'))

if status == 'canceled' then -- ignore job result as it was canceled
    return args.jid
end

if args.worker ~= cur_worker then
    error('Not your job. Worker: ' .. args.worker .. ', jid: ' .. args.jid)
end


-- Save job results
redis.call('hmset', key_jobs,
    'result', cjson.encode(args.result),
    'options', cjson.encode(args.options),
    'status', 'completed')

addToHistory(args.jid, 'completed')

-- Remove the lock
redis.call('zrem', 'bee:ss:locks:' .. args.queue, args.jid)

-- Remove job from set of jobs running on this worker
redis.call('srem', 'bee:s:locks:' .. args.worker, args.jid)

-- add job to expires queue
redis.call('zadd', 'bee:ss:expires:' .. args.queue, NOW + args.options.ttl, args.jid)

-- send completed event
redis.call('publish', 'bee:ch:q:' .. args.queue, cjson.encode({
    jid = args.jid,
    type = 'completed',
    job = getJob(args.jid)
}))

-- notify all dependant jobs
notifyDependants(args.jid)

return args.jid


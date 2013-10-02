local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

local args = assert(cjson.decode(ARGV[3]), 'Script arguments are missing or not JSON: ' .. tostring(ARGV[3]))

-- include 'includes/hive.lua'
-- include 'job/includes/index.lua'

local key_jobs      = 'bee:h:jobs:' .. args.jid

hivelog({
    event = 'Failed',
    jid   = args.jid,
    queue = args.queue,
    exception = args.exception
})

if 0 == redis.call('exists', key_jobs) then
    error('Job ' .. args.jid .. ' doesn\'t exist. worker: ' .. args.worker)
end

local status, cur_worker = unpack(redis.call('hmget', key_jobs, 'status', 'worker'))

if status == 'canceled' then -- ignore the failure as job was canceled
    return args.jid
end

if args.worker ~= cur_worker then
    error('Not your job. Worker: ' .. args.worker .. ', jid: ' .. args.jid)
end

-- Remove the lock
redis.call('zrem', 'bee:ss:locks:' .. args.queue, args.jid)

-- Remove job from set of jobs running on this worker
redis.call('srem', 'bee:s:locks:' .. args.worker, args.jid)

-- update job options
redis.call('hset', key_jobs, 'options', cjson.encode(args.options))

addToHistory(args.jid, 'exception', {
    message = args.exception.message
})

if not args.exception.retry then

    setFailed(args.jid, args.exception.message)

    return args.jid

end

-- check number of retries
if incrementRetries(args.jid) then -- job has failed all its retries

    -- local options = cjson.decode(redis.call('hget', key_jobs, 'options'))

    if args.options.retries == 0 then
        setFailed(args.jid, args.exception.message)
    else
        setFailed(args.jid, 'No more retries available')
    end


else -- retry it after delay

    local score = NOW + args.exception.retryDelay

    if args.exception.progressiveDelay then
        local retries = redis.call('hget', key_jobs, 'retries')
        score = NOW + (retries * args.exception.retryDelay)
    end

    -- add job to delayed queue
    redis.call('zadd', 'bee:ss:delayed:' .. args.queue, score, args.jid)

    addToHistory(args.jid, 'delayed', {
        till = score
    })

end

return args.jid


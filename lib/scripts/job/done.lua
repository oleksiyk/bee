local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

-- include 'includes/hive.lua'
-- include 'job/includes/addToHistory.lua'
-- include 'job/includes/addToWorkingQueue.lua'
-- include 'job/includes/dependencies.lua'
-- include 'job/includes/getJob.lua'

local key_jobs      = assert(KEYS[1])
local key_locks     = assert(KEYS[2])
local key_expires   = assert(KEYS[3])
local key_bee_locks = assert(KEYS[4])

local queue  = assert(ARGV[3], 'job/done: Arg "queue" missing')
local jid    = assert(ARGV[4], 'job/done: Arg "jid" missing')
local result = assert(ARGV[5], 'job/done: Arg "result" missing')
local worker = assert(ARGV[6], 'job/done: Arg "worker" missing')
local options = assert(cjson.decode(ARGV[7]), 'job/done: Arg "options" missing or not JSON: ' .. tostring(ARGV[7]))

if 0 == redis.call('exists', key_jobs) then
    error('Job ' .. jid .. ' doesn\'t exist. worker: ' .. worker)
end

local status, cur_worker = unpack(redis.call('hmget', key_jobs, 'status', 'worker'))

if status == 'canceled' then -- ignore job result as it was canceled
    return jid
end

if worker ~= cur_worker then
    error('Not your job. Worker: ' .. worker .. ', jid: ' ..jid)
end


-- Save job results
redis.call('hmset', key_jobs,
    'result', result,
    'options', cjson.encode(options),
    'status', 'completed')

addToHistory(key_jobs, 'completed')

-- Remove the lock
redis.call('zrem', key_locks, jid)

-- Remove job from set of jobs running on this worker
redis.call('srem', key_bee_locks, jid)

-- add job to expires queue
redis.call('zadd', key_expires, NOW + options['ttl'], jid)

-- send completed event
redis.call('publish', 'bee:ch:q:' .. queue, cjson.encode({
    jid = jid,
    type = 'completed',
    job = getJob(key_jobs)
}))

-- Send out a log message
hivelog({
    jid   = jid,
    event = 'completed',
    queue = queue
})

-- notify all dependant jobs
notifyDependants(jid)

return jid


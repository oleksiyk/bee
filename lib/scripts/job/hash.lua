local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

-- include 'includes/hive.lua'
-- include 'job/includes/addToHistory.lua'
-- include 'job/includes/getJob.lua'

local key_jobs      = assert(KEYS[1])
local key_locks     = assert(KEYS[2])
local key_hash      = assert(KEYS[3])
local key_bee_locks = assert(KEYS[4])


local queue = assert(ARGV[3], 'job/hash: Arg "queue" missing')
local jid   = assert(ARGV[4], 'job/hash: Arg "jid" missing')
local hash  = assert(ARGV[5], 'job/hash: Arg "hash" missing')
local worker = assert(ARGV[6], 'job/hash: Arg "worker" missing')

if 0 == redis.call('exists', key_jobs) then
    error('Job ' .. jid .. ' doesn\'t exist. worker: ' .. worker)
end

if worker ~= redis.call('hget', key_jobs, 'worker') then
    error('Not your job. Worker: ' .. worker .. ', jid: ' ..jid)
end

-- Save job hash
redis.call('hset', key_jobs, 'hash', hash)

-- check if this job has duplicates
local duplicate_jid = redis.call('lindex', key_hash, 0) or false
local duplicate_status = false

-- push the job to duplicates list (create if doesn't exist)
redis.call('rpush', key_hash, jid)

if duplicate_jid then

    -- Remove the lock
    redis.call('zrem', key_locks, jid)

    -- Remove from set of jobs running on this worker
    redis.call('srem', key_bee_locks, jid)

    -- update job to point at original duplicate
    redis.call('hmset', key_jobs,
        'duplicate', duplicate_jid,
        'status', 'duplicate')

    -- duplicate_status = redis.call('hget', 'bee:h:jobs:' .. duplicate_jid, 'status')

    addToHistory(key_jobs, 'duplicate', {
        worker = worker,
        duplicate_jid = duplicate_jid
    })

    -- send duplicate notification
    redis.call('publish', 'bee:ch:q:' .. queue, cjson.encode({
        jid = jid,
        type = 'duplicate',
        job = getJob(key_jobs)
    }))

    -- Send out a log message
    hivelog({
        jid   = jid,
        event = 'duplicate',
        duplicate_jid = duplicate_jid,
        queue = queue
    })

end

return cjson.encode(duplicate_jid)


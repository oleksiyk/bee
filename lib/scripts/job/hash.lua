local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

local args = assert(cjson.decode(ARGV[3]), 'Script arguments are missing or not JSON: ' .. tostring(ARGV[3]))

-- include 'includes/hive.lua'
-- include 'job/includes/index.lua'

local key_jobs      = 'bee:h:jobs:' .. args.jid
local key_hash      = 'bee:l:hashes:' .. args.queue .. ':' .. args.hash

hivelog({
    event = 'Hash update',
    jid   = args.jid,
    queue = args.queue
})

if 0 == redis.call('exists', key_jobs) then
    error('Job ' .. args.jid .. ' doesn\'t exist. worker: ' .. args.worker)
end

if args.worker ~= redis.call('hget', key_jobs, 'worker') then
    error('Not your job. Worker: ' .. args.worker .. ', jid: ' .. args.jid)
end

-- Save job hash
redis.call('hset', key_jobs, 'hash', args.hash)

-- check if this job has duplicates
local duplicateJid = redis.call('lindex', key_hash, 0) or false

-- push the job to duplicates list (create if doesn't exist)
redis.call('rpush', key_hash, args.jid)

if duplicateJid then

    -- Remove the lock
    redis.call('zrem', 'bee:ss:locks:' .. args.queue, args.jid)

    -- Remove from set of jobs running on this worker
    redis.call('srem', 'bee:s:locks:' .. args.worker, args.jid)

    -- update job to point at original duplicate
    redis.call('hmset', key_jobs,
        'duplicate', duplicateJid,
        'status', 'duplicate')

    -- duplicate_status = redis.call('hget', 'bee:h:jobs:' .. duplicateJid, 'status')

    addToHistory(args.jid, 'duplicate', {
        worker = args.worker,
        duplicateJid = duplicateJid
    })

    -- send duplicate notification
    redis.call('publish', 'bee:ch:q:' .. args.queue, cjson.encode({
        jid = args.jid,
        type = 'duplicate',
        job = getJob(args.jid)
    }))

    -- Send out a log message
    hivelog({
        jid   = args.jid,
        event = 'Job is duplicate',
        duplicateJid = duplicateJid,
        queue = args.queue
    })

end

return cjson.encode(duplicateJid)


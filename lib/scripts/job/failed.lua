local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

-- include 'includes/hive.lua'
-- include 'job/includes/addToHistory.lua'
-- include 'job/includes/incrementRetries.lua'
-- include 'job/includes/addToWorkingQueue.lua'
-- include 'job/includes/dependencies.lua'
-- include 'job/includes/getJob.lua'
-- include 'job/includes/setFailed.lua'

local key_jobs      = assert(KEYS[1])
local key_locks     = assert(KEYS[2])
local key_expires   = assert(KEYS[3])
local key_bee_locks = assert(KEYS[4])
local key_delayed   = assert(KEYS[5])

local jid    = assert(ARGV[3], 'job/failed: Arg "jid" missing')
local error  = assert(cjson.decode(ARGV[4]), 'job/failed: Arg "error" missing or not JSON: ' .. tostring(ARGV[4]))
local worker = assert(ARGV[5], 'job/failed: Arg "worker" missing')
local options = assert(cjson.decode(ARGV[6]), 'job/failed: Arg "options" missing or not JSON: ' .. tostring(ARGV[6]))

if 0 == redis.call('exists', key_jobs) then
    error('Job ' .. jid .. ' doesn\'t exist. worker: ' .. worker)
end

local status, cur_worker = unpack(redis.call('hmget', key_jobs, 'status', 'worker'))

if status == 'canceled' then -- ignore the failure as job was canceled
    return jid
end

if worker ~= cur_worker then
    error('Not your job. Worker: ' .. worker .. ', jid: ' ..jid)
end

-- Remove the lock
redis.call('zrem', key_locks, jid)

-- Remove job from set of jobs running on this worker
redis.call('srem', key_bee_locks, jid)

-- update job options
redis.call('hset', key_jobs, 'options', cjson.encode(options))

addToHistory(key_jobs, 'exception', {
    message = error.message
})

if not error['retry'] then

    setFailed(key_jobs, key_expires, error.message)

    return jid

end

-- check number of retries
if incrementRetries(key_jobs) then -- job has failed all its retries

    local options = cjson.decode(redis.call('hget', key_jobs, 'options'))

    if options.retries == 0 then
        setFailed(key_jobs, key_expires, error.message)
    else
        setFailed(key_jobs, key_expires, 'No more retries available')
    end


else -- retry it after delay

    local score = NOW + error.retryDelay

    if error.progressiveDelay then
        local retries = redis.call('hget', key_jobs, 'retries')
        score = NOW + (retries * error.retryDelay)
    end

    -- add job to delayed queue
    redis.call('zadd', key_delayed, score, jid)

    addToHistory(key_jobs, 'delayed', {
        till = score
    })

end

return jid


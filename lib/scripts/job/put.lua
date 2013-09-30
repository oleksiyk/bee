local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

-- include 'includes/hive.lua'
-- include 'job/includes/index.lua'

local key_queue = assert(KEYS[1])
local key_jobs  = assert(KEYS[2])
local key_delayed  = assert(KEYS[3])
local key_parent = KEYS[4]
local key_parent_children = KEYS[5]

local queue   = assert(ARGV[3], 'job/put: Arg "queue" missing')
local jid     = assert(ARGV[4], 'job/put: Arg "jid" missing')
local parent  = ARGV[5]
local data    = assert(ARGV[6], 'job/put: Arg "data" missing')
local options = assert(cjson.decode(ARGV[7]), 'job/put: Arg "options" missing or not JSON: ' .. tostring(ARGV[7]))
local tags    = assert(cjson.decode(ARGV[8]), 'job/put: Arg "tags" missing or not JSON: ' .. tostring(ARGV[8]))

local delay = assert(tonumber(options.delay) or 0)
local dependencies = options.dependencies or {}

if #dependencies then
    for i, depJid in ipairs(dependencies) do
        addDependantJob(depJid, jid)
    end
end


if parent ~= 'null' then
    -- redis.log(redis.LOG_NOTICE, 'adding to parents list of children', parent, jid, key_parent_children)

    if 'canceled' == redis.call('hget', key_parent, 'status') then -- parent job is canceled, don't allow new child jobs
        return false
    end

    redis.call('hset', key_jobs, 'parent', parent)
    redis.call('sadd', key_parent_children, jid)

end

-- Save job data
redis.call('hmset', key_jobs,
    'jid', jid,
    'data', data,
    'options', cjson.encode(options),
    'worker', '',
    'queue', queue,
    'status', 'new',
    'submitted', NOW,
    'retries', 0)

-- set job tags if any
if #tags then
    setTags(jid, tags)
end


addToHistory(key_jobs, 'submitted')

if hasDependencies(jid) == 0 then

    if delay > 0 then

        -- add job to delayed queue
        redis.call('zadd', key_delayed, NOW + delay, jid)

        addToHistory(key_jobs, 'delayed', {
            till = NOW + delay
        })

    else

        -- add job to working queue
        addToWorkingQueue(jid, queue, key_queue, options.priority)

    end

else

    addToHistory(key_jobs, 'dependancy_waiting')

end

return jid


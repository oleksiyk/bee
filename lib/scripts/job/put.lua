local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

local job = assert(cjson.decode(ARGV[3]), 'Script arguments are missing or not JSON: ' .. tostring(ARGV[3]))

-- include 'includes/hive.lua'
-- include 'job/includes/index.lua'

hivelog({
    event = 'New Job (put)',
    jid   = job.jid,
    queue = job.queue
})

if 0 ~= redis.call('exists', 'bee:h:jobs:' .. job.jid) then
    error('Job ' .. job.jid .. ' already exists')
end

if #job.options.dependencies then
    for i, depJid in ipairs(job.options.dependencies) do
        addDependantJob(depJid, job.jid)
    end
end


if job.parent then

    hivelog({
        event = 'Adding Job to its parent',
        parent = job.parent,
        jid   = job.jid,
        queue = job.queue
    })

    local key_parent = 'bee:h:jobs:' .. job.parent
    local key_parent_children = 'bee:s:' .. job.parent .. ':children'

    if 'canceled' == redis.call('hget', 'bee:h:jobs:' .. job.parent, 'status') then -- parent job is canceled, don't allow new child jobs
        return false
    end

    redis.call('hset', 'bee:h:jobs:' .. job.jid, 'parent', job.parent)
    redis.call('sadd', 'bee:s:' .. job.parent .. ':children', job.jid)

end

-- Save job data
redis.call('hmset', 'bee:h:jobs:' .. job.jid,
    'jid', job.jid,
    'data', cjson.encode(job.data),
    'options', cjson.encode(job.options),
    'worker', '',
    'queue', job.queue,
    'status', 'new',
    'submitted', NOW,
    'retries', 0)

-- set job tags if any
if #job.tags then
    setTags(job.jid, job.tags)
end


addToHistory(job.jid, 'submitted')

if hasDependencies(job.jid) == 0 then

    if job.options.delay > 0 then

        -- add job to delayed queue
        redis.call('zadd', 'bee:ss:delayed:' .. job.queue, NOW + job.options.delay, job.jid)

        addToHistory(job.jid, 'delayed', {
            till = NOW + job.options.delay
        })

    else

        -- add job to working queue
        addToWorkingQueue(job.jid)

    end

else

    addToHistory(job.jid, 'dependancyWaiting')

end

return job.jid


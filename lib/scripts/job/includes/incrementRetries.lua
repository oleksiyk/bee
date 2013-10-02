--- Check and update retries count for given job
-- @param jid Job JID
-- @returns boolean Whether Job has completely failed
incrementRetries = function(jid)

    hivelog({
        message = 'incrementRetries',
        jid   = jid
    })

    local key_jobs = 'bee:h:jobs:' .. jid

    -- get job options
    local options, retries = unpack(redis.call('hmget', key_jobs, 'options', 'retries'))

    options = cjson.decode(options)

    retries = tonumber(retries or 0)

    -- check number of retries
    if retries >= options.retries then
        return true
    end

    -- Save job status and retries
    redis.call('hmset', key_jobs,
        'retries', retries + 1,
        'status', 'retried')

    return false

end

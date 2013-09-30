--- Check and update retries count for given job
-- @param key_jobs Job hash key
-- @returns boolean Whether Job has completely failed
incrementRetries = function(key_jobs)

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

--- add dependant job
-- @param {string} jid Job (parent) JID
-- @param {string} dependant_jid Dependant job JID
addDependantJob = function(jid, dependant_jid)

    local key_jobs = 'bee:h:jobs:' .. jid

    local parent_status = redis.call('hget', key_jobs, 'status')

    if parent_status == false
            or parent_status == 'completed'
            or parent_status == 'failed'
            or parent_status == 'canceled'
            or parent_status == 'duplicate'
            or parent_status == 'expired' then

        -- redis.log(redis.LOG_NOTICE, 'skiping this job because its status is:', parent_status)

    else

        local dependants = cjson.decode(redis.call('hget', key_jobs, 'dependants') or '{}')

        table.insert(dependants, dependant_jid)

        redis.call('hset', key_jobs, 'dependants', cjson.encode(dependants))

        redis.call('sadd', 'bee:s:dependencies:' .. dependant_jid, jid)
    end

end

-- return amount of dependencies for this JID
hasDependencies = function(jid)
    return redis.call('scard', 'bee:s:dependencies:' .. jid)
end


-- notify all dependant job that this JID is done (or failed, canceled)
notifyDependants = function(jid)

    local key_jobs = 'bee:h:jobs:' .. jid

    -- list of dependants
    local dependants = cjson.decode(redis.call('hget', key_jobs, 'dependants') or '{}')

    for i, dependant_jid in ipairs(dependants) do
        redis.call('srem', 'bee:s:dependencies:' .. dependant_jid, jid)

        -- try to start dependant job if it has no more dependencies
        if 0 == hasDependencies(dependant_jid) then

            local dependant_status, dependant_queue, dependant_options = unpack(redis.call('hmget', 'bee:h:jobs:' .. dependant_jid, 'status', 'queue', 'options'))

            dependant_options = cjson.decode(dependant_options or '{}')

            -- only if it wasn't canceled
            if dependant_status == 'new' then

                if dependant_options.delay > 0 then

                    -- add job to delayed queue
                    redis.call('zadd', 'bee:ss:delayed:' .. dependant_queue, NOW + dependant_options.delay, dependant_jid)

                    addToHistory(dependant_jid, 'delayed', {
                        till = NOW + dependant_options.delay
                    })

                else
                    -- add job to working queue
                    addToWorkingQueue(dependant_jid, dependant_queue, 'bee:ss:queue:' .. dependant_queue, dependant_options.priority)
                end

            end

        end

    end

end

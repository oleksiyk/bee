
setExpired = function(jid, status)

    local options, hash, queue = unpack(redis.call('hmget', 'bee:h:jobs:' .. jid, 'options', 'hash', 'queue'))
    options = cjson.decode(options)

    -- set job status
    redis.call('hset', 'bee:h:jobs:' .. jid, 'status', status)

    -- remove it from expires queue
    redis.call('zrem', 'bee:ss:expires:' .. queue, jid)

    -- cleanup the duplicates
    if hash and type(hash) == 'string' then
        local key_hash = 'bee:l:hashes:' .. queue .. ':' .. hash;

        -- set all jobs in hash list to die (expire in redis) after options['ttl']
        for hind, hjid  in ipairs(redis.call('lrange', key_hash, 0, -1)) do
            setToDie('bee:h:jobs:' .. hjid, hjid, options.ttl)
        end

        -- remove hash list
        redis.call('del', key_hash)
    else
        setToDie('bee:h:jobs:' .. jid, jid, options.ttl)
    end
end
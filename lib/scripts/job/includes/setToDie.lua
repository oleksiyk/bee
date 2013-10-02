--- Set expiration time on job
-- @param jid JID
-- @param ttl TTL
setToDie = function(jid, ttl)

    hivelog({
        event = 'setToDie',
        jid   = jid,
        ttl = ttl
    })

    local key_jobs = 'bee:h:jobs:' .. jid

    local tags, parent, queue = unpack(redis.call('hmget', key_jobs, 'tags', 'parent', 'queue'))

    tags = cjson.decode(tags or '{}')

    redis.call('pexpire', key_jobs, ttl)

    -- remove it from expires queue
    redis.call('zrem', 'bee:ss:expires:' .. queue, jid)

    -- remove the job from tag sets
    if #tags then
        for i, tag in ipairs(tags) do
            redis.call('srem', 'bee:s:tags:' .. tag, jid)
        end
    end

    -- remove it from parent's children list
    if parent then
        redis.call('srem', 'bee:s:' .. parent .. ':children', jid)
    end

end

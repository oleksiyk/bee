--- Set expiration time on job
-- and remove it from tag sets
-- @param key_jobs Job hash key
-- @param jid JID
-- @param ttl TTL
setToDie = function(key_jobs, jid, ttl)

    local tags, parent = unpack(redis.call('hmget', key_jobs, 'tags', 'parent'))

    tags = cjson.decode(tags or '{}')

    redis.call('pexpire', key_jobs, ttl)

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


setTags = function(jid, tags)

    -- store the tags list in job hash
    redis.call('hset', 'bee:h:jobs:' .. jid,
        'tags', cjson.encode(tags))

    -- add this job to tag sets
    for i, tag in ipairs(tags) do
        redis.call('sadd', 'bee:s:tags:' .. tag, jid)
    end

end
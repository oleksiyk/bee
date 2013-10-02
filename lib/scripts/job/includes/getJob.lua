getJob = function(jid)
    local duplicate_job = false

    local jid, parent, data, queue, worker, hash, status, options, submitted, retries, tags, result, duplicate, failed_reason, history, dependants = unpack(redis.call('hmget', 'bee:h:jobs:' .. jid,
        'jid', 'parent', 'data', 'queue', 'worker', 'hash', 'status', 'options', 'submitted', 'retries', 'tags', 'result', 'duplicate', 'failed_reason', 'history', 'dependants'))

    if not jid then
        return false
    end

    if duplicate then
        duplicate_job = redis.call('hmget', 'bee:h:jobs:' .. duplicate, 'status', 'result', 'failed_reason')

        duplicate_job = {
            jid = duplicate,
            status = duplicate_job[1],
            result = cjson.decode(duplicate_job[2] or '{}'),
            failed_reason = duplicate_job[3]
        }
    end

    return {
        jid     = jid,
        parent  = parent,
        data    = cjson.decode(data),
        queue   = queue,
        worker  = worker or '',
        hash    = hash,
        status  = status,
        options = cjson.decode(options),
        submitted  = tonumber(submitted),
        retries = tonumber(retries),
        tags = cjson.decode(tags or '{}'),
        result = cjson.decode(result or '{}'),
        failed_reason = failed_reason,
        duplicate = duplicate_job,
        history = cjson.decode(history or '{}'),
        dependants = cjson.decode(dependants or '{}')
    }

end


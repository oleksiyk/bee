--- Calcluate (sorted set) score value for the job based on its priority
-- @param key_queue Working queue (sorted set) key
-- @param priority Job priority
local calculateScore = function (key_queue, priority)

    priority = tonumber(priority or 0)

    if priority > 10 then
        priority = 10
    end

    -- find out the score of the first job in this queue
    local score_1 = redis.call('zrangebyscore', key_queue , '-inf', '+inf', 'withscores', 'limit', 0, 1)[2] or NOW

    -- calculate priority step
    local step = (NOW - score_1) / 10

    -- redis.log(redis.LOG_NOTICE, queue, jid, step)

    -- calculate and return required score
    return NOW - (step * priority)

end


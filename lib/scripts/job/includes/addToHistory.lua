--- add item to job's history
-- @param {string} jid Job JID
-- @param {string} event event (operation) name
-- @param {table} [data] event data
addToHistory = function(jid, event, data)

    local key_jobs = 'bee:h:jobs:' .. jid

    local history = cjson.decode(redis.call('hget', key_jobs, 'history') or '{}')

    data = data or {}

    data.timestamp = NOW;
    data.hive = HIVE;
    data.event = event;

    table.insert(history, data)

    redis.call('hset', key_jobs, 'history', cjson.encode(history))

end

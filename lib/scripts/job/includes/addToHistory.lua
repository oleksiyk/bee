--- add item to job's history
-- @param {string} key_jobs Job hash key
-- @param {string} event event (operation) name
-- @param {table} [data] event data
local addToHistory = function(key_jobs, event, data)

    local history = cjson.decode(redis.call('hget', key_jobs, 'history') or '{}')

    data = data or {}

    data.timestamp = NOW;
    data.hive = HIVE;
    data.event = event;

    table.insert(history, data)

    redis.call('hset', key_jobs, 'history', cjson.encode(history))

end

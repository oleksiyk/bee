local HIVEOPTIONS = cjson.decode(redis.call('get', 'bee:str:hive:options'))


--- Send (publish) debug log message
-- @param message Message to send (Lua table, will be JSON encoded)
local hivelog = function(message)

    if HIVEOPTIONS['log'] == false then
        return
    end

    redis.call('publish', 'bee:ch:log', cjson.encode(message))

end
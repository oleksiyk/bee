local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

local args = assert(cjson.decode(ARGV[3]), 'Script arguments are missing or not JSON: ' .. tostring(ARGV[3]))

-- include 'includes/hive.lua'

local key_locks     = 'bee:ss:locks:' .. args.queue
local key_bees      = 'bee:ss:bees:' .. args.queue

hivelog({
    event = 'heartbeat',
    queue = args.queue,
    worker = args.worker
})

-- remove old bees (last heartbeat > 1hr ago)
redis.call('zremrangebyscore', key_bees, '-inf', (NOW - 3600*1000))

-- add this bee to the list of known bees (with a score)
redis.call('zadd', key_bees, NOW, args.worker)

-- update score (expiration time) for all jobs for this bee
for ind, jid in ipairs(redis.call('smembers', 'bee:s:locks:' .. args.worker)) do
    -- redis.call('zincrby', key_locks, 30*1000, jid)
    redis.call('zadd', key_locks, (NOW + 45*1000), jid)

    -- remove lock-wait key (used to detect dead workers)
    redis.call('del', 'bee:str:lock-waits:' .. args.worker .. ':' .. jid)
end







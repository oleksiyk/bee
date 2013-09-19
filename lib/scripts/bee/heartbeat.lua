local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

-- include 'includes/hive.lua'

local key_locks     = assert(KEYS[1])
local key_bee_locks = assert(KEYS[2])
local key_bees      = assert(KEYS[3])

local beeId = assert(ARGV[3], 'bee/heartbeat: Arg "beeId" missing')

-- add this bee to the list of known bees (with a score)
redis.call('zadd', key_bees, NOW, beeId)

-- remove old bees (last heartbeat > 1hr ago)
redis.call('zremrangebyscore', key_bees, '-inf', (NOW - 3600*1000))

-- update score (expiration time) for all jobs for this bee
for ind, jid in ipairs(redis.call('smembers', key_bee_locks)) do

    redis.call('zincrby', key_locks, 30*1000, jid)

end







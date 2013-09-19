local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

-- include 'includes/hive.lua'
-- include 'job/includes/setTags.lua'

local key_jobs      = assert(KEYS[1])

local jid = assert(ARGV[3], 'job/tag: Arg "jid" missing')
local tags = assert(cjson.decode(ARGV[4]), 'job/tag: Arg "tags" missing or not JSON: ' .. tostring(ARGV[4]))

setTags(jid, tags)

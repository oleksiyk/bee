local HIVE = ARGV[1]
local NOW = tonumber(ARGV[2])

-- include 'includes/hive.lua'
-- include 'job/includes/getJob.lua'

local key_jobs = assert(KEYS[1])

local job = getJob(key_jobs)

if not job then
    return false
end

return cjson.encode(job)




# Redis key naming convention used in Bee

### Bee (worker) IDs
`HOSTNAME:PID:UNIQUE_HIVE_ID:QUEUE_NAME:UNIQUE_ID`
Example: `Oleksiys-MacBook-Pro.local:87362:b355de80-54e5-11e3-9023-57b39a72bd38:Items.applyProfile.static:b671c480-54e5-11e3-9023-57b39a72bd38`

### Delimeter
`:` is used as field delimeter

### Prefix
Prefixes correspond to [Redis types](http://redis.io/topics/data-types) in the following manner:

- `bee:s` - Set
- `bee:ss` - Sorted Set
- `bee:str` - String
- `bee:h` - Hash
- `bee:l` - List

and

- `bee:ch` - PubSub channel

### Queues

**Working queue**<br/>
Name: `bee:ss:queue:QUEUE_NAME` <br/>
Score: Priority, timestamp based.<br/>
Value: JID

**Delayed queue**<br/>
Name: `bee:ss:delayed:QUEUE_NAME` <br/>
Score: Time to put into working queue (timestamp)

**Expired jobs queue (completed or failed jobs)**<br/>
Name: `bee:ss:expires:QUEUE_NAME`<br/>
Score: Time for job to expire (timestamp)<br/>
Value: JID

### Jobs
**Job**<br/>
Name: `bee:h:jobs:JID`<br/>
Fields:
- `jid`
- `queue`
- `data` - Job data. JSON encoded
- `options` - Job options. JSON encoded
- `worker`
- `status` - ['new', 'queued', 'running', 'completed', 'duplicate', 'canceled', 'failed', 'expired', 'retried']
- `retries` - number of times this job has been retried after failure
- `result` - Job result. JSON encoded
- `parent` - Parent job JID (when using `job.sub()`)
- `hash` - Job duplicates hash
- `tags` - Job tags
- `history` - Job history. JSON encoded
- `dependants` - List of job dependants. JSON encoded

**List of duplicates**<br/>
Name: `bee:l:hashes:QUEUE_NAME:HASH`<br/>
Value: JID

**List (Set) of jobs per tag**<br/>
Name: `bee:s:tags:TAG`<br/>
Value: JID

**List (Set) of dependencies for this JID (jobs that this JID will wait for completion/failure before going into the queue)**<br/>
Name: `bee:s:dependencies:JID`<br/>
Value: JID

### Bees (workers)
Name: `bee:ss:bees:QUEUE_NAME`<br/>
Score: Last heartbeat timestamp<br/>
Value: WORKER_ID

### Job locks
**List of jobs running on worker**<br/>
Name: `bee:s:locks:WORKER_ID`<br/>
Value: JID

**Used to detect dead workers**<br/>
Name: `bee:ss:locks:QUEUE_NAME`<br/>
Score: Lock expiration timestamp (in the future)<br/>
Value: JID

**Used to count attempts for possibly dead worker to finally send a heartbeat**<br/>
Name: `bee:str:lock-waits:WORKER_ID:JID`<br/>
Value: Number of attempts



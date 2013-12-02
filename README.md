# Bee
Bee is a job queue for [Node](http://nodejs.org) built on top of  [Redis](http://redis.io) and its powerful Lua scripting possibilities.

Bee doesn't have a central server and separately running workers as many other job servers (but you may have them if you need) instead it allows you to easily split workers and clients between multiple node instances or parts of your application. A single node instance may run a several workers and clients at the same moment. If you need to scale your application - just launch another instance of the same worker(s).

The core part of Bee is Hive. When you need to submit job you first create a hive with

```javascript
var hive = require('bee').createHive()
```

and then submit your job with

```javascript
hive.do('Images.Resize', '/mnt/ftp/image.jpg', 300, 300)
```

On the other side when you need to setup a worker you create a hive the same way as above and then register your worker (bee) with

```javascript
hive.bee('Images.Resize', {
	worker: function(job, imagePath, width, height){
		// - resize the image
	}
})
```

or with a basic form:

```javascript
hive.bee('Images.Resize', function(job, imagePath, width, height){
	// - resize the image
})
```

### Status
Beta

### Features
* [Duplicates detection](#duplicates)
* [Intelligent error processing](#errors)
* [Job progress notifications](#progress)
* [Delayed jobs](#optionslist)
* [Job workflows](#workflows)
* [Job dependencies](#dependencies)
* [Cancel jobs and workflows](#cancel)
* [Job tagging/searching](#tags)
* [Job history](#history)

## Usage

### Create a hive

`.createHive(options)`

The function returns hive instance which you can start using right away:

```javascript
var hive = require('bee').createHive();
var job = hive.do('Image.Resize', …)
```

### Setup Bees (workers)
Bees are created with `hive.bee()` method:

```javascript
/**
*
* @param {String} name
* @param {Object|Function} beeSpec
*/
hive.bee('Image.Resize', {
	worker: function(job, imagePath, width, height) {
	}
})
```

The first parameter passed to worker function is a job handle, all the rest are the parameters passed to `hive.do()` when submitting a job.

Worker function is expected to return a promise (or the value) or throw an exception. See more about error handling below.

The minimal configuration for `beeSpec` object is a `worker` function, but there are other properties you can customise:

* `hash` function:
	```javascript
	hash: null // null, false or function
	```
The hash function is used to detect duplicates and avoid doing the same job many times (you can control how long your completed job stays valid with `job.options.ttl` property). There is a default hash function which computes the SHA1 hash of all job workload parameters (imagePath + width + height in this example).
Hash function is expected to return a promise or the value (or throw an exception).
Set `hash` to `null` to use default hash function, set it to `false` to disable duplicates detection or set it to function (which accepts exactly the same parameters as `worker`) to compute hash yourself.
* `concurrency` - concurrency limit, sets the maximum number of jobs this worker can accept and process at once (asynchronously of course):
	```javascript
	concurrency: false // false or number
	```
Setting concurrency to `false` (default value) will disable the limit, however the Bee will still internally balance it between all workers for this queue (those with the same `name`)
* `timeout` is a maximum time in ms the worker can do the job. This is needed to avoid memory leaks because of unintentionally unfulfilled deferred promises. The default is 1,800,000 (30 minutes). Update this value if your job can take longer time.

Example of customised bee:

```javascript
hive.bee('Image.Resize', {
	hash: function(job, imagePath, width, height){
		return crypto.createHash('sha1').update(imagePath).digest("hex");
	},
	worker: function(job, imagePath, width, height){
		var deferred = Q.defer();
		// resize and then deferred.resolve(..)
		return deferred.promise;
	},
	timeout: 180000 // 3 mins
})
```

<a name="errors"></a>
### Failed jobs (error handling)
Any exception thrown in `worker` or custom `hash` function (or rejected promise of course) will be transformed into failed job.
Failed jobs will be retried later after some delay (default is 30 seconds) with a maximum limit of retries (default is 5). Once all retries have exhausted the job will be marked as permanently failed and corresponding notification will be received by all clients waiting for this job execution.

Each error is written into job.history array as 'exception' event, see [Job history](#history).

You can have a precise control over failed job retries process with job options and/or thrown exception:

1. See the description for `job.options.retries`, `job.options.retryDelay`, `job.options.progressiveDelay` in the [Job options](#optionslist) section below.
2. Exception properties:
You can also control job retries with the properties of thrown exception (or promise rejection value):

	```javascript
	hive.bee('Image.Resize', {
		worker: function(job, imagePath, width, height){
			throw {
				message: 'File is not an image', // error message
				retry: false, // should we retry the job?
				retryDelay: 3000, // overrides job.options.retryDelay
				progressiveDelay: true // overrides job.options.progressiveDelay
			}
		}
	})
	```

<a name="progress"></a>
### Job progress notifications
1. Sending job progress with `job.progress`:

	```javascript
	hive.bee('Image.Resize', {
		worker: function(job, imagePath, width, height){
			...
			job.progress(0);
			...
			job.progress(10);
			...
			job.progress(100);
		}
	})
	```
2. Sending job progress using Q deferred:

	```javascript
	hive.bee('Image.Resize', {
		worker: function(job, imagePath, width, height){
			var deferred = Q.defer;
			...
			deferred.notify(0); deferred.notify(50); ...; deferred.resolve(...);
			...
			return deferred.promise;
		}
	})
	```
3. Modify progress value from child job(s) and send updated progress (progress bubbling)

	```javascript
	// should modify child progress by adding 1 (11, 21, 31...)
        hive.bee('test.progress.3', {
            worker: function (job, a) {

                return hive.do('test.progress.2', a, Math.random()).call('result')
                    .progressed(function (progress) {
                        return progress + 1;
                    })
                    .return(a + a);

            }
        })
	```
4. Receive progress notifications:

	```javascript
	hive.do('test.progress.2', a).call('result')
        	.progressed(function (progress) {
        		process.stdout.write('\rProcessing progress=' + Number(progress).toFixed(2) + '%')
        	})

	```



<a name="options"></a>
### Job options
There are job options you can set on client (with `hive.do()`) or in worker:

1. Setting job options with `hive.do()`:
Just pass an object instead of string as first argument to `hive.do()`:

	```javascript
	hive.do({
		name: 'Image.Resize',
		ttl: 30000, // job TTL will be 30 seconds
		delay: 3000 // delay job execution for 3 seconds
	}, imagePath, width, height)
	```
2. Setting job options in the worker:

	```javascript
	hive.bee('Image.Resize', {
		worker: function(job, imagePath, width, height){
			job.options.retryDelay = 3000;
			job.options.progressiveDelay = true;
		}
	})
	```

<a name="optionslist"></a>
List of job options:

* `job.options.delay=0`
Delays job execution for the specified amount of milliseconds.
* `job.options.retries=5`
Can be set on worker only. Specifies amount of retries for the failed job. If retries=0 the job will be rejected on first error. The job will fail with 'No more retries available' error if all retries have been exhausted.
* `job.options.retryDelay=30000`
Can be set on worker only. Specifies the delay in milliseconds the failed job waits before being tried again. The default value is 30000 (30 seconds).
* `job.options.progressiveDelay=false`
Can be set on worker only. If set to `true` will increase job retryDelay with each subsequent retry. So first retry will come after retryDelay, the second after 2*retryDelay and so on. The default value is false (don't use progressive delay).
* `job.options.ttl=1800000`
Can be set on worker only.
Controls how long (in ms) your completed (or failed) job is considered as valid thus all duplicate jobs sent during this period will return with this job's result (or fail with job's final exception). The default value is 1800000 (30 mins).
Please note that the value you set for TTL is not a high precision exact amount in milliseconds that the job will stay valid. The job will be marked as expired the next time one of the workers comes to check for new jobs to Redis. And this can happen after up to 500ms. One other thing to consider is a requirement to set time synchronisation between all the servers running your workers. This is due to a inability to get current timestamp in Redis Lua scripts, so Redis works with timestamps passed with each request.
* `job.options.preferredHostname=false`
Set the preferred hostname (`require('os').hostname()`) for this job execution. Bee will notify all hives running on that hostname first thus increasing their chances to grab the job before others.

<a name="workflows"></a>
### Job workflows
Stacking up jobs is easy:

* Clients sends a task to resize remote image (by URL):

	```javascript
	hive.do('Image.Resize.Remote', 'http://www.example.org/image.jpg', 300, 300)
	.call('result')
	.then(function(result){
		// use resized local image
	})
	```
* Worker splits the job:

	```javascript
	// this one will resize local image
	hive.bee('Image.Resize', {
		worker: function(job, imagePath, width, height){
			// resize ..
		}
	});

	// this one will download the image
	hive.bee('Image.Download', {
		worker: function(job, url){
			// download ..
			return '/tmp/image.jpg'
		}
	});

	// this one combines all together
	hive.bee('Image.Resize.Remote', {
		worker: function(url, width, height){
			return hive.do('Image.Download', url).call('result')
			.then(function(imagePath){
				return hive.do('Image.Resize', imagePath, width, height);
			})
		}
	});
	```

Instead of `hive.do()` worker functions can use `job.sub()` method which behaves exactly the same as `hive.do()` but sets newly created job as child for current job. This makes it possible to cancel whole job workflows (see [Job cancelling](#cancel))


<a name="dependencies"></a>
### Job dependencies
When submitting job it is possible to provide a list of JIDs on which this new job will depend. The job wont be placed in a working (or delayed) queue untill all listed dependencies are resolved (successfuly or not)

```javascript
hive.do({
	name: 'test.dependencies',
	dependencies: [otherJob1.jid, otherJob2.jid] // wait for these two jobs before starting
}, 'workload').call('result').then...
```

See also [`hive.doTagsDependant`](#hive.doTagsDependant)


<a name="history"></a>
### Job history
Bee saves all job state transitions into `job.history` array property. Each item in this array is an object with at least the following properties:

```javascript
{
	event: 'submitted', // event name
	timestamp: 1376937173174, // event timestamp in ms
	hive: 'Oleksiys-MacBook-Pro.local:42785:c16b0010-08fd-11e3-8a91-ed3255a3c666' // hive.id (hive that originated this event)
}
```

List of event names:

* `submitted`
Written when job is sent.
* `queued`
Written when job enters working queue.
* `delayed`
Written when job is being delayed due to `delay` property (see [Job options](#optionslist)) or when job is waiting to be retried after exception failure. Contains additional `till` property which is a timestamp in ms.
* `exception`
Written when worker throws an exception (or rejects the returned promise). Contains additional property `message` which is error description.
* `failed`
Written when job is permanently failed. Contains additional field `message` same as for `exception` event.
* `popped`
Written when job is accepted by worker.
* `completed`
Written when job is successfully completed.
* `canceled`
Written when job was canceled by request (see [job cancelling](#cancel))
* `expiredLock`
Written when worker lock on job has expired. This means that the worker that was doing this job has died or otherwise not able to connect to Redis server. The job will be retried.
* `dependancyWaiting`
Written when job is put on hold due to not yet resolved dependencies.

<a name="cancel"></a>
### Job cancelling
Cancelling jobs may be useful with delayed jobs but you may also cancel running or completed/failed jobs as well.

* `Delayed job`
Delayed job will be simply set to 'expired' state right away.
* `Running job`
There is no way to stop job processing if it has already started   so job will run until the end (or until it encounters an error) and then its result will be ignored. The job won't be retried if  it results in error. All job handles for this job and its duplicates will be rejected with Error('Canceled').
* `Completed job (successful or failed)`
The job will be set to 'expired' status with all its duplicates.

Cancelling the duplicate job won't affect its original job.

Job can be canceled using `job.cancel()` on a job handle object or using `hive.cancel(jid)`.

**Cancelling job workflows**
When using [workflows](#workflows) it is sometimes necessary to cancel the whole workflow with all jobs started by a 'parent' job. In this case you should use `job.sub()` method in workers instead of `hive.do()` where `job` is the first argument passed to worker function. `job.sub()` actually just wraps `hive.do()` and sets a parent property for the newly submitted job to the JID of current job. This allows Bee to find all jobs started by a single job and cancel them all. It will also prevent canceled parent job from starting new jobs (so `job.sub()` will fail if `job` is canceled, while `hive.do()` will work). The revised workflow example might look as:

```javascript
// this one combines all together
hive.bee('Image.Resize.Remote', {
	worker: function(url, width, height){
		return job.sub('Image.Download', url).call('result')
		.then(function(imagePath){
			return job.sub('Image.Resize', imagePath, width, height);
		})
	}
});
```

<a name="duplicates"></a>
### Duplicates
Bee supports duplicate jobs detection by hash comparison. By default SHA1 hash is computed of all job parameters. You can supply your own hash function:

```javascript
hive.bee('Image.Resize', {
	hash: function(job, imagePath, width, height){
		return crypto.createHash('sha1').update(imagePath).digest("hex")
	},
	// …
});
```

Or you can disable hash computation (and duplicates detection):

```javascript
hive.bee('Image.Resize', {
	hash: false,
	// …
});
```

`hash` function is promised, meaning that you can either return a sync value (like above) or a promise.

Duplicate jobs have the same lifetime as their original job, including cases where original job is failed (it means if original job has failed before or after duplicate job has been submitted - duplicate job will also fail with the same Error as original job). Once original job expires (see ttl [job option](#optionslist)) all duplicates will expire too at the same moment, even if they have different ttl. Starting from moment when original job expires the very first job which is accepted by worker will be processed (and so will become new 'original').

Cancelling original job will also cancel all duplicate jobs. On the other hand cancelling the duplicate job won't change original or other duplicates.

<a name="tags"></a>
### Tags
Tags are used to attach arbitrary information to jobs which then can be used to find jobs matching particular tag(s) without knowing their JIDs.
Tags can be added during job submission:

```javascript
hive.do({
	name: 'Image.Resize',
	tags: ['tag1', 'tag2']
  }, '/tmp/image.jpg');
```

or in the worker:

```javascript
hive.bee('Image.Resize', {
	worker: function (job, imagePath) {
		job.setTags('tag1', 'tag2') // note: this will override existing job.tags
		// use job.setTags(job.tags.concat(['tag1', 'tag2'])) to add new tags to existing
		// …
	}
})
```

You can search for jobs by tags with `hive.search()`:

```javascript
hive.search('tag1', 'tag2').then(function(arrayOfJIDs){
	// …
});
```

`hive.search()` will returns a promise for the array of jobs which have _all_ specified tags.

`hive.search()` also accepts an array of tags as its argument:

```javascript
hive.search(['tag1', 'tag2']).then(function(arrayOfJIDs){
	// …
});
```

<a name="hive.doTagsDependant"></a>
You can also submit a job which will [depend](#dependencies) on other jobs with the same tags:

```javascript
hive.doTagsDependant({
	name: 'Image.Resize',
	tags: ['tag1', 'tag2']
  }, '/tmp/image.jpg');
```

### Hive object
* `hive.id`

```javascript
/**
 * @type {String}
 *
 * Unique ID of this hive object, consists of hostname,
 * process.pid and some unique string, example:
 * `Oleksiys-MacBook-Pro.local:42785:c16b0010-08fd-11e3-8a91-ed3255a3c666`
*/
```

* `hive.do(name, workload)`

```javascript
/**
 * Submit new job
 *
 * @param {String|Object} name Bee name or job options object
 * @param {...Mixed} workload
 * @returns {Promise} Promise for Job instance
 */
```

* `hive.doTagsDependant(spec, workload)`

```javascript
/**
 * Submit a new job which depends on other jobs found by specified tags in job spec

 * @param  {Object} opts Job spec
 * @return {Promise}
 */

```

* `hive.job(jid)`

```javascript
/**
 * Get Job handle instance by JID
 *
 * @param {String} jid
 * @returns {Promise} Promise for Job instance
 */
```

* `hive.cancel(job)`

```javascript
	/**
 * Cancel the job
 *
 * @param {Job|String} Job handle or JID
 * @return {Promise}
 */
```

* `hive.search(tags)`

```javascript
/**
 * Search for jobs by tag(s)
 *
 * @param {...String|Array} tags
 * @returns {Promise} Promise for array of JIDs
 */
```

* `hive.bee(name, spec)`

```javascript
/**
 * Creates and registers new Bee
 *
 * @param {String} name Bee name
 * @param {Object} beeSpec
 * @returns {Bee} Bee
 */
```

## Authors

  * [Oleksiy Krivoshey](https://github.com/oleksiyk)

# License (MIT)

Copyright (c) 2013 Oleksiy Krivoshey.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

var whenCallSequentially = require('../assets/jquery.whencallsequentially')
var Job = require('./Job')
const debug = require('debug')('web-scraper-headless:scraper')
var Scraper = function (options, moreOptions) {
  this.queue = options.queue
  this.sitemap = options.sitemap
  this.store = options.store
  this.browser = options.browser
  this.resultWriter = null // db instance for scraped data writing
  this.requestInterval = parseInt(options.requestInterval)
  this.pageLoadDelay = parseInt(options.pageLoadDelay)
}
let temp = 0
Scraper.prototype = {

	/**
	 * Scraping delay between two page opening requests
	 */
  requestInterval: 2000,
  _timeNextScrapeAvailable: 0,

  initFirstJobs: function () {
    let _this = this
    return new Promise(function(resolve, reject) {
        var urls = _this.sitemap.getStartUrls()
        let temp = 1
        //console.log('Inside initFirstJobs');
        urls.forEach(function (url) {
          var firstJob = new Job(url, '_root', _this)
          _this.queue.add(firstJob).then(function(result){
              //console.log('new job added : '+JSON.stringify(result))
              if (urls.length == temp){
                resolve(true)
              }
              temp = temp +1
          }).catch(function(err){
            console.log("Error occured in : this.queue.add(firstJob)! Err: "+JSON.stringify(err))
          })

        }.bind(_this))
        //console.log('End of initFirstJobs!')

    })
  },

  run: function (executionCallback) {
    //console.log('run function started');
    var scraper = this

		// callback when scraping is finished
    this.executionCallback = executionCallback

    this.initFirstJobs().then(function(result){
        //console.log("initFirstJobs inside.")
        scraper.store.initSitemapDataDb(scraper.sitemap._id, function (resultWriter) {
            console.log('initFirstJobs - initSitemapDataDb');
            scraper.resultWriter = resultWriter
        })
      }).then(function(){
        console.log('initFirstJobs _run');
        return new Promise(function (resolve, reject){
            scraper._run()
        })

      })
      .catch(function(err){
        //console.error('outer', err.message);
        console.log("Error occured in : initFirstJobs function! Err: "+JSON.stringify(err))
    })

  },

  recordCanHaveChildJobs: function (record) {
    if (record._follow === undefined) {
      return false
    }

    var selectorId = record._followSelectorId
    var childSelectors = this.sitemap.getDirectChildSelectors(selectorId)
    if (childSelectors.length === 0) {
      return false
    } else {
      return true
    }
  },

  getFileFilename: function (url) {
    var parts = url.split('/')
    var filename = parts[parts.length - 1]
    filename = filename.replace(/\?/g, '')
    if (filename.length > 130) {
      filename = filename.substr(0, 130)
    }
    return filename
  },

	/**
	 * Save images for user if the records contains them
	 * @param record
	 */
  saveImages: function (record) {
    var browser = this.browser
    return browser.saveImages(record, namingFunction.bind(this))

    function namingFunction (selectorId) { return this.sitemap._id + '/' + selectorId + '/' + this.getFileFilename(record[selectorId + '-src']) }
  },

	// @TODO remove recursion and add an iterative way to run these jobs.
  _run: function () {
    var _this = this
    var job = _this.queue.getNextJob()
        if (job === false) {
          debug('Scraper execution is finished')
          _this.browser.close()
          _this.executionCallback()
          return
        }
        debug('starting execute')
        job.execute(_this.browser, function (err, job) {
          if (err) {
            // jobs don't seem to return anything
            return console.error('Error in job', err)
          }
          debug('finished executing')
          var scrapedRecords = []
          var deferredDatamanipulations = []

          var records = job.getResults()
          records.forEach(function (record) {
    				// var record = JSON.parse(JSON.stringify(rec));

            deferredDatamanipulations.push(_this.saveImages.bind(_this, record))

    				// @TODO refactor job exstraction to a seperate method
            if (_this.recordCanHaveChildJobs(record)) {
              var followSelectorId = record._followSelectorId
              var followURL = record['_follow']
              delete record['_follow']
              delete record['_followSelectorId']
              var newJob = new Job(followURL, followSelectorId, this, job, record)
              //if (this.queue.canBeAdded(newJob)) {
              return new Promise(function(resolve, reject){
                  _this.queue.add(newJob).then(function(result){
                      console.log('new job added');
                      whenCallSequentially(deferredDatamanipulations).done(function () {
                        _this.resultWriter.writeDocs(scrapedRecords, function () {
                          var now = (new Date()).getTime()
                					// delay next job if needed
                          _this._timeNextScrapeAvailable = now + _this.requestInterval
                          if (now >= _this._timeNextScrapeAvailable) {
                            _this._run()
                            resolve()
                          } else {
                            var delay = _this._timeNextScrapeAvailable - now
                            setTimeout(function () {
                              _this._run()
                              resolve()
                            }.bind(_this), delay)
                          }
                        }.bind(_this))
                      }.bind(_this))

                  }).catch(function(err){
                    console.log("Error occured in : _this.queue.canBeAdded! Err: "+JSON.stringify(err))
                  })
              })
    //           } else {
    //             // store already scraped links
    //             debug('Ignoring next')
    //             debug(record)
    // //						scrapedRecords.push(record);
    //           }
            } else {
              return new Promise(function(resolve, reject){
                      if (record._follow !== undefined) {
                        delete record['_follow']
                        delete record['_followSelectorId']
                      }
                      scrapedRecords.push(record)
                      return new Promise(function(resolve,reject){
                        _this.queue.addScrapedRecord(record)
                        console.log(record)
                        whenCallSequentially(deferredDatamanipulations).done(function () {
                          _this.resultWriter.writeDocs(scrapedRecords, function () {
                            var now = (new Date()).getTime()
                  					// delay next job if needed
                            _this._timeNextScrapeAvailable = now + _this.requestInterval
                            if (now >= _this._timeNextScrapeAvailable) {
                              _this._run()
                              resolve()
                            } else {
                              var delay = _this._timeNextScrapeAvailable - now
                              setTimeout(function () {
                                _this._run()
                                resolve()
                              }.bind(_this), delay)
                            }
                          }.bind(_this))
                        }.bind(_this))
                      })
              })

            }
          }.bind(_this))


        }.bind(_this))
      }
}

module.exports = Scraper

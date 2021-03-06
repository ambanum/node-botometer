"use strict";

const unirest = require('unirest');
const Promise = require('bluebird');
const Twit = require('twit');

const botometer = function(config) {

  // twitter api credentials
  const T = new Twit({
    consumer_key: config.consumer_key,
    consumer_secret: config.consumer_secret,
    access_token: config.access_token,
    access_token_secret: config.access_token_secret,
    app_only_auth: config.app_only_auth
  });

  // botometer api credentials
  const mashape_key = config.mashape_key;

  // delay for twitter API calls
  const rate_limit = config.rate_limit || 0;

  // whether to console log names as they're collected
  const log_progress = typeof config.log_progress !== 'undefined' ? config.log_progress : true;

  // whether to include user data in output
  const include_user = typeof config.include_user !== 'undefined' ? config.include_user : true;

  // whether to include timeline data in output
  const include_timeline = typeof config.include_timeline !== 'undefined' ? config.include_timeline : false;

  // whether to include mentions data in output
  const include_mentions = typeof config.include_mentions !== 'undefined' ? config.include_mentions : false;

  // all logging here
  const writeLog = function(message) {
    if (log_progress) console.log(message);
  }

  // search with multiple endpoints
  this.searchTwitter = function(ep,opts) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        T.get(ep,opts,function(e,data,r) {
          if (e || r.statusCode !== 200) reject(new Error(e));
          data = (ep == 'search/tweets') ? data.statuses : data;
          resolve(data);
        });
      },rate_limit);
    });
  }

  // get botometer score
  this.getBotometer = function(data) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        unirest.post("https://botometer-pro.p.rapidapi.com/4/check_account")
          .header("x-rapidapi-key", mashape_key)
          .header("x-rapidapi-host", "botometer-pro.p.rapidapi.com")
          .header("Content-Type", "application/json")
          .header("Accept", "application/json")
          .send(data)
          .end(function (result) {
            // writeLog(result.status, result.headers, result.body);
            resolve(result.body);
          });
      },rate_limit);
    });
  }

  // returns a user object, their latest tweets and mentions, and bot score
  this.getBotScore = function({ screenName, userId }) {
    const data = { user:null, timeline:null, mentions:null };
    return new Promise((resolve, reject) => {
      // get this user's timeline - latest 200 tweets
      this.searchTwitter('statuses/user_timeline', { screen_name:screenName, user_id:userId, count:200 })
        .catch(e => {
          // if error collecting timeline resolve with null
          resolve(null);
        })
        .then(timeline => {
          // save user and timeline data
          data.user = timeline[0].user;
          data.timeline = timeline;
          // get latest 100 mentions of this user by search screen name
          return this.searchTwitter('search/tweets',{q:"@"+data.user.screen_name, count:100})
        })
        .catch(e => {
          // if error finding mentions move on with empty array
          // because having zero mentions is meaningful
          // TODO fix case where timeline is empty (timeline[0].user raises an exception)
          return [];
        })
        .then(mentions => {
          // save mentions
          data.mentions = mentions;
          // get botometer scores
          return this.getBotometer(data);
        })
        .catch(e => {
          console.error(e);
          // if error on botometer resolve with null
          resolve(null);
        })
        .then(botometer => {
          if (typeof botometer !== "object") {
            console.log(botometer);
            // if error on botometer resolve with null
            // Possible errors: 502 Bad gateway…
            return resolve(null);
          }
          // if there is no user, it's probably because the user is a protected account and it's impossible to get the botometer score
          if (!data.user) {
            return resolve(null);
          }

          // since we already save full user object,
          // overwrite botometer user prop to keep basic user data
          botometer.user = {
            screen_name: data.user.screen_name,
            user_id: data.user.user_id
          }
          // save botometer scores to data
          data.botometer = botometer;
          // delete any data not requested in config and resolve
          if (!include_user && data.hasOwnProperty("user")) delete data.user;
          if (!include_timeline && data.hasOwnProperty("timeline")) delete data.timeline;
          if (!include_mentions && data.hasOwnProperty("mentions")) delete data.mentions;
          resolve(data);
        });
    });
  }

  // takes like six seconds per account to complete
  this.getBatchBotScores = async function(screen_names,cb) {
    const scores = [];
    for (let screen_name of screen_names) {
      writeLog("Awaiting score for "+screen_name);
      const data = await this.getBotScore({ screenName: screen_name });
      if (data && typeof data.botometer.display_scores !== "undefined") {
        scores.push(data);
        writeLog(screen_name+" is a "+data.botometer.display_scores.universal.overall);
      } else {
        writeLog("No score found for "+screen_name);
      }
    }
    cb(scores);
  }

}

module.exports = botometer;

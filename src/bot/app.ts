/*=======================================
 *           Node.js Modules
 * ====================================*/
import * as Twit from 'twit';
import * as _ from 'lodash';
import * as mysql from 'mysql';
import { EventEmitter } from 'events';

/*=======================================
 *            Configuration
 * ====================================*/
const {
  DB_HOST: host,
  DB_NAME: database,
  DB_USERNAME: user,
  DB_PASSWORD: password,

  CONSUMER_KEY: consumer_key,
  CONSUMER_SECRET: consumer_secret,
  ACCESS_TOKEN: access_token,
  ACCESS_TOKEN_SECRET: access_token_secret,
  STRICT_SSL: strictSSL,
} = require('./../../env');

const connection = mysql.createPool({
  host,
  user,
  password,
  database,
  connectionLimit: 10,
});

const T: Twit = new Twit({
  consumer_key,
  consumer_secret,
  access_token,
  access_token_secret,
  timeout_ms: 60 * 1000,
  strictSSL: !!strictSSL,
});

/*=======================================
 *                Export
 * ====================================*/
export { T, connection };

/*=======================================
 *         My Modules and Utils
 * ====================================*/
import { logInfo, logWarning, logError, logSuccess } from './logger';
import { hashtagsToFollow } from './hashtags';
import { wordsToFollow } from './words';
import { blackListedAccounts } from './black-listed-accounts';
import { blackListedWords } from './black-listed-words';
import {
  getAllOccurrences,
  getTweetFullText,
  isDebugModeEnabled,
  isTweetFarsi,
  isTweetNotAReply,
  retweet,
  favourite,
  store,
} from './utils';

/*=======================================
 *                 Bot
 * ====================================*/
const interests: string[] = [];

// Include hashtags in a single array
hashtagsToFollow.map((val: string) => interests.push(val.toLowerCase()));
wordsToFollow.map((val: string) => interests.push(val.toLowerCase()));

const params: Twit.Params = {
  // track these words
  track: interests,
};

const stream = T.stream('statuses/filter', params);

stream.on('tweet', (tweet) => {
  if (isTweetFarsi(tweet) && isTweetNotAReply(tweet)) {
    const hashtagsOfCurrentTweet: string[] = [];

    const tweetText: string = getTweetFullText(tweet);

    if (
      getAllOccurrences('#', tweetText, true).length <= 4 &&
      tweet.entities.hashtags.length <= 4
    ) {
      for (const t in tweet.entities.hashtags) {
        tweet.entities.hashtags.map((val: { text: any }) =>
          hashtagsOfCurrentTweet.push(`#${val.text}`)
        );
      }

      let id: number = 0;

      if (!blackListedAccounts.includes(tweet.user.id_str)) {
        if (_.intersection(interests, hashtagsOfCurrentTweet).length) {
          id = tweet.id_str;
        } else {
          let tweetTextArr: string[] = tweetText.split(' ');
          tweetTextArr = tweetTextArr.map((word: string) => {
            return word.toLowerCase();
          });

          if (!_.intersection(tweetTextArr, blackListedWords).length) {
            id = _.intersection(interests, tweetTextArr).length
              ? tweet.id_str
              : 0;
          }
        }
      }

      if (id) {
        if (!isDebugModeEnabled()) {
          retweet(id)
            .then(({ message }) => {
              logSuccess(message);

              favourite(id)
                .then(({ message }) => {
                  logSuccess(message);
                })
                .catch((err) => {
                  emitter.emit('bot-error', err);
                });
            })
            .catch((err) => {
              emitter.emit('bot-error', err);
            });
        } else {
          logWarning(
            "A tweet has been captured but it won't be retweeted because by " +
              ' default the bot is forbidden to retweet from a development/' +
              'staging environment. To change this behavior set' +
              ' `DEBUG_MODE` to false in your .env file.'
          );
          logInfo(tweetText);
        }

        store(tweet)
          .then(({ message }) => {
            logSuccess(message);
          })
          .catch((err) => {
            emitter.emit('bot-error', err);
          });
      }
    }
  }
});

/*=======================================
 *            Error Handling
 * ====================================*/
class Emitter extends EventEmitter {}

const emitter = new Emitter();

stream.on('error', (err: any) => {
  emitter.emit('bot-error', err);
});

emitter.on('bot-error', (err) => {
  logError('An error has been thrown', err.message);
});

/* Deal w/ uncaught errors and unhandled promises */
process
  .on('uncaughtException', (err: Error) => {
    logError(`${new Date().toUTCString()} "uncaughtException": ${err.message}`);
    logError(err.stack);
    process.exit(1);
  })
  .on('unhandledRejection', (reason, p: Promise<any>) => {
    logError('Unhandled Rejection at Promise', p);
    logError(reason);
  });

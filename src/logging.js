const winston = require('winston');
const util = require('util');

let log = null;

const DEFAULT_LOG_LEVEL = "info";

function winstonFormatter (options) {
  return options.timestamp() + options.level + ' ' + (options.message ? options.message : '') +
    (options.meta && Object.keys(options.meta).length ? '\n\t' + JSON.stringify(options.meta) : '' );
}

function init (loggingConfig) {
  const transports = [];
  if (loggingConfig == null) {
    loggingConfig = { };
  }
  if (loggingConfig.level == null) {
    loggingConfig.level = DEFAULT_LOG_LEVEL;
  }

  const funcTimestamp = () => new Date().toISOString().replace(/[TZ]/g, ' ');

  if (loggingConfig.file) {
    transports.push(new (winston.transports.File)({
      json: false,
      name: "file",
      filename: loggingConfig.file,
      timestamp: funcTimestamp,
      formatter: winstonFormatter,
      level: loggingConfig.level,
      maxsize: loggingConfig.size,
      maxFiles: loggingConfig.count,
      zippedArchive: loggingConfig.compress,
    }));
  }

  transports.push(new (winston.transports.Console)({
    json: false,
    name: "console",
    timestamp: funcTimestamp,
    formatter: winstonFormatter,
    level: loggingConfig.level,
  }));


  log = new winston.Logger({
    transports: transports,
  });
}

function handle (level, args) {
  if (!log) {
    console.error("Log not initialised"); // eslint-disable-line no-console
  }
  // If the first arg does NOT contain '%', assume it is context and append it onto the
  // string created by passing the remaining args to util.format. Otherwise pass all args
  // to util.format

  let context = '';
  if (typeof args[0] === 'string' && args[0].indexOf('%') === -1) {
    context = args.shift() + ' ';
  }
  const message = context + util.format.apply(null, args);
  log.log(level, message);
}

module.exports = {
  init: init,
  error: function () {handle("error", Array.from(arguments))},
  warn: function () {handle("warn", Array.from(arguments))},
  info: function () {handle("info", Array.from(arguments))},
  verbose: function () {handle("verbose", Array.from(arguments))},
  silly: function () {handle("silly", Array.from(arguments))},
};

const winston = require('winston');
const util = require('util');
require("winston-daily-rotate-file");
const chalk = require("chalk");
let log = null;

const DEFAULT_LOG_LEVEL = "info";
const TERM_COLORS = {
  error: "red",
  warn: "yellow",
  info: "blue",
  verbose: "white",
  silly: "grey",
};

function winstonColorFormatter (options) {
  options.level = chalk[TERM_COLORS[options.level]](options.level);
  return winstonFormatter(options);
}

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
  if (loggingConfig.rotate == null) {
    loggingConfig.rotate = {};
  }

  const funcTimestamp = () => new Date().toISOString().replace(/[TZ]/g, ' ');
  const showConsole = loggingConfig.console !== false;
  const fileCfg = {
    json: false,
    name: "file",
    filename: loggingConfig.file,
    timestamp: funcTimestamp,
    formatter: winstonColorFormatter,
    level: loggingConfig.level,
    maxsize: loggingConfig.rotate.size,
    maxFiles: loggingConfig.rotate.count,
    zippedArchive: loggingConfig.compress,
  }
  if (loggingConfig.file) {
    if (loggingConfig.rotate.daily) {
      fileCfg.datePattern = 'yyyy-MM-dd';
      transports.push(new (winston.transports.DailyRotateFile)(fileCfg));
    } else {
      transports.push(new (winston.transports.File)(fileCfg));
    }
  }

  if (showConsole) {
    transports.push(new (winston.transports.Console)({
      json: false,
      name: "console",
      timestamp: funcTimestamp,
      formatter: winstonFormatter,
      level: loggingConfig.level,
    }));
  }

  log = new winston.Logger({
    transports: transports,
    levels: {
      error: 0,
      warn: 1,
      info: 2,
      verbose: 3,
      silly: 4,
    }
  });
  if (loggingConfig.rotate.size && loggingConfig.rotate.daily) {
    handle("error", ["You have enabled both 'size' and 'daily' in your logger config. Size will be ignored."]);
    throw Error("Invalid configuration for logger.");
  }
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

const winston = require('winston');
const util = require('util');

const Rotate = require('winston-logrotate').Rotate;

let log = null;

function init (loggingConfig) {
  const transports = [];
  transports.push(new (winston.transports.Console)({
    json: false,
    name: "console",
    timestamp: () => new Date().toISOString().replace(/[TZ]/g, ' '),
    formatter: function (options) {
      return options.timestamp() + options.level + ' ' + (options.message ? options.message : '') +
        (options.meta && Object.keys(options.meta).length ? '\n\t'+ JSON.stringify(options.meta) : '' );
    },
    level: loggingConfig.level,
  }));

  const logrotateConfig = {
    file: loggingConfig.file,
    json: false,
    size: loggingConfig.size,
    keep: loggingConfig.count,
    compress: loggingConfig.compress,
  };

  transports.push(new Rotate(logrotateConfig));

  log = new winston.Logger({
    transports: transports,
  });
}

function handle (level, args) {
  if (!log) {
    console.error("Log not initialised");
  }
  // Take the first arg as context
  // apply util.format to the second arg, with the remaining args as input
  const message = args[0] + " " + util.format.apply(null, args.slice(1));

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
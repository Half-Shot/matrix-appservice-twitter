const assert = require('chai').assert;
const Provisioner = require('../src/Provisioner.js');

const _bridge = {
  appService: {
    app: {
      use: function () {
        return true;
      }
    }
  }
};

const _config = {
  provisioning: {
    enabled: true
  },
  hashtags: {
    enable: true
  },
  timelines: {
    enable: true
  }
};

const _twitter = {

};

describe('Provisioner', function () {
  var provisioner;
  beforeEach( function () {

  });


  describe('constructor', function () {
    it('should contruct with the correct power level', () => {

      provisioner = new Provisioner(_bridge, _twitter, _config);
      assert.equal(provisioner._config.required_power_level, 50); //CHANGE THIS IF DEFAULT_POWER_REQ IS CHANGED

      _config.provisioning.required_power_level = 75;
      provisioner = new Provisioner(_bridge, _twitter, _config);
      assert.equal(provisioner._config.required_power_level, 75);
    });
  });

  describe('init()', function () {

  });

  describe('_requestWrap()', function () {

  });
});

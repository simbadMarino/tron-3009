const erc3009TokenDemo = artifacts.require('./TRC3009Token.sol');

module.exports = function (deployer) {
  deployer.deploy(erc3009TokenDemo);
};

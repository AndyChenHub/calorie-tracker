const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

function escapeForRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function blockRootDir(dirName) {
  const abs = path.resolve(__dirname, dirName);
  return new RegExp(`^${escapeForRegex(abs)}[\\\\/].*`);
}

const existingBlockList = Array.isArray(config.resolver.blockList)
  ? config.resolver.blockList
  : config.resolver.blockList
    ? [config.resolver.blockList]
    : [];

config.resolver.blockList = [
  ...existingBlockList,
  blockRootDir('backend'),
  blockRootDir('scripts'),
  blockRootDir('design-prototype'),
];

module.exports = config;

import { VERSION } from 'slash-create';

// The slash-create package `require`s its package.json for its version
// (source: https://github.com/Snazzah/slash-create/blob/a08e8f35bc/src/constants.ts#L13)
// we need to make sure that we do support this
export default {
  '(slash-create) VERSION': VERSION,
};

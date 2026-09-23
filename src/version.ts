import pkg from '../package.json' with { type: 'json' };

/** Read from package.json directly (not a hand-kept literal) so an automated version bump — which
 *  only ever touches package.json — can never drift this out of sync; version.test.ts still pins
 *  the relationship as a regression guard. */
export const WRITING_CORE_VERSION: string = pkg.version;

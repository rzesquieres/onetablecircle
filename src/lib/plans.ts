/**
 * Circle Plus features (see /pricing). Everything is free during the open
 * beta, so Plus features are switched on for everyone until billing exists.
 * Gate Plus features through hasCirclePlus() so turning this off later is one change.
 */
export const PLUS_FREE_DURING_BETA = true;

export function hasCirclePlus(): boolean {
  return PLUS_FREE_DURING_BETA;
}

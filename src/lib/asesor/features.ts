/**
 * Inspiration directions (a fixed gallery of photos with catalogue items attached) are switched off: the photos do not come
 * from Happia, so the advisor must not show them or offer to. The code and the stored state stay so they can come back.
 */
export const ADVISOR_DIRECTIONS_ENABLED = false;

/**
 * Happia's closed packages are switched off (owner, 2026-10-25): the advisor builds a custom proposal from individual
 * services instead, and offers only services that exist in the customer's city.
 */
export const ADVISOR_STANDARD_PACKAGES_ENABLED = false;

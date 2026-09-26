// The bands, in one place, because History in value 9 is judged on exactly the
// same rule as the Today card is. A band is a description of what happened. It
// is never advice, and nothing here knows what colour it is painted: the name is
// published to the DOM and the stylesheet binds the colour to the name.

/** What the change between the two readings was. */
export type ChangeBand = 'dropped' | 'stable' | 'rose' | 'rose-high';

/** What a single reading was, on its own. Unused by Today; value 9 reads it. */
export type LevelBand = 'low' | 'in-range' | 'high' | 'very-high';

/**
 * dropped at −40 or less, stable from −39 to +30, rose from +31 to +60,
 * rose-high above +60. The boundaries are closed on the band below, so a fall of
 * exactly 40 is dropped and a rise of exactly 30 is still stable.
 */
export const changeBand = (change: number): ChangeBand => {
  if (change <= -40) return 'dropped';
  if (change <= 30) return 'stable';
  if (change <= 60) return 'rose';
  return 'rose-high';
};

/** low under 70, in-range 70 to 180, high 181 to 250, very-high over 250. */
export const levelBand = (mgPerDl: number): LevelBand => {
  if (mgPerDl < 70) return 'low';
  if (mgPerDl <= 180) return 'in-range';
  if (mgPerDl <= 250) return 'high';
  return 'very-high';
};

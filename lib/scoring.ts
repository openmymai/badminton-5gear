// lib/scoring.ts
//
// Single source of truth for "who actually won" — shared by app/matches, app/live,
// and app/page (leaderboard) so they always agree with the score page's rules:
//
//   - A set is won for real once a side reaches 21.
//   - If a match was filed as Walkover/Bye (isBye === true), any set that was NOT
//     decided by real score is awarded to `byeWinner` instead — but a set someone
//     already won outright (reached 21) keeps its real result. This lets a team
//     win set 1 for real, then retire injured mid-set-2, and still lose the match
//     to the opponent's walkover.
//   - byeWinner === null means a *double* walkover (neither side showed / both
//     retired) — there is no winner and the match should not count in standings.

export interface ScoreState {
  s1a: number;
  s1b: number;
  s2a: number;
  s2b: number;
}

export interface BasicMatch {
  score: ScoreState;
  isFinished?: boolean;
  isBye?: boolean;
  byeWinner?: 'a' | 'b' | null;
}

// Real, score-based winner of a single set (someone reached 21). Null if undecided.
export function getSetWinner(a: number, b: number): 'a' | 'b' | null {
  if (a === 21) return 'a';
  if (b === 21) return 'b';
  return null;
}

// Effective winner of a single set: real result takes priority; only an undecided
// set can be handed to the walkover winner.
export function getEffectiveSetWinner(
  a: number,
  b: number,
  isBye?: boolean,
  byeWinner?: 'a' | 'b' | null
): 'a' | 'b' | null {
  const real = getSetWinner(a, b);
  if (real) return real;
  if (isBye && byeWinner) return byeWinner;
  return null;
}

// Effective set tally for a whole match (0–2 each), accounting for Walkover/Bye.
export function calculateEffectiveSets(m: BasicMatch): {
  setsA: number;
  setsB: number;
  set1Winner: 'a' | 'b' | null;
  set2Winner: 'a' | 'b' | null;
} {
  const { s1a, s1b, s2a, s2b } = m.score;
  const set1Winner = getEffectiveSetWinner(s1a, s1b, m.isBye, m.byeWinner);
  const set2Winner = getEffectiveSetWinner(s2a, s2b, m.isBye, m.byeWinner);
  const setsA = [set1Winner, set2Winner].filter(w => w === 'a').length;
  const setsB = [set1Winner, set2Winner].filter(w => w === 'b').length;
  return { setsA, setsB, set1Winner, set2Winner };
}

// Overall match winner. A Walkover/Bye verdict always overrides the raw set tally
// (e.g. sets can read 1-1 while the match itself was decided by walkover) —
// exactly like the "leadingA/leadingB" logic on the score page.
export function getMatchWinner(m: BasicMatch): 'a' | 'b' | null {
  if (m.isBye) return m.byeWinner ?? null;
  const { setsA, setsB } = calculateEffectiveSets(m);
  if (setsA > setsB) return 'a';
  if (setsB > setsA) return 'b';
  return null;
}

// A "double walkover" (isBye true, byeWinner null): both sides failed to complete
// the match and nobody won. This should be excluded entirely from standings —
// not treated as a draw.
export function isNoResult(m: BasicMatch): boolean {
  return !!m.isBye && !m.byeWinner;
}
